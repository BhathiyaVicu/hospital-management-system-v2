import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

const [
  { createApp },
  { generateSlots },
  { hasAppointmentOverlap },
  { doctorCalendarSchema, doctorDateScheduleSchema },
  { adminDoctorCalendarSchema, adminDoctorDateScheduleSchema },
] = await Promise.all([
  import('../src/app.js'),
  import('../src/repositories/doctorsRepository.js'),
  import('../src/repositories/appointmentsRepository.js'),
  import('../src/validators/workspace.js'),
  import('../src/validators/adminSchedules.js'),
]);

const app = createApp({
  env: {
    NODE_ENV: 'test',
    FRONTEND_URL: 'http://localhost:5173',
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
  healthCheck: async () => {},
});

test('doctor availability calendar validates date ranges and slot selections', () => {
  assert.equal(doctorCalendarSchema.safeParse({
    query: { from: '2026-11-01', to: '2026-11-30' },
  }).success, true);
  assert.equal(doctorCalendarSchema.safeParse({
    query: { from: '2026-11-30', to: '2026-11-01' },
  }).success, false);
  assert.equal(doctorCalendarSchema.safeParse({
    query: { from: '2026-11-01', to: '2027-01-15' },
  }).success, false);
  assert.equal(doctorDateScheduleSchema.safeParse({
    params: { date: '2026-11-12' },
    body: {
      startTime: '09:00', endTime: '13:00', slotDurationMinutes: 30,
      slots: [
        { startTime: '09:00', endTime: '09:30', isAvailable: true },
        { startTime: '09:30', endTime: '10:00', isAvailable: false },
        { startTime: '10:00', endTime: '10:30', isAvailable: true },
      ],
    },
  }).success, true);
  assert.equal(doctorDateScheduleSchema.safeParse({
    params: { date: '2026-11-12' },
    body: { startTime: '13:00', endTime: '09:00', slotDurationMinutes: 30, slots: [] },
  }).success, false);
});

test('admin doctor calendar and date schedule require a doctor id', () => {
  const doctorId = 'c8db648b-398b-4b6a-9b17-f76847e98d83';
  assert.equal(adminDoctorCalendarSchema.safeParse({
    query: { doctorId, from: '2026-11-01', to: '2026-11-30' },
  }).success, true);
  assert.equal(adminDoctorCalendarSchema.safeParse({
    query: { from: '2026-11-01', to: '2026-11-30' },
  }).success, false);
  assert.equal(adminDoctorDateScheduleSchema.safeParse({
    params: { date: '2026-11-12' },
    query: { doctorId },
    body: {
      startTime: '09:00', endTime: '10:00', slotDurationMinutes: 30,
      slots: [{ startTime: '09:00', endTime: '09:30', isAvailable: true }],
    },
  }).success, true);
  assert.equal(adminDoctorDateScheduleSchema.safeParse({
    params: { date: '2026-11-12' },
    query: {},
    body: { startTime: '09:00', endTime: '10:00', slotDurationMinutes: 30, slots: [] },
  }).success, false);
});

test('availability slots advance by duration without exceeding the availability window', () => {
  assert.deepEqual(generateSlots('09:00', '10:10', 30), [
    { startTime: '09:00', endTime: '09:30' },
    { startTime: '09:30', endTime: '10:00' },
  ]);
  assert.deepEqual(generateSlots('09:00', '09:30', 30), [
    { startTime: '09:00', endTime: '09:30' },
  ]);
  assert.deepEqual(generateSlots('09:00', '10:00', 0), []);
});

test('appointment overlap checks use half-open time ranges and ignore cancelled or excluded appointments', () => {
  const appointment = {
    id: 'existing', status: 'confirmed',
    scheduled_start: '2026-11-18T09:00:00.000Z',
    scheduled_end: '2026-11-18T09:30:00.000Z',
  };
  assert.equal(hasAppointmentOverlap([appointment], '2026-11-18T09:15:00.000Z', '2026-11-18T09:45:00.000Z'), true);
  assert.equal(hasAppointmentOverlap([appointment], '2026-11-18T09:30:00.000Z', '2026-11-18T10:00:00.000Z'), false);
  assert.equal(hasAppointmentOverlap([appointment], appointment.scheduled_start, appointment.scheduled_end, appointment.id), false);
  assert.equal(hasAppointmentOverlap([{ ...appointment, status: 'cancelled' }], appointment.scheduled_start, appointment.scheduled_end), false);
});

test('doctor and admin schedule endpoints reject unauthenticated requests', async () => {
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/doctor/schedules/calendar?from=2026-11-01&to=2026-11-30`);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).message, 'Authentication is required.');

    const adminResponse = await fetch(`http://127.0.0.1:${port}/api/admin/schedules/calendar?doctorId=c8db648b-398b-4b6a-9b17-f76847e98d83&from=2026-11-01&to=2026-11-30`);
    assert.equal(adminResponse.status, 401);
    assert.equal((await adminResponse.json()).message, 'Authentication is required.');
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

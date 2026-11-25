import { supabaseAdmin } from '../config/supabase.js';
import { run, rows, pagedRows, paginate, byId, matches } from './supabaseHelpers.js';
import { getAvailabilitySlots, zonedDateTime } from './doctorsRepository.js';

const now = () => new Date().toISOString();

function localDate(instant, timeZone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function followingDate(date) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

async function appointmentsOnLocalDay(doctorId, date, timeZone) {
  const start = zonedDateTime(date, '00:00', timeZone || 'UTC');
  const end = zonedDateTime(followingDate(date), '00:00', timeZone || 'UTC');
  return pagedRows(() => supabaseAdmin.from('appointments')
    .select('id,doctor_id,scheduled_start,scheduled_end,status')
    .eq('doctor_id', doctorId)
    .gte('scheduled_start', start.toISOString())
    .lt('scheduled_start', end.toISOString()));
}

async function appointmentContext() {
  const [appointments, doctors, users, clinics, patients] = await Promise.all([
    rows('appointments'), rows('doctors'), rows('users'), rows('clinics'), rows('patients'),
  ]);
  return { appointments, doctors: byId(doctors), users: byId(users), clinics: byId(clinics), patients: byId(patients) };
}

function appointmentView(appointment, context) {
  const doctor = context.doctors.get(appointment.doctor_id);
  const doctorUser = context.users.get(doctor?.user_id);
  const clinic = context.clinics.get(doctor?.clinic_id);
  const patient = context.patients.get(appointment.patient_id);
  const patientUser = context.users.get(patient?.user_id);
  return { appointment, doctor, doctorUser, clinic, patient, patientUser };
}

export function hasAppointmentOverlap(appointments, start, end, excludeId = null) {
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  return appointments.some((appointment) => appointment.id !== excludeId
    && appointment.status !== 'cancelled'
    && new Date(appointment.scheduled_start).getTime() < endTime
    && new Date(appointment.scheduled_end).getTime() > startTime);
}

export async function createAppointment({
  patientId, doctorId, scheduledStart, reason, createdByUserId = null,
  isWalkIn = false, walkInReason = null, clinicId = null, allowedClinicIds = null,
}) {
  // 1. Fetch Doctor and Patient
  const doctorResult = await supabaseAdmin.from('doctors').select('*').eq('id', doctorId).maybeSingle();
  const doctor = doctorResult.data;

  const patientResult = await supabaseAdmin.from('patients').select('id, user_id').eq('id', patientId).maybeSingle();
  const patient = patientResult.data;

  if (!doctor || !patient) return { unavailable: true, reason: 'doctor_or_patient_not_found' };

  // 2. Check Doctor Account & Clinic Active Status
  const accountResult = await supabaseAdmin.from('users').select('is_active').eq('id', doctor.user_id).maybeSingle();
  const clinicResult = doctor.clinic_id
    ? await supabaseAdmin.from('clinics').select('is_active').eq('id', doctor.clinic_id).maybeSingle()
    : { data: { is_active: true } };

  if (!accountResult.data?.is_active || !clinicResult.data?.is_active) {
    return { unavailable: true, reason: 'doctor_or_clinic_inactive' };
  }
  if (doctor.approval_status !== 'approved' || !doctor.is_accepting_appointments) {
    return { unavailable: true, reason: 'doctor_not_accepting_appointments' };
  }

  // 3. Check Patient Account Active
  const patientUser = await supabaseAdmin.from('users').select('is_active').eq('id', patient.user_id).maybeSingle();
  if (!patientUser.data?.is_active) return { unavailable: true, reason: 'patient_inactive' };

  // 4. Validate Slot
  const slots = await getAvailabilitySlots(doctorId);
  const selectedSlot = slots.find((slot) => new Date(slot.startAt).getTime() === new Date(scheduledStart).getTime());
  if (!selectedSlot) return { unavailable: true, reason: 'slot_not_available' };

  // 5. Check for Overlaps
  const appointments = await appointmentsOnLocalDay(doctorId, selectedSlot.date, doctor.time_zone);
  if (hasAppointmentOverlap(appointments, selectedSlot.startAt, selectedSlot.endAt)) {
    return { unavailable: true, reason: 'slot_already_booked' };
  }

  // 6. Create Appointment
  const { data: appointment, error } = await supabaseAdmin.from('appointments').insert({
    patient_id: patientId,
    doctor_id: doctorId,
    scheduled_start: selectedSlot.startAt,
    scheduled_end: selectedSlot.endAt,
    status: 'confirmed',
    reason: reason || null,
    consultation_fee_snapshot: doctor.consultation_fee,
    created_by_user_id: createdByUserId,
    is_walk_in: isWalkIn,
    walk_in_reason: walkInReason,
  }).select('*').single();

  if (error) return { unavailable: true, reason: error.message };

  return {
    appointment: {
      ...appointment,
      doctor_user_id: doctor.user_id,
      patient_user_id: patient.user_id,
    },
  };
}

export async function listPatientAppointments(patientId, {
  limit, offset, view = 'all', search = '', clinic = '', date = '', sort = 'newest',
}) {
  const context = await appointmentContext();
  const items = context.appointments.flatMap((appointment) => {
    if (appointment.patient_id !== patientId) return [];
    const joined = appointmentView(appointment, context);
    if (view === 'upcoming' && !(appointment.status === 'confirmed' && new Date(appointment.scheduled_start) >= new Date())) return [];
    if (view === 'past' && !(appointment.status !== 'cancelled'
      && (appointment.status === 'completed' || new Date(appointment.scheduled_start) < new Date()))) return [];
    if (view === 'cancelled' && appointment.status !== 'cancelled') return [];
    if (search && !matches(joined.doctorUser?.name, search) && !matches(joined.clinic?.name, search)) return [];
    if (clinic && !matches(joined.clinic?.name, clinic) && !matches(joined.clinic?.city, clinic)) return [];
    if (date && localDate(appointment.scheduled_start, joined.doctor?.time_zone) !== date) return [];
    return [{
      id: appointment.id, scheduled_start: appointment.scheduled_start, scheduled_end: appointment.scheduled_end,
      status: appointment.status, reason: appointment.reason,
      consultation_fee_snapshot: appointment.consultation_fee_snapshot, cancelled_at: appointment.cancelled_at,
      can_cancel: appointment.status === 'confirmed' && new Date(appointment.scheduled_start) > new Date(),
      doctor_name: joined.doctorUser?.name, doctor_title: joined.doctor?.professional_title,
      doctor_image: joined.doctor?.profile_image_url, time_zone: joined.doctor?.time_zone,
      clinic_name: joined.clinic?.name, clinic_city: joined.clinic?.city, clinic_address: joined.clinic?.address,
      doctor_id: joined.doctor?.id,
    }];
  }).sort((a, b) => sort === 'oldest'
    ? new Date(a.scheduled_start) - new Date(b.scheduled_start)
    : new Date(b.scheduled_start) - new Date(a.scheduled_start));
  return { appointments: paginate(items, limit, offset), total: items.length };
}

export async function getPatientAppointment(patientId, appointmentId) {
  const { data: appointment } = await run(supabaseAdmin.from('appointments').select('*')
    .eq('patient_id', patientId).eq('id', appointmentId).maybeSingle());
  if (!appointment) return null;
  const context = await appointmentContext();
  const joined = appointmentView(appointment, context);
  return {
    id: appointment.id, scheduled_start: appointment.scheduled_start, scheduled_end: appointment.scheduled_end,
    status: appointment.status, reason: appointment.reason,
    consultation_fee_snapshot: appointment.consultation_fee_snapshot, created_at: appointment.created_at,
    cancelled_at: appointment.cancelled_at,
    can_cancel: appointment.status === 'confirmed' && new Date(appointment.scheduled_start) > new Date(),
    doctor_name: joined.doctorUser?.name, doctor_title: joined.doctor?.professional_title,
    doctor_image: joined.doctor?.profile_image_url, time_zone: joined.doctor?.time_zone,
    clinic_name: joined.clinic?.name, clinic_city: joined.clinic?.city, clinic_address: joined.clinic?.address,
    clinic_phone: joined.clinic?.phone, doctor_id: joined.doctor?.id,
  };
}

export async function cancelPatientAppointment(patientId, appointmentId, userId) {
  const { data: current } = await run(supabaseAdmin.from('appointments').select('*')
    .eq('patient_id', patientId).eq('id', appointmentId).maybeSingle());
  if (!current || current.status !== 'confirmed' || ['completed', 'no_show'].includes(current.workflow_status)
    || new Date(current.scheduled_start) <= new Date()) return null;
  const updated = await run(supabaseAdmin.from('appointments').update({
    status: 'cancelled', cancelled_at: now(), cancellation_actor_user_id: userId, updated_by_user_id: userId,
  }).eq('id', appointmentId).eq('status', 'confirmed').select('id,status,doctor_id').maybeSingle());
  if (!updated.data) return null;
  const [doctor, patient] = await Promise.all([
    run(supabaseAdmin.from('doctors').select('user_id').eq('id', updated.data.doctor_id).maybeSingle()),
    run(supabaseAdmin.from('patients').select('user_id').eq('id', patientId).maybeSingle()),
  ]);
  return {
    ...current, ...updated.data,
    doctor_user_id: doctor.data?.user_id, patient_user_id: patient.data?.user_id,
  };
}

export async function reschedulePatientAppointment(patientId, appointmentId, scheduledStart, userId = null) {
  return reschedule(appointmentId, scheduledStart, userId, { patientId });
}

export async function rescheduleClinicAppointment({ appointmentId, scheduledStart, userId, allowedClinicIds }) {
  return reschedule(appointmentId, scheduledStart, userId, { allowedClinicIds });
}

async function reschedule(appointmentId, scheduledStart, userId, { patientId, allowedClinicIds }) {
  const { data: appointment } = await run(supabaseAdmin.from('appointments').select('*').eq('id', appointmentId).maybeSingle());
  if (!appointment || (patientId && appointment.patient_id !== patientId)
    || appointment.status !== 'confirmed' || ['completed', 'no_show'].includes(appointment.workflow_status)
    || new Date(appointment.scheduled_start) <= new Date()) return { unavailable: true };
  const { data: doctor } = await run(supabaseAdmin.from('doctors').select('clinic_id,user_id').eq('id', appointment.doctor_id).maybeSingle());
  if (allowedClinicIds && !allowedClinicIds.includes(doctor?.clinic_id)) return { unavailable: true };
  const slots = await getAvailabilitySlots(appointment.doctor_id);
  const selectedSlot = slots.find((slot) => new Date(slot.startAt).getTime() === new Date(scheduledStart).getTime());
  if (!selectedSlot) return { unavailable: true };
  const { data: doctorRecord } = await run(supabaseAdmin.from('doctors').select('time_zone')
    .eq('id', appointment.doctor_id).maybeSingle());
  const selectedSlotDate = localDate(new Date(selectedSlot.startAt), doctorRecord?.time_zone || 'UTC');
  const dayAppointments = await appointmentsOnLocalDay(appointment.doctor_id, selectedSlotDate, doctorRecord?.time_zone);
  if (hasAppointmentOverlap(dayAppointments, selectedSlot.startAt, selectedSlot.endAt, appointmentId)) return { unavailable: true };
  const { data: updated } = await run(supabaseAdmin.from('appointments').update({
    scheduled_start: selectedSlot.startAt, scheduled_end: selectedSlot.endAt, updated_by_user_id: userId,
  }).eq('id', appointmentId).select('*').single());
  const { data: patient } = await run(supabaseAdmin.from('patients').select('user_id')
    .eq('id', appointment.patient_id).maybeSingle());
  return {
    appointment: {
      ...updated, doctor_user_id: doctor?.user_id, patient_user_id: patient?.user_id,
    },
  };
}

export async function cancelClinicAppointment(appointmentId, userId, allowedClinicIds) {
  const { data: appointment } = await run(supabaseAdmin.from('appointments').select('*').eq('id', appointmentId).maybeSingle());
  if (!appointment || appointment.status !== 'confirmed' || ['completed', 'no_show'].includes(appointment.workflow_status)
    || new Date(appointment.scheduled_start) <= new Date()) return null;
  const { data: doctor } = await run(supabaseAdmin.from('doctors').select('clinic_id,user_id').eq('id', appointment.doctor_id).maybeSingle());
  if (!allowedClinicIds.includes(doctor?.clinic_id)) return null;
  const { data: updated } = await run(supabaseAdmin.from('appointments').update({
    status: 'cancelled', cancelled_at: now(), cancellation_actor_user_id: userId, updated_by_user_id: userId,
  }).eq('id', appointmentId).eq('status', 'confirmed').select('id,status,doctor_id').maybeSingle());
  if (!updated) return null;
  const { data: patient } = await run(supabaseAdmin.from('patients').select('user_id')
    .eq('id', appointment.patient_id).maybeSingle());
  return {
    ...appointment, ...updated,
    doctor_user_id: doctor.user_id, patient_user_id: patient?.user_id,
  };
}

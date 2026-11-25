import { supabaseAdmin } from '../config/supabase.js';
import { run, rows, paginate, byId, matches } from './supabaseHelpers.js';
import { getAvailabilitySlots, localDate } from './doctorsRepository.js';
import { createAppointment as bookAppointment, rescheduleClinicAppointment, cancelClinicAppointment } from './appointmentsRepository.js';

export async function listAssignedClinics(userId) {
  const [links, clinics] = await Promise.all([rows('receptionist_clinics'), rows('clinics')]);
  const clinicMap = byId(clinics);
  return links.filter((link) => link.receptionist_user_id === userId)
    .map((link) => clinicMap.get(link.clinic_id))
    .filter((clinic) => clinic?.is_active)
    .map(({ id, name, city, address, phone }) => ({ id, name, city, address, phone }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getProfile(userId) {
  const { data } = await run(supabaseAdmin.from('users').select('name,email,profile_phone')
    .eq('id', userId).eq('role', 'receptionist').maybeSingle());
  return data ? { name: data.name, email: data.email, phone: data.profile_phone } : null;
}

export async function updateProfile(userId, { name, phone }) {
  const { data } = await run(supabaseAdmin.from('users').update({ name, profile_phone: phone || null })
    .eq('id', userId).eq('role', 'receptionist').select('name,email,profile_phone').maybeSingle());
  return data ? { name: data.name, email: data.email, phone: data.profile_phone } : null;
}

export async function getDashboard(clinicIds) {
  const [appointments, doctors] = await Promise.all([rows('appointments'), rows('doctors')]);
  const doctorMap = byId(doctors);
  const items = appointments.filter((item) => clinicIds.includes(doctorMap.get(item.doctor_id)?.clinic_id));
  return {
    todayAppointments: items.filter((item) => item.status === 'confirmed'
      && localDate(new Date(item.scheduled_start), doctorMap.get(item.doctor_id)?.time_zone || 'UTC')
        === localDate(new Date(), doctorMap.get(item.doctor_id)?.time_zone || 'UTC')).length,
    upcomingAppointments: items.filter((item) => item.status === 'confirmed' && new Date(item.scheduled_start) > new Date()).length,
    arrivalsToProcess: items.filter((item) => ['arrived', 'checked_in', 'waiting'].includes(item.workflow_status)).length,
    recentWalkIns: items.filter((item) => item.is_walk_in
      && new Date(item.created_at) >= new Date(Date.now() - 7 * 86400000)).length,
  };
}

export async function searchPatients(clinicIds, search, { limit, offset }) {
  const [patients, users, patientClinics] = await Promise.all([rows('patients'), rows('users'), rows('patient_clinics')]);
  const userMap = byId(users);
  const ids = new Set(patientClinics.filter((link) => clinicIds.includes(link.clinic_id)).map((link) => link.patient_id));
  const found = patients.flatMap((patient) => {
    const user = userMap.get(patient.user_id);
    if (!ids.has(patient.id) || !user?.is_active
      || (search && !matches(user.name, search) && !matches(user.email, search) && !matches(patient.phone, search))) return [];
    return [{ id: patient.id, name: user.name, email: user.email, phone: patient.phone, updatedAt: patient.updated_at }];
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { patients: paginate(found, limit, offset), total: found.length };
}

export async function linkPatientByEmail(email, clinicId, actorUserId) {
  const { data: user } = await run(supabaseAdmin.from('users').select('id,name,email,role,is_active')
    .eq('email', email).eq('role', 'patient').maybeSingle());
  if (!user?.is_active) return null;
  const { data: patient } = await run(supabaseAdmin.from('patients').select('id,phone').eq('user_id', user.id).maybeSingle());
  if (!patient) return null;
  const { data: link } = await run(supabaseAdmin.from('patient_clinics').select('patient_id')
    .eq('patient_id', patient.id).eq('clinic_id', clinicId).maybeSingle());
  if (!link) await run(supabaseAdmin.from('patient_clinics').insert({
    patient_id: patient.id, clinic_id: clinicId, created_by_user_id: actorUserId,
  }));
  return { id: patient.id, userId: user.id, name: user.name, email: user.email, phone: patient.phone };
}

export async function registerPatient({ name, email, password, phone, clinicId, actorUserId }) {
  const { data, error } = await supabaseAdmin.auth.signUp({
    email, password, options: { data: { name, role: 'patient' } },
  });
  if (error) {
    const failure = new Error(error.message);
    failure.status = 400;
    throw failure;
  }
  if (!data.user) throw new Error('Supabase Auth did not return the registered user.');
  const { data: user } = await run(supabaseAdmin.from('users').select('id,name,email').eq('id', data.user.id).maybeSingle());
  const { data: patient } = await run(supabaseAdmin.from('patients').insert({
    user_id: data.user.id, phone: phone || null,
  }).select('id').single());
  if (clinicId) await run(supabaseAdmin.from('patient_clinics').insert({
    patient_id: patient.id, clinic_id: clinicId, created_by_user_id: actorUserId,
  }));
  return { ...user, patient_id: patient.id };
}

export async function removeUnverifiedPatient(userId) {
  await run(supabaseAdmin.from('users').delete().eq('id', userId).eq('role', 'patient'));
}

export async function updatePatientContact(patientId, clinicIds, { name, phone }) {
  const [patientResult, links] = await Promise.all([
    run(supabaseAdmin.from('patients').select('id,user_id').eq('id', patientId).maybeSingle()),
    rows('patient_clinics'),
  ]);
  const patient = patientResult.data;
  if (!patient || !links.some((link) => link.patient_id === patientId && clinicIds.includes(link.clinic_id))) return null;
  const { data: user } = await run(supabaseAdmin.from('users').select('is_active').eq('id', patient.user_id).maybeSingle());
  if (!user?.is_active) return null;
  await run(supabaseAdmin.from('users').update({ name }).eq('id', patient.user_id));
  const { data } = await run(supabaseAdmin.from('patients').update({ phone: phone || null })
    .eq('id', patientId).select('id,phone,updated_at').single());
  return { id: data.id, phone: data.phone, updatedAt: data.updated_at, name };
}

async function appointmentRows(clinicIds) {
  const [appointments, doctors, patients, users, clinics] = await Promise.all([
    rows('appointments'), rows('doctors'), rows('patients'), rows('users'), rows('clinics'),
  ]);
  const doctorMap = byId(doctors); const patientMap = byId(patients);
  const userMap = byId(users); const clinicMap = byId(clinics);
  return appointments.flatMap((appointment) => {
    const doctor = doctorMap.get(appointment.doctor_id);
    if (!clinicIds.includes(doctor?.clinic_id)) return [];
    const patient = patientMap.get(appointment.patient_id);
    const patientUser = userMap.get(patient?.user_id);
    const doctorUser = userMap.get(doctor?.user_id);
    const clinic = clinicMap.get(doctor?.clinic_id);
    return [{
      id: appointment.id, scheduledStart: appointment.scheduled_start, scheduledEnd: appointment.scheduled_end,
      status: appointment.status, workflowStatus: appointment.workflow_status, reason: appointment.reason,
      isWalkIn: appointment.is_walk_in, doctorId: doctor.id, doctorName: doctorUser?.name,
      timeZone: doctor.time_zone, patientId: patient?.id, patientName: patientUser?.name,
      patientEmail: patientUser?.email, patientPhone: patient?.phone, clinicId: clinic?.id, clinicName: clinic?.name,
    }];
  });
}

export async function listAppointments(clinicIds, { from, to, status, clinicId, limit, offset }) {
  const found = (await appointmentRows(clinicIds)).filter((item) => (
    (!clinicId || item.clinicId === clinicId)
    && (!from || localDate(new Date(item.scheduledStart), item.timeZone || 'UTC') >= from)
    && (!to || localDate(new Date(item.scheduledStart), item.timeZone || 'UTC') <= to)
    && (!status || item.workflowStatus === status)
  )).sort((a, b) => b.scheduledStart.localeCompare(a.scheduledStart));
  return { appointments: paginate(found, limit, offset), total: found.length };
}

export async function getAppointment(clinicIds, appointmentId) {
  const item = (await appointmentRows(clinicIds)).find((appointment) => appointment.id === appointmentId);
  if (!item) return null;
  const [history, workflowHistory, users] = await Promise.all([
    run(supabaseAdmin.from('appointment_history').select('*').eq('appointment_id', appointmentId).order('changed_at', { ascending: false })),
    run(supabaseAdmin.from('appointment_workflow_history').select('*').eq('appointment_id', appointmentId).order('changed_at', { ascending: false })),
    rows('users'),
  ]);
  const userMap = byId(users);
  return {
    ...item,
    history: (history.data || []).map((entry) => ({
      eventType: entry.event_type, scheduledStart: entry.scheduled_start, scheduledEnd: entry.scheduled_end,
      status: entry.status, workflowStatus: entry.workflow_status, changedAt: entry.changed_at,
      actorName: userMap.get(entry.actor_user_id)?.name,
    })),
    workflowHistory: (workflowHistory.data || []).map((entry) => ({
      previousStatus: entry.previous_status, newStatus: entry.new_status,
      changedAt: entry.changed_at, actorName: userMap.get(entry.actor_user_id)?.name,
    })),
  };
}

export async function listDoctors(clinicIds, clinicId) {
  const [doctors, users, clinics] = await Promise.all([rows('doctors'), rows('users'), rows('clinics')]);
  const userMap = byId(users); const clinicMap = byId(clinics);
  return doctors.filter((doctor) => clinicIds.includes(doctor.clinic_id) && doctor.clinic_id === clinicId
    && doctor.approval_status === 'approved' && doctor.is_accepting_appointments
    && userMap.get(doctor.user_id)?.is_active && clinicMap.get(doctor.clinic_id)?.is_active)
    .map((doctor) => ({
      id: doctor.id, name: userMap.get(doctor.user_id).name, title: doctor.professional_title,
      consultationFee: doctor.consultation_fee, currency: 'LKR', timeZone: doctor.time_zone,
    })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getDoctorSlots(clinicIds, clinicId, doctorId) {
  const [doctorResult, clinicResult] = await Promise.all([
    run(supabaseAdmin.from('doctors').select('*').eq('id', doctorId).maybeSingle()),
    run(supabaseAdmin.from('clinics').select('is_active').eq('id', clinicId).maybeSingle()),
  ]);
  const doctor = doctorResult.data;
  if (!doctor || doctor.clinic_id !== clinicId || !clinicIds.includes(clinicId)
    || !clinicResult.data?.is_active || !doctor.is_accepting_appointments || doctor.approval_status !== 'approved') return null;
  return getAvailabilitySlots(doctorId);
}

const workflowTransitions = {
  scheduled: new Set(['arrived', 'no_show']), arrived: new Set(['checked_in', 'no_show']),
  checked_in: new Set(['waiting', 'no_show']), waiting: new Set(['no_show']),
};

export async function updateWorkflow(clinicIds, appointmentId, nextStatus, actorUserId) {
  const { data: appointment } = await run(supabaseAdmin.from('appointments').select('*').eq('id', appointmentId).maybeSingle());
  const { data: doctor } = appointment
    ? await run(supabaseAdmin.from('doctors').select('clinic_id').eq('id', appointment.doctor_id).maybeSingle())
    : { data: null };
  if (!appointment || appointment.status !== 'confirmed' || !clinicIds.includes(doctor?.clinic_id)) return { notFound: true };
  const previous = appointment.workflow_status;
  if (!workflowTransitions[previous]?.has(nextStatus)) return { invalidTransition: true, currentStatus: previous };
  const { data } = await run(supabaseAdmin.from('appointments').update({
    workflow_status: nextStatus, workflow_updated_at: new Date().toISOString(),
    workflow_updated_by_user_id: actorUserId, updated_by_user_id: actorUserId,
  }).eq('id', appointmentId).select('id,status,workflow_status').single());
  await run(supabaseAdmin.from('appointment_workflow_history').insert({
    appointment_id: appointmentId, previous_status: previous, new_status: nextStatus, actor_user_id: actorUserId,
  }));
  return { appointment: { id: data.id, status: data.status, workflowStatus: data.workflow_status } };
}

export async function createAppointment({ patientId, doctorId, clinicId, scheduledStart, reason, createdByUserId, isWalkIn, walkInReason, clinicIds }) {
  return bookAppointment({
    patientId, doctorId, clinicId, scheduledStart, reason, createdByUserId,
    isWalkIn, walkInReason, allowedClinicIds: clinicIds,
  });
}

export { rescheduleClinicAppointment, cancelClinicAppointment };

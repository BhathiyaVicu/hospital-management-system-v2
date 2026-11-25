import { supabaseAdmin } from '../config/supabase.js';
import { run, rows, paginate, byId } from './supabaseHelpers.js';
import { localDate } from './doctorsRepository.js';

export async function getDoctorId(userId) {
  const { data } = await run(supabaseAdmin.from('doctors').select('id').eq('user_id', userId).maybeSingle());
  return data?.id || null;
}

export async function getProfile(userId) {
  const [userResult, doctorResult] = await Promise.all([
    run(supabaseAdmin.from('users').select('name,email,profile_phone').eq('id', userId).maybeSingle()),
    run(supabaseAdmin.from('doctors').select('*').eq('user_id', userId).maybeSingle()),
  ]);
  if (!userResult.data || !doctorResult.data) return null;
  const doctor = doctorResult.data;
  return {
    name: userResult.data.name, email: userResult.data.email, phone: userResult.data.profile_phone,
    title: doctor.professional_title, bio: doctor.bio, yearsOfExperience: doctor.years_of_experience,
    education: doctor.education, languages: doctor.languages, timeZone: doctor.time_zone,
    image: doctor.profile_image_url,
  };
}

export async function updateProfile(userId, values) {
  const { data: doctor } = await run(supabaseAdmin.from('doctors').select('id').eq('user_id', userId).maybeSingle());
  if (!doctor) return null;
  await run(supabaseAdmin.from('users').update({ name: values.name, profile_phone: values.phone || null }).eq('id', userId));
  const { data } = await run(supabaseAdmin.from('doctors').update({
    professional_title: values.title, bio: values.bio, years_of_experience: values.yearsOfExperience,
    education: values.education, languages: values.languages, time_zone: values.timeZone,
    profile_image_url: values.image || null,
  }).eq('id', doctor.id).select('*').single());
  return {
    title: data.professional_title, bio: data.bio, yearsOfExperience: data.years_of_experience,
    education: data.education, languages: data.languages, timeZone: data.time_zone, image: data.profile_image_url,
  };
}

export async function getDashboard(doctorId) {
  const [doctorResult, appointments] = await Promise.all([
    run(supabaseAdmin.from('doctors').select('time_zone').eq('id', doctorId).maybeSingle()),
    rows('appointments'),
  ]);
  const doctor = doctorResult.data;
  const items = appointments.filter((item) => item.doctor_id === doctorId);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: doctor?.time_zone || 'UTC' }).format(new Date());
  return {
    todayAppointments: items.filter((item) => item.status === 'confirmed'
      && new Intl.DateTimeFormat('en-CA', { timeZone: doctor?.time_zone || 'UTC' }).format(new Date(item.scheduled_start)) === today).length,
    upcomingAppointments: items.filter((item) => item.status === 'confirmed' && new Date(item.scheduled_start) > new Date()).length,
    awaitingPatients: items.filter((item) => ['arrived', 'checked_in', 'waiting'].includes(item.workflow_status)).length,
    inConsultation: items.filter((item) => item.workflow_status === 'in_consultation').length,
  };
}

async function doctorAppointmentRows(doctorId) {
  const [appointments, patients, users, doctors, clinics] = await Promise.all([
    rows('appointments'), rows('patients'), rows('users'), rows('doctors'), rows('clinics'),
  ]);
  const patientMap = byId(patients);
  const userMap = byId(users);
  const doctorMap = byId(doctors);
  const clinicMap = byId(clinics);
  return appointments.filter((item) => item.doctor_id === doctorId).map((appointment) => {
    const patient = patientMap.get(appointment.patient_id);
    const doctor = doctorMap.get(doctorId);
    const patientUser = userMap.get(patient?.user_id);
    return {
      id: appointment.id, scheduledStart: appointment.scheduled_start, scheduledEnd: appointment.scheduled_end,
      status: appointment.status, workflowStatus: appointment.workflow_status, reason: appointment.reason,
      isWalkIn: appointment.is_walk_in, patientUserId: patientUser?.id, patientName: patientUser?.name,
      patientEmail: patientUser?.email, patientPhone: patient?.phone,
      clinicName: clinicMap.get(doctor?.clinic_id)?.name, clinicCity: clinicMap.get(doctor?.clinic_id)?.city,
      timeZone: doctor?.time_zone,
    };
  });
}

export async function listAppointments(doctorId, { from, to, status, limit, offset }) {
  const appointments = (await doctorAppointmentRows(doctorId)).filter((appointment) => {
    const day = localDate(new Date(appointment.scheduledStart), appointment.timeZone || 'UTC');
    return (!from || day >= from) && (!to || day <= to) && (!status || appointment.workflowStatus === status);
  }).sort((a, b) => b.scheduledStart.localeCompare(a.scheduledStart));
  return { appointments: paginate(appointments, limit, offset), total: appointments.length };
}

export async function getAppointment(doctorId, appointmentId) {
  const list = await doctorAppointmentRows(doctorId);
  const appointment = list.find((item) => item.id === appointmentId);
  if (!appointment) return null;
  const history = await Promise.all([
    supabaseAdmin.from('appointment_history').select('*').eq('appointment_id', appointmentId).order('changed_at', { ascending: false }),
    supabaseAdmin.from('appointment_workflow_history').select('*').eq('appointment_id', appointmentId).order('changed_at', { ascending: false }),
    rows('users'),
  ]);
  for (const result of history.slice(0, 2)) if (result.error) throw new Error(result.error.message);
  const userMap = byId(history[2]);
  return {
    ...appointment,
    history: (history[0].data || []).map((item) => ({
      eventType: item.event_type, scheduledStart: item.scheduled_start, scheduledEnd: item.scheduled_end,
      status: item.status, workflowStatus: item.workflow_status, changedAt: item.changed_at,
      actorName: userMap.get(item.actor_user_id)?.name,
    })),
    workflowHistory: (history[1].data || []).map((item) => ({
      previousStatus: item.previous_status, newStatus: item.new_status,
      changedAt: item.changed_at, actorName: userMap.get(item.actor_user_id)?.name,
    })),
  };
}

const workflowTransitions = {
  scheduled: new Set(['in_consultation', 'no_show']),
  arrived: new Set(['in_consultation', 'no_show']),
  checked_in: new Set(['in_consultation', 'no_show']),
  waiting: new Set(['in_consultation', 'no_show']),
  in_consultation: new Set(['completed']), completed: new Set(), no_show: new Set(),
};

export async function updateWorkflow(doctorId, appointmentId, nextStatus, actorUserId) {
  const { data: current } = await run(supabaseAdmin.from('appointments').select('*')
    .eq('id', appointmentId).eq('doctor_id', doctorId).eq('status', 'confirmed').maybeSingle());
  if (!current) return { notFound: true };
  if (!workflowTransitions[current.workflow_status]?.has(nextStatus)) {
    return { invalidTransition: true, currentStatus: current.workflow_status };
  }
  const changedAt = new Date().toISOString();
  const { data } = await run(supabaseAdmin.from('appointments').update({
    workflow_status: nextStatus, workflow_updated_at: changedAt, workflow_updated_by_user_id: actorUserId,
    updated_by_user_id: actorUserId, ...(nextStatus === 'completed' ? { status: 'completed' } : {}),
  }).eq('id', appointmentId).select('*').single());
  await run(supabaseAdmin.from('appointment_workflow_history').insert({
    appointment_id: appointmentId, previous_status: current.workflow_status,
    new_status: nextStatus, actor_user_id: actorUserId,
  }));
  return { appointment: { id: data.id, status: data.status, workflowStatus: data.workflow_status, updatedAt: data.workflow_updated_at } };
}

export async function getConsultation(doctorId, appointmentId) {
  const { data: appointment } = await run(supabaseAdmin.from('appointments').select('id,doctor_id')
    .eq('id', appointmentId).eq('doctor_id', doctorId).maybeSingle());
  if (!appointment) return null;
  const { data } = await run(supabaseAdmin.from('consultations').select('*').eq('appointment_id', appointmentId).maybeSingle());
  if (!data) return null;
  return {
    id: data.id, clinicalNotes: data.clinical_notes, assessment: data.assessment,
    treatmentPlan: data.treatment_plan, followUpNotes: data.follow_up_notes,
    createdAt: data.created_at, updatedAt: data.updated_at,
  };
}

export async function saveConsultation(doctorId, appointmentId, values) {
  const { data: appointment } = await run(supabaseAdmin.from('appointments').select('id,patient_id,status,workflow_status')
    .eq('id', appointmentId).eq('doctor_id', doctorId).maybeSingle());
  if (!appointment || !['confirmed', 'completed'].includes(appointment.status)
    || !['in_consultation', 'completed'].includes(appointment.workflow_status)) return null;
  const { data: previous } = await run(supabaseAdmin.from('consultations').select('*').eq('appointment_id', appointmentId).maybeSingle());
  if (previous) {
    await run(supabaseAdmin.from('consultation_revisions').insert({
      consultation_id: previous.id, doctor_id: doctorId, clinical_notes: previous.clinical_notes,
      assessment: previous.assessment, treatment_plan: previous.treatment_plan,
      follow_up_notes: previous.follow_up_notes,
    }));
  }
  const { data } = await run(supabaseAdmin.from('consultations').upsert({
    appointment_id: appointmentId, doctor_id: doctorId, patient_id: appointment.patient_id,
    clinical_notes: values.clinicalNotes, assessment: values.assessment,
    treatment_plan: values.treatmentPlan, follow_up_notes: values.followUpNotes,
  }, { onConflict: 'appointment_id' }).select('*').single());
  return {
    id: data.id, clinicalNotes: data.clinical_notes, assessment: data.assessment,
    treatmentPlan: data.treatment_plan, followUpNotes: data.follow_up_notes,
    createdAt: data.created_at, updatedAt: data.updated_at,
  };
}

export async function listConsultationRevisions(doctorId, appointmentId) {
  const [appointmentResult, consultationResult] = await Promise.all([
    run(supabaseAdmin.from('appointments').select('id').eq('doctor_id', doctorId).eq('id', appointmentId).maybeSingle()),
    run(supabaseAdmin.from('consultations').select('id').eq('appointment_id', appointmentId).maybeSingle()),
  ]);
  if (!appointmentResult.data || !consultationResult.data) return [];
  const { data } = await run(supabaseAdmin.from('consultation_revisions').select('*')
    .eq('consultation_id', consultationResult.data.id).order('revised_at', { ascending: false }));
  return (data || []).map((item) => ({
    id: item.id, clinicalNotes: item.clinical_notes, assessment: item.assessment,
    treatmentPlan: item.treatment_plan, followUpNotes: item.follow_up_notes, revisedAt: item.revised_at,
  }));
}

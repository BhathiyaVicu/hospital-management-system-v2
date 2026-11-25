import { supabaseAdmin } from '../config/supabase.js';
import { run, rows, byId } from './supabaseHelpers.js';

async function profileFor(userId) {
  const [userResult, patientResult, clinics] = await Promise.all([
    run(supabaseAdmin.from('users').select('*').eq('id', userId).eq('role', 'patient').maybeSingle()),
    run(supabaseAdmin.from('patients').select('*').eq('user_id', userId).maybeSingle()),
    rows('clinics'),
  ]);
  const user = userResult.data;
  const patient = patientResult.data;
  if (!user || !patient) return null;
  return {
    userId: user.id, name: user.name, email: user.email, patientId: patient.id, phone: patient.phone,
    dateOfBirth: patient.date_of_birth, gender: patient.gender, bloodType: patient.blood_type,
    homeAddress: patient.home_address, emergencyContactName: patient.emergency_contact_name,
    emergencyContactRelationship: patient.emergency_contact_relationship,
    emergencyContactPhone: patient.emergency_contact_phone,
    preferredClinicId: patient.preferred_clinic_id,
    preferredClinicName: byId(clinics).get(patient.preferred_clinic_id)?.name || null,
    preferredConsultationMode: patient.preferred_consultation_mode,
    preferredLanguage: patient.preferred_language, wheelchairAccessible: patient.wheelchair_accessible,
  };
}

export async function getPatientProfile(userId) {
  return profileFor(userId);
}

export async function updatePatientProfile(userId, profile) {
  const user = await run(supabaseAdmin.from('users').update({
    name: `${profile.firstName} ${profile.lastName}`.trim(),
  }).eq('id', userId).eq('role', 'patient').select('id').maybeSingle());
  if (!user.data) return null;
  const updated = await run(supabaseAdmin.from('patients').update({
    phone: profile.phone || null,
    date_of_birth: profile.dateOfBirth || null,
    gender: profile.gender || null,
    home_address: profile.homeAddress || null,
    emergency_contact_name: profile.emergencyContactName || null,
    emergency_contact_relationship: profile.emergencyContactRelationship || null,
    emergency_contact_phone: profile.emergencyContactPhone || null,
    preferred_clinic_id: profile.preferredClinicId || null,
    preferred_consultation_mode: profile.preferredConsultationMode || null,
    preferred_language: profile.preferredLanguage || null,
    wheelchair_accessible: profile.wheelchairAccessible ?? false,
  }).eq('user_id', userId).select('id').maybeSingle());
  return updated.data ? profileFor(userId) : null;
}

export async function getPatientDashboard(userId, patientId) {
  const [profile, appointments, doctors, users, clinics, tickets] = await Promise.all([
    getPatientProfile(userId), rows('appointments'), rows('doctors'), rows('users'), rows('clinics'), rows('support_tickets'),
  ]);
  const doctorMap = byId(doctors);
  const userMap = byId(users);
  const clinicMap = byId(clinics);
  const patientAppointments = appointments.filter((appointment) => appointment.patient_id === patientId);
  const now = new Date();
  const upcoming = patientAppointments.filter((appointment) => appointment.status === 'confirmed'
    && new Date(appointment.scheduled_start) >= now)
    .sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start))
    .slice(0, 3).map((appointment) => {
      const doctor = doctorMap.get(appointment.doctor_id);
      const clinic = clinicMap.get(doctor?.clinic_id);
      return {
        id: appointment.id, scheduledStart: appointment.scheduled_start, scheduledEnd: appointment.scheduled_end,
        status: appointment.status, reason: appointment.reason,
        consultationFee: appointment.consultation_fee_snapshot,
        doctorId: doctor?.id, doctorName: userMap.get(doctor?.user_id)?.name,
        doctorTitle: doctor?.professional_title, doctorImage: doctor?.profile_image_url,
        clinicName: clinic?.name, clinicCity: clinic?.city, timeZone: doctor?.time_zone,
      };
    });
  const patientTickets = tickets.filter((ticket) => ticket.patient_id === patientId);
  return {
    profile,
    appointments: {
      summary: {
        upcoming: patientAppointments.filter((item) => item.status === 'confirmed' && new Date(item.scheduled_start) >= now).length,
        past: patientAppointments.filter((item) => item.status !== 'cancelled'
          && (item.status === 'completed' || new Date(item.scheduled_start) < now)).length,
        cancelled: patientAppointments.filter((item) => item.status === 'cancelled').length,
      },
      upcoming,
    },
    support: {
      total: patientTickets.length,
      active: patientTickets.filter((item) => ['open', 'in_progress', 'waiting_for_patient'].includes(item.status)).length,
    },
  };
}

export async function listPatientClinics() {
  return (await rows('clinics')).filter((clinic) => clinic.is_active)
    .map(({ id, name, city }) => ({ id, name, city })).sort((a, b) => a.name.localeCompare(b.name));
}

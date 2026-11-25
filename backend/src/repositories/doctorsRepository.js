import { supabaseAdmin } from '../config/supabase.js';
import { run, rows, pagedRows, byId, matches, paginate } from './supabaseHelpers.js';

const doctorColumns = 'id,user_id,clinic_id,primary_specialty_id,professional_title,bio,years_of_experience,consultation_fee,profile_image_url,time_zone,education,languages,approval_status,is_accepting_appointments,created_at,updated_at';

export function localDate(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDate(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function zonedDateTime(date, time, timeZone) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.slice(0, 5).split(':').map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let timestamp = desired;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(timestamp));
    const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
    const observed = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute);
    timestamp += desired - observed;
  }
  return new Date(timestamp);
}

export function generateSlots(startTime, endTime, duration) {
  const asMinutes = (value) => {
    const [hour, minute] = value.slice(0, 5).split(':').map(Number);
    return hour * 60 + minute;
  };
  const start = asMinutes(startTime);
  const end = asMinutes(endTime);
  const slots = [];
  let minute = start;
  while (duration > 0 && minute + duration <= end) {
    const format = (value) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
    slots.push({ startTime: format(minute), endTime: format(minute + duration) });
    minute += duration;
  }
  return slots;
}

function toAvailability(slot, date, timeZone, appointments) {
  const startAt = zonedDateTime(date, slot.startTime, timeZone);
  const endAt = zonedDateTime(date, slot.endTime, timeZone);
  const busy = appointments.some((appointment) => (
    appointment.status !== 'cancelled'
    && new Date(appointment.scheduled_start) < endAt
    && new Date(appointment.scheduled_end) > startAt
  ));
  return {
    date,
    day: new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(startAt),
    time: new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit' }).format(startAt),
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    available: startAt > new Date() && !busy,
    id: startAt.toISOString(),
  };
}

export async function listDoctors({ search = '', specialty = '', location = '', limit, offset }) {
  const [doctors, users, clinics, specialties] = await Promise.all([
    rows('doctors', doctorColumns), rows('users'), rows('clinics'), rows('specialties'),
  ]);
  const userMap = byId(users);
  const clinicMap = byId(clinics);
  const specialtyMap = byId(specialties);
  const all = doctors.flatMap((doctor) => {
    const user = userMap.get(doctor.user_id);
    if (!user || !doctor.is_accepting_appointments || doctor.approval_status !== 'approved'
      || !user.is_active || !user.email_verified_at) return [];
    const clinic = clinicMap.get(doctor.clinic_id);
    const specialtyRow = specialtyMap.get(doctor.primary_specialty_id);
    if (search && !matches(user.name, search) && !matches(specialtyRow?.name, search)) return [];
    if (specialty && !matches(specialtyRow?.name, specialty) && !matches(specialtyRow?.slug, specialty)) return [];
    if (location && !matches(clinic?.city, location) && !matches(clinic?.name, location)) return [];
    return [{
      id: doctor.id, name: user.name, title: doctor.professional_title, bio: doctor.bio,
      years_of_experience: doctor.years_of_experience, consultation_fee: doctor.consultation_fee,
      image: doctor.profile_image_url, clinic: clinic?.name || null,
      location: clinic?.city || null,
      specialties: specialtyRow ? [{ name: specialtyRow.name, slug: specialtyRow.slug }] : [],
    }];
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { doctors: paginate(all, limit, offset), total: all.length };
}

export async function getDoctorById(doctorId) {
  const [doctor, users, clinics, specialties] = await Promise.all([
    (async () => {
      const { data } = await run(supabaseAdmin.from('doctors').select(doctorColumns).eq('id', doctorId).maybeSingle());
      return data;
    })(),
    rows('users'), rows('clinics'), rows('specialties'),
  ]);
  if (!doctor) return null;
  const user = byId(users).get(doctor.user_id);
  if (!user?.is_active || !user.email_verified_at || !doctor.is_accepting_appointments || doctor.approval_status !== 'approved') return null;
  const clinic = byId(clinics).get(doctor.clinic_id);
  const specialty = byId(specialties).get(doctor.primary_specialty_id);
  return {
    id: doctor.id, name: user.name, title: doctor.professional_title, bio: doctor.bio,
    years_of_experience: doctor.years_of_experience, consultation_fee: doctor.consultation_fee,
    image: doctor.profile_image_url, clinic: clinic?.name || null,
    location: clinic?.city || null,
    time_zone: doctor.time_zone, education: doctor.education, languages: doctor.languages,
    specialties: specialty ? [specialty.name] : [],
  };
}

export async function listSpecialties() {
  const [specialties, doctors] = await Promise.all([rows('specialties'), rows('doctors', doctorColumns)]);
  return specialties.map((specialty) => ({
    id: specialty.id, name: specialty.name, slug: specialty.slug, description: specialty.description,
    doctorCount: doctors.filter((doctor) => doctor.primary_specialty_id === specialty.id
      && doctor.approval_status === 'approved' && doctor.is_accepting_appointments).length,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listClinics() {
  return (await rows('clinics')).filter((clinic) => clinic.is_active)
    .map(({ id, name, city, address, phone }) => ({ id, name, city, address, phone }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAvailabilitySlots(doctorId) {
  const [doctorResponse, weekly, exceptions, schedules, dateSlots, appointments] = await Promise.all([
    run(supabaseAdmin.from('doctors').select('id,time_zone,approval_status,is_accepting_appointments,user_id').eq('id', doctorId).maybeSingle()),
    rows('doctor_availability'), rows('doctor_availability_exceptions'),
    rows('doctor_availability_date_schedules'), rows('doctor_availability_date_slots'),
    pagedRows(() => supabaseAdmin.from('appointments').select('*').eq('doctor_id', doctorId)),
  ]);
  const doctor = doctorResponse.data;
  const doctorAppointments = appointments || [];
  if (!doctor || doctor.approval_status !== 'approved' || !doctor.is_accepting_appointments) return [];
  const account = await run(supabaseAdmin.from('users').select('is_active').eq('id', doctor.user_id).maybeSingle());
  if (!account.data?.is_active) return [];

  const now = new Date();
  const today = localDate(now, doctor.time_zone || 'UTC');
  const output = [];
  let offset = 0;
  while (offset < 60) {
    const date = shiftDate(today, offset);
    const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
    const explicit = schedules.find((item) => item.doctor_id === doctorId && item.available_on === date);
    const dayException = exceptions.filter((item) => item.doctor_id === doctorId && item.available_on === date)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    let localSlots = [];
    if (explicit) {
      localSlots = dateSlots.filter((item) => item.doctor_id === doctorId && item.available_on === date && item.is_available)
        .map((item) => ({ startTime: item.start_time, endTime: item.end_time }));
    } else if (dayException) {
      if (dayException.is_available) localSlots = generateSlots(dayException.start_time, dayException.end_time, dayException.slot_duration_minutes || 30);
    } else {
      localSlots = weekly.filter((item) => item.doctor_id === doctorId && item.day_of_week === dayOfWeek && item.is_available)
        .flatMap((item) => generateSlots(item.start_time, item.end_time, item.slot_duration_minutes));
    }
    const dayAppointments = doctorAppointments.filter((item) => localDate(new Date(item.scheduled_start), doctor.time_zone || 'UTC') === date);
    for (const slot of localSlots) output.push(toAvailability(slot, date, doctor.time_zone || 'UTC', dayAppointments));
    offset += 1;
  }
  return output.filter((slot) => slot.available).sort((a, b) => a.startAt.localeCompare(b.startAt));
}

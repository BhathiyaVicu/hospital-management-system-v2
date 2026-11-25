import { supabaseAdmin } from '../config/supabase.js';
import { run, rows, byId } from './supabaseHelpers.js';
import { generateSlots, zonedDateTime } from './doctorsRepository.js';

function localParts(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function asTime(hour, minute) {
  return `${hour}:${minute}`;
}

function minutes(time) {
  const [hours, mins] = time.slice(0, 5).split(':').map(Number);
  return hours * 60 + mins;
}

function dateList(from, to) {
  const dates = [];
  let date = new Date(`${from}T00:00:00Z`);
  const last = new Date(`${to}T00:00:00Z`);
  while (date <= last) {
    dates.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return dates;
}

function overlaps(appointment, slot) {
  return minutes(appointment.startTime) < minutes(slot.endTime)
    && minutes(appointment.endTime) > minutes(slot.startTime);
}

function fitsWindow(appointment, window) {
  const start = minutes(appointment.startTime);
  const duration = Number(window.slotDurationMinutes);
  const windowStart = minutes(window.startTime);
  return window.isAvailable && minutes(appointment.endTime) - start === duration
    && start >= windowStart && start + duration <= minutes(window.endTime)
    && (start - windowStart) % duration === 0;
}

async function doctorById(doctorId) {
  const { data } = await run(supabaseAdmin.from('doctors').select('*').eq('id', doctorId).maybeSingle());
  return data;
}

async function appointmentsForDate(doctorId, date, timeZone) {
  const appointments = await rows('appointments');
  return appointments.filter((appointment) => appointment.doctor_id === doctorId
    && appointment.status !== 'cancelled'
    && new Date(appointment.scheduled_end) > new Date()
    && localParts(appointment.scheduled_start, timeZone).year
      + '-' + localParts(appointment.scheduled_start, timeZone).month
      + '-' + localParts(appointment.scheduled_start, timeZone).day === date)
    .map((appointment) => {
      const start = localParts(appointment.scheduled_start, timeZone);
      const end = localParts(appointment.scheduled_end, timeZone);
      return { ...appointment, startTime: asTime(start.hour, start.minute), endTime: asTime(end.hour, end.minute) };
    });
}

async function assertAppointmentsFitWindows(doctorId, date, windows, timeZone) {
  const appointments = await appointmentsForDate(doctorId, date, timeZone);
  if (appointments.some((appointment) => !windows.some((window) => fitsWindow(appointment, window)))) {
    throw Object.assign(new Error('These changes conflict with an existing appointment. Booked times must remain enabled and unchanged.'), { status: 409 });
  }
}

function outputSchedule(item, doctorName) {
  return {
    id: item.id, doctorId: item.doctor_id, doctorName,
    dayOfWeek: item.day_of_week, startTime: item.start_time?.slice(0, 5),
    endTime: item.end_time?.slice(0, 5), slotDurationMinutes: item.slot_duration_minutes,
    isAvailable: item.is_available,
  };
}

export async function listSchedules({ doctorId, from, to }) {
  const [weekly, exceptions, doctors, users, appointments] = await Promise.all([
    rows('doctor_availability'), rows('doctor_availability_exceptions'), rows('doctors'), rows('users'), rows('appointments'),
  ]);
  const doctorMap = byId(doctors); const userMap = byId(users);
  const allowed = (id) => !doctorId || id === doctorId;
  const doctorActive = (id) => userMap.get(doctorMap.get(id)?.user_id)?.is_active;
  return {
    weekly: weekly.filter((item) => allowed(item.doctor_id) && doctorActive(item.doctor_id))
      .map((item) => outputSchedule(item, userMap.get(doctorMap.get(item.doctor_id)?.user_id)?.name))
      .sort((a, b) => a.doctorName.localeCompare(b.doctorName) || a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime)),
    exceptions: exceptions.filter((item) => allowed(item.doctor_id) && doctorActive(item.doctor_id)
      && item.available_on >= from && item.available_on <= to)
      .map((item) => ({
        id: item.id, doctorId: item.doctor_id,
        doctorName: userMap.get(doctorMap.get(item.doctor_id)?.user_id)?.name,
        availableOn: item.available_on, startTime: item.start_time?.slice(0, 5),
        endTime: item.end_time?.slice(0, 5), slotDurationMinutes: item.slot_duration_minutes,
        isAvailable: item.is_available,
        affectedAppointments: appointments.filter((appointment) => appointment.doctor_id === item.doctor_id
          && appointment.status === 'confirmed'
          && localParts(appointment.scheduled_start, doctorMap.get(item.doctor_id)?.time_zone).year
            + '-' + localParts(appointment.scheduled_start, doctorMap.get(item.doctor_id)?.time_zone).month
            + '-' + localParts(appointment.scheduled_start, doctorMap.get(item.doctor_id)?.time_zone).day === item.available_on).length,
      })).sort((a, b) => a.availableOn.localeCompare(b.availableOn) || a.doctorName.localeCompare(b.doctorName)),
  };
}

export async function getDoctorCalendar({ doctorId, from, to }) {
  const doctor = await doctorById(doctorId);
  if (!doctor) return { days: [], summary: { availableSlots: 0, bookedSlots: 0, upcomingWorkingDays: 0, nextAvailableDate: null } };
  const [weekly, exceptions, schedules, dateSlots, appointments] = await Promise.all([
    rows('doctor_availability'), rows('doctor_availability_exceptions'),
    rows('doctor_availability_date_schedules'), rows('doctor_availability_date_slots'), rows('appointments'),
  ]);
  const today = localParts(new Date(), doctor.time_zone).year + '-'
    + localParts(new Date(), doctor.time_zone).month + '-' + localParts(new Date(), doctor.time_zone).day;
  const localTime = localParts(new Date(), doctor.time_zone);
  const days = [];
  for (const date of dateList(from, to)) {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const daySchedule = schedules.find((item) => item.doctor_id === doctorId && item.available_on === date);
    const dayExceptions = exceptions.filter((item) => item.doctor_id === doctorId && item.available_on === date)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const exception = dayExceptions[0];
    let windows = [];
    let slots = [];
    if (daySchedule) {
      windows = [{ start_time: daySchedule.start_time, end_time: daySchedule.end_time, slot_duration_minutes: daySchedule.slot_duration_minutes }];
      slots = dateSlots.filter((item) => item.doctor_id === doctorId && item.available_on === date).map((item) => ({
        startTime: item.start_time, endTime: item.end_time, enabled: item.is_available,
      }));
    } else if (exception) {
      if (exception.is_available) {
        windows = [exception];
        slots = generateSlots(exception.start_time, exception.end_time, exception.slot_duration_minutes || 30)
          .map((item) => ({ ...item, enabled: true }));
      }
    } else {
      windows = weekly.filter((item) => item.doctor_id === doctorId && item.day_of_week === weekday && item.is_available);
      slots = windows.flatMap((window) => generateSlots(window.start_time, window.end_time, window.slot_duration_minutes)
        .map((item) => ({ ...item, enabled: true })));
    }
    const dayAppointments = appointments.filter((item) => item.doctor_id === doctorId && item.status !== 'cancelled'
      && localParts(item.scheduled_start, doctor.time_zone).year + '-' + localParts(item.scheduled_start, doctor.time_zone).month
        + '-' + localParts(item.scheduled_start, doctor.time_zone).day === date);
    const slotRows = slots.map((slot) => {
      const startsAt = zonedDateTime(date, slot.startTime, doctor.time_zone || 'UTC');
      const endsAt = zonedDateTime(date, slot.endTime, doctor.time_zone || 'UTC');
      const booked = dayAppointments.some((item) => new Date(item.scheduled_start) < endsAt && new Date(item.scheduled_end) > startsAt);
      return {
        time: slot.startTime, startAt: startsAt.toISOString(), endAt: endsAt.toISOString(),
        endTime: slot.endTime, enabled: slot.enabled, booked, isPast: startsAt <= new Date(),
      };
    });
    const startTime = windows.length ? windows.map((item) => item.start_time).sort()[0].slice(0, 5) : null;
    const endTime = windows.length ? windows.map((item) => item.end_time).sort().slice(-1)[0].slice(0, 5) : null;
    days.push({
      date, localToday: today, localTime: `${localTime.hour}:${localTime.minute}`,
      hasException: Boolean(exception), hasDateSchedule: Boolean(daySchedule),
      isConfigured: Boolean(exception || daySchedule || windows.length),
      startTime, endTime, slotDurationMinutes: daySchedule?.slot_duration_minutes || exception?.slot_duration_minutes || windows[0]?.slot_duration_minutes || null,
      slots: slotRows,
    });
  }
  const upcoming = days.filter((day) => day.date >= today).map((day) => ({
    date: day.date,
    availableSlots: day.slots.filter((slot) => slot.enabled && !slot.booked && !slot.isPast).length,
    bookedSlots: day.slots.filter((slot) => slot.booked).length,
  }));
  const working = upcoming.filter((day) => day.availableSlots > 0);
  return {
    days,
    summary: {
      availableSlots: upcoming.reduce((total, day) => total + day.availableSlots, 0),
      bookedSlots: upcoming.reduce((total, day) => total + day.bookedSlots, 0),
      upcomingWorkingDays: working.length, nextAvailableDate: working[0]?.date || null,
    },
  };
}

export async function saveDoctorDateSchedule({ doctorId, date, startTime, endTime, slotDurationMinutes, slots }) {
  const doctor = await doctorById(doctorId);
  if (!doctor) return null;
  const sorted = [...slots].sort((a, b) => a.startTime.localeCompare(b.startTime));
  for (let index = 0; index < sorted.length; index += 1) {
    const slot = sorted[index];
    if (slot.startTime >= slot.endTime || minutes(slot.startTime) < minutes(startTime)
      || minutes(slot.endTime) > minutes(endTime) || minutes(slot.endTime) - minutes(slot.startTime) !== Number(slotDurationMinutes)
      || (minutes(slot.startTime) - minutes(startTime)) % Number(slotDurationMinutes) !== 0
      || (index > 0 && sorted[index - 1].endTime > slot.startTime)) {
      throw Object.assign(new Error('Slots must match the appointment duration, fit within working hours, align with the start time, and cannot overlap.'), { status: 400 });
    }
  }
  if ((await appointmentsForDate(doctorId, date, doctor.time_zone)).some((appointment) => (
    !sorted.some((slot) => slot.startTime === appointment.startTime && slot.endTime === appointment.endTime && slot.isAvailable)
  ))) {
    throw Object.assign(new Error('These changes conflict with an existing appointment. Booked times must remain enabled and unchanged.'), { status: 409 });
  }
  await run(supabaseAdmin.from('doctor_availability_date_schedules').upsert({
    doctor_id: doctorId, available_on: date, start_time: startTime, end_time: endTime,
    slot_duration_minutes: slotDurationMinutes,
  }, { onConflict: 'doctor_id,available_on' }));
  await run(supabaseAdmin.from('doctor_availability_date_slots').delete().eq('doctor_id', doctorId).eq('available_on', date));
  if (sorted.length) await run(supabaseAdmin.from('doctor_availability_date_slots').insert(sorted.map((slot) => ({
    doctor_id: doctorId, available_on: date, start_time: slot.startTime, end_time: slot.endTime, is_available: slot.isAvailable,
  }))));
  return { date, slotCount: sorted.length, availableSlotCount: sorted.filter((slot) => slot.isAvailable).length };
}

export async function listScheduleDoctors() {
  const [doctors, users] = await Promise.all([rows('doctors'), rows('users')]);
  const userMap = byId(users);
  return doctors.filter((doctor) => userMap.get(doctor.user_id)?.is_active)
    .map((doctor) => ({ id: doctor.id, name: userMap.get(doctor.user_id).name, timeZone: doctor.time_zone }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function ensureNoOverlap(doctorId, dayOfWeek, startTime, endTime, excludeId = null) {
  const schedules = await rows('doctor_availability');
  const conflict = schedules.some((item) => item.doctor_id === doctorId && item.day_of_week === dayOfWeek
    && item.is_available && item.id !== excludeId && item.start_time < endTime && item.end_time > startTime);
  if (conflict) throw Object.assign(new Error('This schedule overlaps another active time window for the doctor.'), { status: 409 });
}

export async function createWeeklySchedule(payload) {
  if (payload.isAvailable) await ensureNoOverlap(payload.doctorId, payload.dayOfWeek, payload.startTime, payload.endTime);
  const { data } = await run(supabaseAdmin.from('doctor_availability').insert({
    doctor_id: payload.doctorId, day_of_week: payload.dayOfWeek, start_time: payload.startTime,
    end_time: payload.endTime, slot_duration_minutes: payload.slotDurationMinutes, is_available: payload.isAvailable,
  }).select('*').single());
  return outputSchedule(data);
}

export async function updateWeeklySchedule(availabilityId, payload, authorizedDoctorId = null) {
  const { data: current } = await run(supabaseAdmin.from('doctor_availability').select('*').eq('id', availabilityId).maybeSingle());
  if (!current || (authorizedDoctorId && current.doctor_id !== authorizedDoctorId)) return null;
  const affectedDays = new Set([current.day_of_week, payload.dayOfWeek]);
  const [doctor, appointments, exceptions, dateSchedules, allSchedules] = await Promise.all([
    doctorById(current.doctor_id), rows('appointments'), rows('doctor_availability_exceptions'),
    rows('doctor_availability_date_schedules'), rows('doctor_availability'),
  ]);
  const future = appointments.filter((item) => item.doctor_id === current.doctor_id && item.status !== 'cancelled'
    && new Date(item.scheduled_end) > new Date()).map((item) => {
    const local = localParts(item.scheduled_start, doctor.time_zone);
    const date = `${local.year}-${local.month}-${local.day}`;
    const endLocal = localParts(item.scheduled_end, doctor.time_zone);
    return { ...item, date, dayOfWeek: new Date(`${date}T00:00:00Z`).getUTCDay(),
      startTime: asTime(local.hour, local.minute), endTime: asTime(endLocal.hour, endLocal.minute) };
  }).filter((item) => affectedDays.has(item.dayOfWeek)
    && !exceptions.some((e) => e.doctor_id === current.doctor_id && e.available_on === item.date)
    && !dateSchedules.some((s) => s.doctor_id === current.doctor_id && s.available_on === item.date));
  const previousWindow = {
    startTime: current.start_time, endTime: current.end_time, slotDurationMinutes: current.slot_duration_minutes,
    isAvailable: current.is_available,
  };
  const newWindow = {
    startTime: payload.startTime, endTime: payload.endTime,
    slotDurationMinutes: payload.slotDurationMinutes, isAvailable: payload.isAvailable,
  };
  for (const appointment of future) {
    const oldWindows = allSchedules.filter((item) => item.doctor_id === current.doctor_id
      && item.day_of_week === appointment.dayOfWeek && item.id !== availabilityId)
      .map((item) => ({ startTime: item.start_time, endTime: item.end_time, slotDurationMinutes: item.slot_duration_minutes, isAvailable: item.is_available }));
    const wasCovered = [...oldWindows, ...(appointment.dayOfWeek === current.day_of_week ? [previousWindow] : [])]
      .some((window) => fitsWindow(appointment, window));
    const remains = [...oldWindows, ...(appointment.dayOfWeek === payload.dayOfWeek ? [newWindow] : [])]
      .some((window) => fitsWindow(appointment, window));
    if (wasCovered && !remains) throw Object.assign(new Error('This change would remove or alter availability for an existing appointment.'), { status: 409 });
  }
  if (payload.isAvailable) await ensureNoOverlap(payload.doctorId, payload.dayOfWeek, payload.startTime, payload.endTime, availabilityId);
  const { data } = await run(supabaseAdmin.from('doctor_availability').update({
    doctor_id: payload.doctorId, day_of_week: payload.dayOfWeek, start_time: payload.startTime,
    end_time: payload.endTime, slot_duration_minutes: payload.slotDurationMinutes, is_available: payload.isAvailable,
  }).eq('id', availabilityId).select('*').single());
  return outputSchedule(data);
}

export async function saveScheduleException(payload) {
  const doctor = await doctorById(payload.doctorId);
  if (!doctor) return null;
  await assertAppointmentsFitWindows(payload.doctorId, payload.availableOn, payload.isAvailable ? [{
    startTime: payload.startTime, endTime: payload.endTime,
    slotDurationMinutes: payload.slotDurationMinutes, isAvailable: true,
  }] : [], doctor.time_zone);
  const { data: current } = await run(supabaseAdmin.from('doctor_availability_exceptions').select('*')
    .eq('doctor_id', payload.doctorId).eq('available_on', payload.availableOn)
    .order('created_at', { ascending: false }).limit(1).maybeSingle());
  const values = {
    doctor_id: payload.doctorId, available_on: payload.availableOn,
    start_time: payload.isAvailable ? payload.startTime : null, end_time: payload.isAvailable ? payload.endTime : null,
    slot_duration_minutes: payload.isAvailable ? payload.slotDurationMinutes : null, is_available: payload.isAvailable,
  };
  const { data } = current
    ? await run(supabaseAdmin.from('doctor_availability_exceptions').update(values).eq('id', current.id).select('*').single())
    : await run(supabaseAdmin.from('doctor_availability_exceptions').insert(values).select('*').single());
  const appointments = await rows('appointments');
  return {
    id: data.id, doctorId: data.doctor_id, availableOn: data.available_on,
    startTime: data.start_time?.slice(0, 5), endTime: data.end_time?.slice(0, 5),
    slotDurationMinutes: data.slot_duration_minutes, isAvailable: data.is_available,
    affectedAppointments: appointments.filter((item) => item.doctor_id === data.doctor_id && item.status === 'confirmed'
      && localParts(item.scheduled_start, doctor.time_zone).year + '-' + localParts(item.scheduled_start, doctor.time_zone).month
        + '-' + localParts(item.scheduled_start, doctor.time_zone).day === data.available_on).length,
  };
}

export async function updateScheduleException(exceptionId, payload, authorizedDoctorId = null) {
  const { data: current } = await run(supabaseAdmin.from('doctor_availability_exceptions').select('*').eq('id', exceptionId).maybeSingle());
  if (!current || (authorizedDoctorId && current.doctor_id !== authorizedDoctorId)) return null;
  const doctor = await doctorById(current.doctor_id);
  await assertAppointmentsFitWindows(current.doctor_id, current.available_on, payload.isAvailable ? [{
    startTime: payload.startTime, endTime: payload.endTime,
    slotDurationMinutes: payload.slotDurationMinutes, isAvailable: true,
  }] : [], doctor.time_zone);
  const { data } = await run(supabaseAdmin.from('doctor_availability_exceptions').update({
    start_time: payload.isAvailable ? payload.startTime : null,
    end_time: payload.isAvailable ? payload.endTime : null,
    slot_duration_minutes: payload.isAvailable ? payload.slotDurationMinutes : null, is_available: payload.isAvailable,
  }).eq('id', exceptionId).select('*').single());
  const appointments = await rows('appointments');
  return {
    id: data.id, doctorId: data.doctor_id, availableOn: data.available_on,
    startTime: data.start_time?.slice(0, 5), endTime: data.end_time?.slice(0, 5),
    slotDurationMinutes: data.slot_duration_minutes, isAvailable: data.is_available,
    affectedAppointments: appointments.filter((item) => item.doctor_id === data.doctor_id && item.status === 'confirmed'
      && localParts(item.scheduled_start, doctor.time_zone).year + '-' + localParts(item.scheduled_start, doctor.time_zone).month
        + '-' + localParts(item.scheduled_start, doctor.time_zone).day === data.available_on).length,
  };
}

export async function deleteScheduleException(exceptionId, authorizedDoctorId = null) {
  const { data: current } = await run(supabaseAdmin.from('doctor_availability_exceptions').select('*').eq('id', exceptionId).maybeSingle());
  if (!current || (authorizedDoctorId && current.doctor_id !== authorizedDoctorId)) return null;
  const doctor = await doctorById(current.doctor_id);
  const [exceptions, weekly] = await Promise.all([rows('doctor_availability_exceptions'), rows('doctor_availability')]);
  const fallback = exceptions.filter((item) => item.doctor_id === current.doctor_id
    && item.available_on === current.available_on && item.id !== exceptionId)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  const windows = fallback
    ? (fallback.is_available ? [fallback] : [])
    : weekly.filter((item) => item.doctor_id === current.doctor_id
      && item.day_of_week === new Date(`${current.available_on}T00:00:00Z`).getUTCDay() && item.is_available)
      .map((item) => ({
        startTime: item.start_time, endTime: item.end_time, slotDurationMinutes: item.slot_duration_minutes, isAvailable: true,
      }));
  await assertAppointmentsFitWindows(current.doctor_id, current.available_on, windows, doctor.time_zone);
  const { data } = await run(supabaseAdmin.from('doctor_availability_exceptions').delete().eq('id', exceptionId).select('*').maybeSingle());
  return data ? { id: data.id, doctorId: data.doctor_id, availableOn: data.available_on } : null;
}

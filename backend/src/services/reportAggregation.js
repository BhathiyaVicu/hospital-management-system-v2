const STATUS_KEYS = ['confirmed', 'completed', 'cancelled', 'no_show'];

function utcDate(value) {
  return new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
}

function periodKey(value, grouping) {
  const date = utcDate(value);
  if (grouping === 'monthly') return date.toISOString().slice(0, 7);
  if (grouping === 'weekly') {
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  }
  return date.toISOString().slice(0, 10);
}

function periodKeys(from, to, grouping) {
  const keys = [];
  let date = utcDate(from);
  const end = utcDate(to);
  if (grouping === 'weekly') {
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  } else if (grouping === 'monthly') {
    date.setUTCDate(1);
  }
  while (date <= end) {
    keys.push(grouping === 'monthly' ? date.toISOString().slice(0, 7) : date.toISOString().slice(0, 10));
    if (grouping === 'monthly') date.setUTCMonth(date.getUTCMonth() + 1);
    else date.setUTCDate(date.getUTCDate() + (grouping === 'weekly' ? 7 : 1));
  }
  return keys;
}

function countBy(items, keyFor) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFor(item);
    if (key !== null && key !== undefined && key !== '') counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function statusOf(appointment) {
  if (appointment.workflow_status === 'no_show') return 'no_show';
  if (appointment.status === 'cancelled') return 'cancelled';
  if (appointment.status === 'completed' || appointment.workflow_status === 'completed') return 'completed';
  return 'confirmed';
}

export function aggregateAdminReport({
  appointments,
  doctors,
  users,
  clinics,
  specialties,
  rescheduleEvents,
  cancellationEvents,
  filters,
}) {
  const doctorById = new Map(doctors.map((doctor) => [doctor.id, doctor]));
  const userById = new Map(users.map((user) => [user.id, user]));
  const clinicById = new Map(clinics.map((clinic) => [clinic.id, clinic]));
  const specialtyById = new Map(specialties.map((specialty) => [specialty.id, specialty]));
  const periodList = periodKeys(filters.from, filters.to, filters.grouping);
  const appointmentsByStatusCount = countBy(appointments, statusOf);
  const appointmentTrendCount = countBy(appointments, (item) => periodKey(item.scheduled_start, filters.grouping));
  const clinicCounts = new Map();
  const doctorCounts = new Map();
  const specialtyCounts = new Map();
  const clinicPeriodCounts = new Map();
  const specialtyPeriodCounts = new Map();
  const consultationTypes = new Map([['scheduled', 0], ['walk_in', 0]]);
  const appointmentRows = appointments.map((appointment) => {
    const doctor = doctorById.get(appointment.doctor_id);
    const clinic = clinicById.get(doctor?.clinic_id);
    const specialty = specialtyById.get(doctor?.primary_specialty_id);
    const doctorUser = userById.get(doctor?.user_id);
    const status = statusOf(appointment);
    const period = periodKey(appointment.scheduled_start, filters.grouping);
    const clinicKey = clinic?.id || 'unassigned';
    const specialtyKey = specialty?.id || 'unclassified';
    clinicCounts.set(clinicKey, (clinicCounts.get(clinicKey) || 0) + 1);
    doctorCounts.set(doctor?.id || 'unknown', (doctorCounts.get(doctor?.id || 'unknown') || 0) + 1);
    specialtyCounts.set(specialtyKey, (specialtyCounts.get(specialtyKey) || 0) + 1);
    const clinicPeriodKey = `${clinicKey}|${period}`;
    clinicPeriodCounts.set(clinicPeriodKey, (clinicPeriodCounts.get(clinicPeriodKey) || 0) + 1);
    const specialtyPeriodKey = `${specialtyKey}|${period}`;
    specialtyPeriodCounts.set(specialtyPeriodKey, (specialtyPeriodCounts.get(specialtyPeriodKey) || 0) + 1);
    const consultationType = appointment.is_walk_in ? 'walk_in' : 'scheduled';
    consultationTypes.set(consultationType, consultationTypes.get(consultationType) + 1);
    return {
      id: appointment.id,
      scheduledStart: appointment.scheduled_start,
      scheduledEnd: appointment.scheduled_end,
      status,
      workflowStatus: appointment.workflow_status,
      consultationType,
      doctorName: doctorUser?.name || 'Unknown doctor',
      clinicName: clinic?.name || 'Unassigned clinic',
      specialtyName: specialty?.name || 'Unclassified',
    };
  });
  const activeClinics = filters.clinicId
    ? clinics.filter((clinic) => clinic.id === filters.clinicId)
    : clinics;
  const appointmentsByClinic = activeClinics.map((clinic) => {
    const clinicAppointments = appointments.filter((appointment) => doctorById.get(appointment.doctor_id)?.clinic_id === clinic.id);
    return {
      id: clinic.id,
      name: clinic.name,
      total: clinicAppointments.length,
      completed: clinicAppointments.filter((item) => statusOf(item) === 'completed').length,
      cancelled: clinicAppointments.filter((item) => statusOf(item) === 'cancelled').length,
      pending: clinicAppointments.filter((item) => item.status === 'confirmed' && item.workflow_status === 'scheduled').length,
      noShow: clinicAppointments.filter((item) => statusOf(item) === 'no_show').length,
    };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const appointmentsByDoctor = [...doctorCounts.entries()].map(([doctorId, count]) => {
    const doctor = doctorById.get(doctorId);
    const clinic = clinicById.get(doctor?.clinic_id);
    const specialty = specialtyById.get(doctor?.primary_specialty_id);
    return {
      id: doctorId,
      name: userById.get(doctor?.user_id)?.name || 'Unknown doctor',
      clinicName: clinic?.name || 'Unassigned clinic',
      specialtyName: specialty?.name || 'Unclassified',
      total: count,
    };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const appointmentsBySpecialty = [...specialtyCounts.entries()].map(([specialtyId, count]) => ({
    id: specialtyId,
    name: specialtyById.get(specialtyId)?.name || 'Unclassified',
    total: count,
  })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const clinicActivityTrend = [...clinicPeriodCounts.entries()].map(([compoundKey, count]) => {
    const [clinicId, period] = compoundKey.split('|');
    return { clinicName: clinicById.get(clinicId)?.name || 'Unassigned clinic', period, count };
  }).sort((a, b) => a.period.localeCompare(b.period) || a.clinicName.localeCompare(b.clinicName));
  const specialtyTrend = [...specialtyPeriodCounts.entries()].map(([compoundKey, count]) => {
    const [specialtyId, period] = compoundKey.split('|');
    return { specialtyName: specialtyById.get(specialtyId)?.name || 'Unclassified', period, count };
  }).sort((a, b) => a.period.localeCompare(b.period) || a.specialtyName.localeCompare(b.specialtyName));
  const rescheduledAppointmentIds = new Set(rescheduleEvents.map((event) => event.appointment_id));
  const statusCounts = STATUS_KEYS.map((status) => ({ status, count: appointmentsByStatusCount.get(status) || 0 }));
  const appointmentTrend = periodList.map((period) => ({
    period,
    count: appointmentTrendCount.get(period) || 0,
  }));
  const cancellationTrendCounts = countBy(cancellationEvents, (event) => periodKey(event.cancelled_at, filters.grouping));
  const rescheduleTrendCounts = countBy(rescheduleEvents, (event) => periodKey(event.changed_at, filters.grouping));

  return {
    filters,
    generatedAt: new Date().toISOString(),
    summary: {
      total: appointments.length,
      completed: appointmentsByStatusCount.get('completed') || 0,
      pending: appointments.filter((item) => item.status === 'confirmed' && item.workflow_status === 'scheduled').length,
      confirmed: appointmentsByStatusCount.get('confirmed') || 0,
      cancelled: appointmentsByStatusCount.get('cancelled') || 0,
      rescheduled: rescheduledAppointmentIds.size,
      noShow: appointmentsByStatusCount.get('no_show') || 0,
    },
    appointmentRows,
    appointmentsByStatus: statusCounts,
    appointmentTrend,
    appointmentsByClinic,
    appointmentsByDoctor,
    appointmentsBySpecialty,
    consultationTypes: [...consultationTypes].map(([type, count]) => ({ type, count })),
    clinicActivityTrend,
    specialtyTrend,
    cancellationTrend: periodList.map((period) => ({ period, count: cancellationTrendCounts.get(period) || 0 })),
    rescheduleTrend: periodList.map((period) => ({ period, count: rescheduleTrendCounts.get(period) || 0 })),
    serviceUsageSupported: false,
    serviceUsageNote: 'Appointments do not reference a healthcare service in the current schema. Usage by service cannot be measured without inventing a relationship; specialty-level appointment activity is reported instead.',
  };
}

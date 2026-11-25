import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { run, rows, pagedRows, paginate, byId, matches } from './supabaseHelpers.js';
import { aggregateAdminReport } from '../services/reportAggregation.js';

const doctorColumns = 'id,user_id,clinic_id,primary_specialty_id,professional_title,bio,years_of_experience,consultation_fee,profile_image_url,time_zone,education,languages,approval_status,is_accepting_appointments,created_at,updated_at';

function filterPage(items, filters) {
  const ordered = items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return { records: paginate(ordered, filters.limit, filters.offset), total: items.length };
}

function mapPatient(patient, user) {
  return {
    id: user.id, patientId: patient.id, name: user.name, email: user.email,
    phone: patient.phone, isActive: user.is_active, createdAt: user.created_at, updatedAt: user.updated_at,
  };
}

export async function getDashboard() {
  const [patients, doctors, clinics, specialtyRows, users, appointments, tickets] = await Promise.all([
    rows('patients'), rows('doctors', doctorColumns), rows('clinics'), rows('specialties'),
    rows('users'), rows('appointments'), rows('support_tickets'),
  ]);
  const stats = {
    patients: patients.length, doctors: doctors.length, clinics: clinics.length, specialties: specialtyRows.length,
    staff: users.filter((item) => item.role === 'staff').length,
    receptionists: users.filter((item) => item.role === 'receptionist').length,
    appointments: appointments.length,
    today_appointments: appointments.filter((item) => item.scheduled_start.slice(0, 10) === new Date().toISOString().slice(0, 10)).length,
    upcoming_appointments: appointments.filter((item) => item.status === 'confirmed' && new Date(item.scheduled_start) >= new Date()).length,
    cancelled_appointments: appointments.filter((item) => item.status === 'cancelled').length,
    support_tickets: tickets.length,
    open_support_tickets: tickets.filter((item) => ['open', 'in_progress', 'waiting_for_patient'].includes(item.status)).length,
  };
  const byStatus = (list, key) => [...list.reduce((map, item) => map.set(item[key], (map.get(item[key]) || 0) + 1), new Map())]
    .map(([status, count]) => ({ status, count }));
  const appointmentTrend = [];
  const patientTrend = [];
  let date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - 29);
  while (date <= new Date()) {
    const key = date.toISOString().slice(0, 10);
    appointmentTrend.push({ date: key, count: appointments.filter((item) => item.scheduled_start.slice(0, 10) === key).length });
    patientTrend.push({ date: key, count: users.filter((item) => item.role === 'patient' && item.created_at.slice(0, 10) === key).length });
    date.setUTCDate(date.getUTCDate() + 1);
  }
  const doctorsBySpecialty = specialtyRows.map((specialty) => ({
    name: specialty.name, count: doctors.filter((doctor) => doctor.primary_specialty_id === specialty.id).length,
  })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 8);
  return {
    stats, appointmentStatuses: byStatus(appointments, 'status'), appointmentTrend,
    patientTrend, doctorsBySpecialty, supportStatuses: byStatus(tickets, 'status'),
  };
}

export async function listPatients(filters) {
  const [patients, users] = await Promise.all([rows('patients'), rows('users')]);
  const usersById = byId(users);
  const found = patients.flatMap((patient) => {
    const user = usersById.get(patient.user_id);
    if (!user || (filters.status === 'active' && !user.is_active) || (filters.status === 'inactive' && user.is_active)
      || (filters.search && !matches(user.name, filters.search) && !matches(user.email, filters.search) && !matches(patient.phone, filters.search))) return [];
    return [mapPatient(patient, user)];
  });
  return filterPage(found, filters);
}

export async function getPatient(patientId) {
  const [patientResult, appointments, doctors, users, clinics, tickets] = await Promise.all([
    run(supabaseAdmin.from('patients').select('*').eq('id', patientId).maybeSingle()),
    rows('appointments'), rows('doctors', doctorColumns), rows('users'), rows('clinics'), rows('support_tickets'),
  ]);
  const patient = patientResult.data;
  if (!patient) return null;
  const userMap = byId(users); const doctorMap = byId(doctors); const clinicMap = byId(clinics);
  const user = userMap.get(patient.user_id);
  const patientAppointments = appointments.filter((item) => item.patient_id === patientId)
    .sort((a, b) => b.scheduled_start.localeCompare(a.scheduled_start)).slice(0, 50)
    .map((item) => ({
      id: item.id, scheduledStart: item.scheduled_start, status: item.status,
      doctorName: userMap.get(doctorMap.get(item.doctor_id)?.user_id)?.name,
      clinicName: clinicMap.get(doctorMap.get(item.doctor_id)?.clinic_id)?.name,
    }));
  const patientTickets = tickets.filter((item) => item.patient_id === patientId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50)
    .map((item) => ({
      id: item.id, ticketNumber: item.ticket_number, category: item.category,
      subject: item.subject, status: item.status, createdAt: item.created_at,
    }));
  return {
    id: user?.id, patientId, name: user?.name, email: user?.email, isActive: user?.is_active,
    createdAt: user?.created_at, updatedAt: user?.updated_at, phone: patient.phone,
    dateOfBirth: patient.date_of_birth, gender: patient.gender, bloodType: patient.blood_type,
    homeAddress: patient.home_address, emergencyContactName: patient.emergency_contact_name,
    emergencyContactPhone: patient.emergency_contact_phone, appointments: patientAppointments, tickets: patientTickets,
  };
}

export async function updatePatient(patientId, { name, email, phone, homeAddress, isActive }) {
  const { data: patient } = await run(supabaseAdmin.from('patients').select('id,user_id').eq('id', patientId).maybeSingle());
  if (!patient) return null;
  const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(patient.user_id, {
    email, ban_duration: isActive ? 'none' : '876000h',
  });
  if (authError) throw new Error(authError.message);
  const { data: user } = await run(supabaseAdmin.from('users').update({ name, email, is_active: isActive })
    .eq('id', patient.user_id).select('*').single());
  await run(supabaseAdmin.from('patients').update({ phone: phone || null, home_address: homeAddress || null }).eq('id', patientId));
  return mapPatient({ ...patient, phone }, user);
}

export async function getLookups() {
  const [clinics, specialties, doctors, users] = await Promise.all([
    rows('clinics'), rows('specialties'), rows('doctors', doctorColumns), rows('users'),
  ]);
  const userMap = byId(users);
  return {
    clinics: clinics.filter((item) => item.is_active).map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    specialties: specialties.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    doctors: doctors.filter((doctor) => userMap.get(doctor.user_id)?.is_active)
      .map((doctor) => ({ id: doctor.id, name: userMap.get(doctor.user_id).name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function validateReferences({ clinicId, specialtyIds = [], clinicIds = [], doctorIds = [] }) {
  const [clinics, specialties, doctors, users] = await Promise.all([
    rows('clinics'), rows('specialties'), rows('doctors', doctorColumns), rows('users'),
  ]);
  const userMap = byId(users);
  return (!clinicId || clinics.some((item) => item.id === clinicId && item.is_active))
    && specialtyIds.every((id) => specialties.some((item) => item.id === id))
    && clinicIds.every((id) => clinics.some((item) => item.id === id && item.is_active))
    && doctorIds.every((id) => doctors.some((item) => item.id === id && userMap.get(item.user_id)?.is_active));
}

export async function listDoctors(filters) {
  const [doctors, users, clinics, specialties, links, appointments, availability] = await Promise.all([
    rows('doctors', doctorColumns), rows('users'), rows('clinics'), rows('specialties'), rows('doctor_specialties'),
    rows('appointments'), rows('doctor_availability'),
  ]);
  const userMap = byId(users); const clinicMap = byId(clinics); const specialtyMap = byId(specialties);
  const found = doctors.flatMap((doctor) => {
    const user = userMap.get(doctor.user_id);
    if (!user || (filters.search && !matches(user.name, filters.search) && !matches(user.email, filters.search) && !matches(doctor.professional_title, filters.search))
      || (filters.specialtyId && doctor.primary_specialty_id !== filters.specialtyId)
      || (filters.clinicId && doctor.clinic_id !== filters.clinicId)
      || (filters.status === 'active' && !user.is_active) || (filters.status === 'inactive' && user.is_active)) return [];
    const specialty = specialtyMap.get(doctor.primary_specialty_id);
    const doctorLinks = links.filter((item) => item.doctor_id === doctor.id);
    const allSpecialties = doctorLinks.map((item) => specialtyMap.get(item.specialty_id)?.name).filter(Boolean);
    if (specialty && !allSpecialties.includes(specialty.name)) allSpecialties.push(specialty.name);
    return [{
      id: doctor.id, userId: user.id, name: user.name, email: user.email, isActive: user.is_active,
      clinicId: doctor.clinic_id, title: doctor.professional_title, bio: doctor.bio,
      yearsOfExperience: doctor.years_of_experience, consultationFee: doctor.consultation_fee,
      image: doctor.profile_image_url, timeZone: doctor.time_zone,
      education: doctor.education, languages: doctor.languages, acceptingAppointments: doctor.is_accepting_appointments,
      approvalStatus: doctor.approval_status, createdAt: doctor.created_at,
      primarySpecialtyId: doctor.primary_specialty_id, specialties: allSpecialties,
      clinicName: clinicMap.get(doctor.clinic_id)?.name,
      appointmentCount: appointments.filter((item) => item.doctor_id === doctor.id).length,
      availability: availability.filter((item) => item.doctor_id === doctor.id),
    }];
  }).sort((a, b) => a.name.localeCompare(b.name));
  return filterPage(found, filters);
}

export async function getDoctor(doctorId) {
  const { data: doctor } = await run(supabaseAdmin.from('doctors').select(doctorColumns).eq('id', doctorId).maybeSingle());
  if (!doctor) return null;
  const [userResult, links, specialties, availability, appointments] = await Promise.all([
    run(supabaseAdmin.from('users').select('*').eq('id', doctor.user_id).maybeSingle()),
    rows('doctor_specialties'), rows('specialties'), rows('doctor_availability'), rows('appointments'),
  ]);
  const specialtyMap = byId(specialties);
  return {
    ...((await listDoctors({})).records.find((item) => item.id === doctorId) || {}),
    userId: doctor.user_id, name: userResult.data?.name, email: userResult.data?.email,
    isActive: userResult.data?.is_active, specialties: links.filter((item) => item.doctor_id === doctorId)
      .map((item) => specialtyMap.get(item.specialty_id)?.name).filter(Boolean),
    availability: availability.filter((item) => item.doctor_id === doctorId),
    appointmentCount: appointments.filter((item) => item.doctor_id === doctorId).length,
  };
}

async function createAuthAccount({ name, email, role, password, isActive = true }) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, role },
  });
  if (error) {
    const failure = new Error(error.message);
    failure.status = 400;
    throw failure;
  }
  if (!data.user) throw new Error('Supabase Auth did not return the created user.');
  const { data: user } = await run(supabaseAdmin.from('users').select('*').eq('id', data.user.id).maybeSingle());
  if (!user) throw new Error('Supabase Auth user profile trigger did not create public.users.');
  const { data: updatedUser } = await run(supabaseAdmin.from('users').update({
    role, is_active: isActive, must_change_password: true,
    ...(role === 'admin' ? { is_super_admin: false } : {}),
  }).eq('id', user.id).select('*').single());
  return updatedUser;
}

export async function createDoctor(payload) {
  const user = await createAuthAccount({ ...payload, role: 'doctor' });
  const { data: doctor } = await run(supabaseAdmin.from('doctors').insert({
    user_id: user.id, clinic_id: payload.clinicId || null, professional_title: payload.title,
    bio: payload.bio || '', years_of_experience: payload.yearsOfExperience ?? null,
    consultation_fee: payload.consultationFee, primary_specialty_id: payload.primarySpecialtyId,
    currency: 'LKR', profile_image_url: payload.image || null, time_zone: payload.timeZone,
    education: payload.education || '', languages: payload.languages || [], approval_status: 'approved', is_accepting_appointments: true,
  }).select('id').single());
  await run(supabaseAdmin.from('doctor_specialties').insert({ doctor_id: doctor.id, specialty_id: payload.primarySpecialtyId }));
  return { id: doctor.id, userId: user.id };
}

export async function updateDoctor(doctorId, payload) {
  const { data: doctor } = await run(supabaseAdmin.from('doctors').select('user_id').eq('id', doctorId).maybeSingle());
  if (!doctor) return null;
  const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(doctor.user_id, {
    email: payload.email, user_metadata: { name: payload.name, role: 'doctor' },
    ban_duration: payload.isActive ? 'none' : '876000h',
  });
  if (authError) throw new Error(authError.message);
  await run(supabaseAdmin.from('users').update({ name: payload.name, email: payload.email, is_active: payload.isActive }).eq('id', doctor.user_id));
  await run(supabaseAdmin.from('doctors').update({
    clinic_id: payload.clinicId || null, professional_title: payload.title, bio: payload.bio || '',
    years_of_experience: payload.yearsOfExperience ?? null, consultation_fee: payload.consultationFee,
    currency: 'LKR', profile_image_url: payload.image || null, time_zone: payload.timeZone,
    education: payload.education || '', languages: payload.languages || [],
    is_accepting_appointments: payload.acceptingAppointments, primary_specialty_id: payload.primarySpecialtyId,
  }).eq('id', doctorId));
  const { data: oldLinks } = await run(supabaseAdmin.from('doctor_specialties').select('doctor_id').eq('doctor_id', doctorId));
  if (oldLinks?.length) await run(supabaseAdmin.from('doctor_specialties').delete().eq('doctor_id', doctorId));
  await run(supabaseAdmin.from('doctor_specialties').insert({ doctor_id: doctorId, specialty_id: payload.primarySpecialtyId }));
  return { id: doctorId };
}

export async function listClinics(filters) {
  const [clinics, doctors, appointments] = await Promise.all([
    rows('clinics'), rows('doctors', doctorColumns), rows('appointments'),
  ]);
  const found = clinics.filter((item) => (!filters.search || [item.name, item.city, item.address].some((value) => matches(value, filters.search)))
    && (filters.status !== 'active' || item.is_active) && (filters.status !== 'inactive' || !item.is_active))
    .map((clinic) => {
      const clinicDoctors = doctors.filter((doctor) => doctor.clinic_id === clinic.id);
      return {
        id: clinic.id, name: clinic.name, city: clinic.city, address: clinic.address, phone: clinic.phone,
        isActive: clinic.is_active, createdAt: clinic.created_at,
        doctorCount: clinicDoctors.length,
        appointmentCount: appointments.filter((item) => clinicDoctors.some((doctor) => doctor.id === item.doctor_id)).length,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  return filterPage(found, filters);
}

export async function saveClinic(id, payload) {
  const values = {
    name: payload.name, city: payload.city, address: payload.address, phone: payload.phone,
    ...(id ? { is_active: payload.isActive } : {}),
  };
  if (id) {
    const { data } = await run(supabaseAdmin.from('clinics').update(values).eq('id', id).select('*').maybeSingle());
    return data ? { id: data.id, name: data.name, city: data.city, address: data.address, phone: data.phone, isActive: data.is_active } : null;
  }
  const { data } = await run(supabaseAdmin.from('clinics').insert(values).select('*').single());
  return { id: data.id, name: data.name, city: data.city, address: data.address, phone: data.phone, isActive: data.is_active };
}

function specialtySlug(name) {
  const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || `specialty-${randomUUID()}`;
}

export async function listSpecialties(filters) {
  const specialties = await rows('specialties');
  const found = specialties.filter((item) => !filters.search
    || matches(item.name, filters.search) || matches(item.description, filters.search))
    .map((item) => ({
      id: item.id, name: item.name, slug: item.slug,
      description: item.description, createdAt: item.created_at,
    })).sort((a, b) => a.name.localeCompare(b.name));
  return filterPage(found, filters);
}

export async function saveSpecialty(id, payload) {
  const existing = await rows('specialties');
  if (existing.some((item) => item.id !== id && item.name.toLocaleLowerCase() === payload.name.toLocaleLowerCase())) {
    const error = new Error('A specialization with this name already exists.');
    error.status = 409;
    throw error;
  }
  const values = {
    name: payload.name,
    slug: specialtySlug(payload.name),
    description: payload.description || '',
  };
  try {
    const response = id
      ? await run(supabaseAdmin.from('specialties').update(values).eq('id', id).select('*').maybeSingle())
      : await run(supabaseAdmin.from('specialties').insert(values).select('*').single());
    if (!response.data) return null;
    return {
      id: response.data.id, name: response.data.name,
      slug: response.data.slug, description: response.data.description,
      createdAt: response.data.created_at,
    };
  } catch (error) {
    if (error.code === '23505') {
      const conflict = new Error('A specialization with this name or generated code already exists.');
      conflict.status = 409;
      throw conflict;
    }
    throw error;
  }
}

export async function deleteSpecialty(specialtyId) {
  const { data: specialty } = await run(supabaseAdmin.from('specialties').select('id,name')
    .eq('id', specialtyId).maybeSingle());
  if (!specialty) return null;
  const [primaryUse, linkedUse] = await Promise.all([
    run(supabaseAdmin.from('doctors').select('id').eq('primary_specialty_id', specialtyId).limit(1).maybeSingle()),
    run(supabaseAdmin.from('doctor_specialties').select('doctor_id').eq('specialty_id', specialtyId).limit(1).maybeSingle()),
  ]);
  if (primaryUse.data || linkedUse.data) return { ...specialty, inUse: true };
  try {
    const { data } = await run(supabaseAdmin.from('specialties').delete().eq('id', specialtyId).select('id').maybeSingle());
    return data ? { ...specialty, deleted: true } : null;
  } catch (error) {
    if (error.code === '23503') {
      return { ...specialty, inUse: true };
    }
    throw error;
  }
}

export async function listServices(filters) {
  const [services, clinicLinks, doctorLinks] = await Promise.all([rows('healthcare_services'), rows('clinic_services'), rows('doctor_services')]);
  const found = services.filter((item) => (!filters.search || matches(item.name, filters.search) || matches(item.slug, filters.search))
    && (filters.status !== 'active' || item.is_active) && (filters.status !== 'inactive' || !item.is_active))
    .map((item) => ({
      id: item.id, name: item.name, slug: item.slug, description: item.description,
      durationMinutes: item.duration_minutes, fee: item.fee, currency: item.currency, isActive: item.is_active,
      clinicIds: clinicLinks.filter((link) => link.service_id === item.id).map((link) => link.clinic_id),
      doctorIds: doctorLinks.filter((link) => link.service_id === item.id).map((link) => link.doctor_id),
      createdAt: item.created_at,
    })).sort((a, b) => a.name.localeCompare(b.name));
  return filterPage(found, filters);
}

export async function saveService(id, payload) {
  const values = {
    name: payload.name, slug: payload.slug, description: payload.description,
    duration_minutes: payload.durationMinutes, fee: payload.fee, currency: payload.currency,
    ...(id ? { is_active: payload.isActive } : {}),
  };
  const response = id
    ? await run(supabaseAdmin.from('healthcare_services').update(values).eq('id', id).select('id').maybeSingle())
    : await run(supabaseAdmin.from('healthcare_services').insert(values).select('id').single());
  if (!response.data) return null;
  const serviceId = response.data.id;
  await Promise.all([
    supabaseAdmin.from('clinic_services').delete().eq('service_id', serviceId),
    supabaseAdmin.from('doctor_services').delete().eq('service_id', serviceId),
  ].map(async (request) => { const { error } = await request; if (error) throw new Error(error.message); }));
  if (payload.clinicIds.length) await run(supabaseAdmin.from('clinic_services')
    .insert(payload.clinicIds.map((clinicId) => ({ clinic_id: clinicId, service_id: serviceId }))));
  if (payload.doctorIds.length) await run(supabaseAdmin.from('doctor_services')
    .insert(payload.doctorIds.map((doctorId) => ({ doctor_id: doctorId, service_id: serviceId }))));
  return { id: serviceId };
}

export async function listAccounts(role, filters) {
  const [users, tickets, assignments] = await Promise.all([rows('users'), rows('support_tickets'), rows('receptionist_clinics')]);
  const found = users.filter((user) => user.role === role
    && (role !== 'admin' || !user.is_super_admin)
    && (!filters.search || matches(user.name, filters.search) || matches(user.email, filters.search))
    && (filters.status !== 'active' || user.is_active) && (filters.status !== 'inactive' || !user.is_active))
    .map((user) => {
      const assigned = tickets.filter((ticket) => ticket.assigned_staff_id === user.id);
      return {
        id: user.id, name: user.name, email: user.email, isActive: user.is_active,
        createdAt: user.created_at, updatedAt: user.updated_at, assignedTickets: assigned.length,
        activeTickets: assigned.filter((ticket) => ['open', 'in_progress', 'waiting_for_patient'].includes(ticket.status)).length,
        clinicIds: assignments.filter((item) => item.receptionist_user_id === user.id).map((item) => item.clinic_id),
      };
    });
  return filterPage(found, filters);
}

export async function createAccount({ name, email, role, password, clinicIds = [] }) {
  const user = await createAuthAccount({ name, email, role, password });
  if (role === 'receptionist' && clinicIds.length) {
    await run(supabaseAdmin.from('receptionist_clinics').insert(clinicIds.map((clinicId) => ({
      receptionist_user_id: user.id, clinic_id: clinicId,
    }))));
  }
  return {
    id: user.id, name: user.name, email: user.email, role: user.role,
    isActive: user.is_active, createdAt: user.created_at,
  };
}

export async function updateAccount(id, role, { name, email, isActive, clinicIds = [] }) {
  let accountQuery = supabaseAdmin.from('users').select('id')
    .eq('id', id).eq('role', role);
  if (role === 'admin') accountQuery = accountQuery.eq('is_super_admin', false);
  const { data: current } = await run(accountQuery.maybeSingle());
  if (!current) return null;
  const { error } = await supabaseAdmin.auth.admin.updateUserById(id, {
    email, user_metadata: { name, role }, ban_duration: isActive ? 'none' : '876000h',
  });
  if (error) throw new Error(error.message);
  const { data: user } = await run(supabaseAdmin.from('users').update({ name, email, is_active: isActive })
    .eq('id', id).select('*').single());
  if (role === 'receptionist') {
    await run(supabaseAdmin.from('receptionist_clinics').delete().eq('receptionist_user_id', id));
    if (clinicIds.length) await run(supabaseAdmin.from('receptionist_clinics').insert(clinicIds.map((clinicId) => ({
      receptionist_user_id: id, clinic_id: clinicId,
    }))));
  }
  return {
    id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.is_active,
    createdAt: user.created_at, updatedAt: user.updated_at,
  };
}

export async function getAccount(userId, role) {
  const { data: user } = await run(supabaseAdmin.from('users').select('*')
    .eq('id', userId).eq('role', role).maybeSingle());
  if (!user) return null;
  const base = {
    id: user.id, name: user.name, email: user.email, role: user.role,
    isActive: user.is_active, createdAt: user.created_at, updatedAt: user.updated_at,
  };
  if (role === 'staff') {
    const [tickets, messages] = await Promise.all([
      pagedRows(() => supabaseAdmin.from('support_tickets')
        .select('id,ticket_number,subject,status,created_at,updated_at')
        .eq('assigned_staff_id', userId)),
      pagedRows(() => supabaseAdmin.from('support_ticket_messages').select('id')
        .eq('sender_user_id', userId)),
    ]);
    const assigned = tickets;
    return {
      ...base,
      assignedTickets: assigned.length,
      activeTickets: assigned.filter((ticket) => ['open', 'in_progress', 'waiting_for_patient'].includes(ticket.status)).length,
      messagesSent: messages.filter((message) => message.sender_user_id === userId).length,
      tickets: assigned.map((ticket) => ({
        id: ticket.id, ticketNumber: ticket.ticket_number, subject: ticket.subject,
        status: ticket.status, createdAt: ticket.created_at, updatedAt: ticket.updated_at,
      })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    };
  }
  const [assignments, appointments, patientClinics] = await Promise.all([
    pagedRows(() => supabaseAdmin.from('receptionist_clinics').select('clinic_id')
      .eq('receptionist_user_id', userId)),
    pagedRows(() => supabaseAdmin.from('appointments')
      .select('id,patient_id,doctor_id,scheduled_start,status,workflow_status')
      .eq('created_by_user_id', userId)),
    pagedRows(() => supabaseAdmin.from('patient_clinics').select('patient_id')
      .eq('created_by_user_id', userId)),
  ]);
  const patientIds = [...new Set(appointments.map((appointment) => appointment.patient_id))];
  const doctorIds = [...new Set(appointments.map((appointment) => appointment.doctor_id))];
  const patients = await rowsByIds('patients', 'id,user_id', patientIds);
  const doctors = await rowsByIds('doctors', 'id,user_id,clinic_id', doctorIds);
  const clinicIds = [...new Set([
    ...assignments.map((item) => item.clinic_id),
    ...doctors.map((doctor) => doctor.clinic_id).filter(Boolean),
  ])];
  const [clinics, users] = await Promise.all([
    rowsByIds('clinics', 'id,name', clinicIds),
    rowsByIds('users', 'id,name', [
      ...patients.map((patient) => patient.user_id),
      ...doctors.map((doctor) => doctor.user_id),
    ]),
  ]);
  const userMap = byId(users); const patientMap = byId(patients);
  const doctorMap = byId(doctors); const clinicMap = byId(clinics);
  const assignedAppointments = appointments.filter((appointment) => appointment.created_by_user_id === userId);
  return {
    ...base,
    clinicIds: assignments.filter((item) => item.receptionist_user_id === userId).map((item) => item.clinic_id),
    clinicNames: assignments.filter((item) => item.receptionist_user_id === userId)
      .map((item) => clinicMap.get(item.clinic_id)?.name).filter(Boolean),
    appointmentsCreated: assignedAppointments.length,
    patientLinksCreated: patientClinics.filter((link) => link.created_by_user_id === userId).length,
    appointments: assignedAppointments.slice().sort((a, b) => b.scheduled_start.localeCompare(a.scheduled_start))
      .slice(0, 100).map((appointment) => {
        const patient = patientMap.get(appointment.patient_id);
        const doctor = doctorMap.get(appointment.doctor_id);
        return {
          id: appointment.id, scheduledStart: appointment.scheduled_start, status: appointment.status,
          workflowStatus: appointment.workflow_status, patientName: userMap.get(patient?.user_id)?.name,
          clinicName: clinicMap.get(doctor?.clinic_id)?.name,
        };
      }),
  };
}

function deletionConflict(message, profileUserId = null, supabaseMessage = null) {
  const error = new Error(message);
  error.status = 409;
  if (profileUserId) error.profileUserId = profileUserId;
  if (supabaseMessage) error.supabaseMessage = supabaseMessage;
  return error;
}

async function deletionQuery(request, entity, profileUserId = null) {
  try {
    return await run(request);
  } catch (error) {
    if (error.code === '42501' || error.status === 403
      || /row.level security|permission denied/i.test(error.message)) {
      const failure = new Error(`Supabase RLS blocked access to the ${entity}. Verify the service-role client and table policies.`);
      failure.status = 403;
      failure.code = error.code;
      failure.profileUserId = profileUserId;
      failure.supabaseMessage = error.message;
      throw failure;
    }
    throw error;
  }
}

async function deleteAuthAccount(userId, role, details = {}) {
  // 1. Free the original email before deleting, because Supabase soft-deletes
  //    auth users (sets deleted_at) but keeps the row — the unique email would
  //    otherwise block re-creating a user with the same address.
  const tombstoneEmail = `deleted+${userId}@invalid.local`;
  const { error: renameError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    email: tombstoneEmail,
    email_confirm: true, // don't send a confirmation email to the placeholder address
  });

  const renameAlreadyGone =
    renameError && (renameError.status === 404 || renameError.code === 'user_not_found'
      || /user not found/i.test(renameError.message));

  if (renameError && !renameAlreadyGone) {
    const failure = new Error(
      `Could not free the ${role} email before deletion: ${renameError.message}`,
    );
    failure.status = renameError.status || 500;
    failure.profileUserId = userId;
    failure.supabaseMessage = renameError.message;
    throw failure;
  }

  // 2. Try to delete the auth user (now that the email is freed).
  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);

  const alreadyGone =
    error && (error.status === 404 || error.code === 'user_not_found' || /user not found/i.test(error.message));

  // 3. If it failed for any reason other than "already gone", bail out.
  if (error && !alreadyGone) {
    if (error.code === '23503' || error.status === 409
      || /foreign key constraint|database error deleting user/i.test(error.message)) {
      throw deletionConflict(
        `This ${role} account has historical records and cannot be deleted. Deactivate it to preserve the records.`,
        userId, error.message,
      );
    }
    const failure = new Error(`Supabase Auth deletion failed for this ${role} account: ${error.message}`);
    failure.status = error.status || 500;
    failure.code = error.code;
    failure.profileUserId = userId;
    failure.supabaseMessage = error.message;
    throw failure;
  }

  // 4. Auth user is gone (or was already gone) — explicitly clean profile rows
  //    in dependency order, so we never depend on cascade firing.
  if (role === 'receptionist') {
    await supabaseAdmin.from('receptionist_clinics').delete().eq('receptionist_user_id', userId);
  }
  if (role === 'doctor') {
    const { data: doctor } = await supabaseAdmin
      .from('doctors').select('id').eq('user_id', userId).maybeSingle();
    if (doctor) {
      await supabaseAdmin.from('doctor_specialties').delete().eq('doctor_id', doctor.id);
      await supabaseAdmin.from('doctors').delete().eq('id', doctor.id);
    }
  }
  if (role === 'staff') {
    // any staff-specific cleanup here
  }

  // 5. Delete the public.users row (cascades to doctors if not already removed).
  const { error: profileError } = await supabaseAdmin.from('users').delete().eq('id', userId);
  if (profileError) {
    const failure = new Error(
      `Auth user was removed, but the leftover ${role} profile row could not be deleted: ${profileError.message}`,
    );
    failure.status = profileError.code === '23503' ? 409 : 500;
    failure.profileUserId = userId;
    failure.supabaseMessage = profileError.message;
    throw failure;
  }

  return { id: userId, role, deleted: true, profileUserId: userId, ...details };
}

export async function deleteDoctor(doctorId) {
  let profileUserId = null;
  try {
    let { data: doctor } = await deletionQuery(
      supabaseAdmin.from('doctors').select('id,user_id').eq('user_id', doctorId).maybeSingle(),
      'doctor profile',
    );
    if (!doctor) {
      ({ data: doctor } = await deletionQuery(
        supabaseAdmin.from('doctors').select('id,user_id').eq('id', doctorId).maybeSingle(),
        'doctor profile',
      ));
    }
    if (!doctor) return null;
    profileUserId = doctor.user_id || doctor.id;
    const { data: appointment } = await deletionQuery(
      supabaseAdmin.from('appointments').select('id')
        .eq('doctor_id', doctor.id).limit(1).maybeSingle(),
      'doctor appointment history',
      profileUserId,
    );
    if (appointment) {
      throw deletionConflict(
        'This doctor has appointment history and cannot be deleted. Deactivate the account to preserve those records.',
        profileUserId,
      );
    }
    return await deleteAuthAccount(profileUserId, 'doctor');
  } catch (error) {
    if (profileUserId && !error.profileUserId) error.profileUserId = profileUserId;
    throw error;
  }
}

export async function deleteAccount(userId, role) {
  let profileUserId = null;
  try {
    const { data: user } = await deletionQuery(
      supabaseAdmin.from('users').select('id,is_super_admin').eq('id', userId).eq('role', role)
        .maybeSingle(),
      `${role} profile`,
    );
    if (!user) return null;
    if (role === 'admin' && user.is_super_admin) {
      throw deletionConflict('Super Admin accounts cannot be deleted from Admin Management.', user.id);
    }
    profileUserId = user.id || userId;
    if (role === 'admin') {
      const { data: message } = await deletionQuery(
        supabaseAdmin.from('support_ticket_messages').select('id')
          .eq('sender_user_id', profileUserId).limit(1).maybeSingle(),
        'admin support message history',
        profileUserId,
      );
      if (message) {
        throw deletionConflict(
          'This admin has support message history and cannot be deleted. Deactivate the account to preserve the records.',
          profileUserId,
        );
      }

      const detachOperations = [
        ['appointments', 'created_by_user_id'],
        ['appointments', 'updated_by_user_id'],
        ['appointments', 'workflow_updated_by_user_id'],
        ['appointments', 'cancellation_actor_user_id'],
        ['patient_clinics', 'created_by_user_id'],
        ['appointment_history', 'actor_user_id'],
        ['appointment_workflow_history', 'actor_user_id'],
        ['admin_activity_logs', 'actor_user_id'],
        ['admin_activity_logs', 'target_user_id'],
        ['support_tickets', 'assigned_staff_id'],
      ];
      for (const [table, column] of detachOperations) {
        await deletionQuery(
          supabaseAdmin.from(table).update({ [column]: null }).eq(column, profileUserId),
          `${role} historical references`,
          profileUserId,
        );
      }
    }
    if (role === 'staff') {
      const [ticket, message] = await Promise.all([
        deletionQuery(supabaseAdmin.from('support_tickets').select('id')
          .eq('assigned_staff_id', profileUserId).limit(1).maybeSingle(), 'staff ticket assignments', profileUserId),
        deletionQuery(supabaseAdmin.from('support_ticket_messages').select('id')
          .eq('sender_user_id', profileUserId).limit(1).maybeSingle(), 'staff message history', profileUserId),
      ]);
      if (ticket.data || message.data) {
        throw deletionConflict(
          'This staff account has assigned tickets or message history and cannot be deleted. Deactivate it to preserve the records.',
          profileUserId,
        );
      }
    }
    if (role === 'receptionist') {
      const [assignment, appointment, patientLink, appointmentHistory, workflowHistory] = await Promise.all([
        deletionQuery(supabaseAdmin.from('receptionist_clinics').select('clinic_id')
          .eq('receptionist_user_id', profileUserId), 'receptionist clinic assignments', profileUserId),
        deletionQuery(supabaseAdmin.from('appointments').select('id').or([
          `created_by_user_id.eq.${profileUserId}`, `updated_by_user_id.eq.${profileUserId}`,
          `workflow_updated_by_user_id.eq.${profileUserId}`, `cancellation_actor_user_id.eq.${profileUserId}`,
        ].join(',')).limit(1).maybeSingle(), 'receptionist appointment history', profileUserId),
        deletionQuery(supabaseAdmin.from('patient_clinics').select('patient_id')
          .eq('created_by_user_id', profileUserId).limit(1).maybeSingle(), 'receptionist patient history', profileUserId),
        deletionQuery(supabaseAdmin.from('appointment_history').select('id')
          .eq('actor_user_id', profileUserId).limit(1).maybeSingle(), 'receptionist appointment history', profileUserId),
        deletionQuery(supabaseAdmin.from('appointment_workflow_history').select('id')
          .eq('actor_user_id', profileUserId).limit(1).maybeSingle(), 'receptionist workflow history', profileUserId),
      ]);
      if (appointment.data || patientLink.data || appointmentHistory.data || workflowHistory.data) {
        throw deletionConflict(
          'This receptionist has appointment or patient-history records and cannot be deleted. Deactivate the account to preserve those records.',
          profileUserId,
        );
      }
      return await deleteAuthAccount(profileUserId, role, {
        clinicAssignmentsRemoved: assignment.data?.length || 0,
      });
    }
    return await deleteAuthAccount(profileUserId, role);
  } catch (error) {
    if (profileUserId && !error.profileUserId) error.profileUserId = profileUserId;
    throw error;
  }
}

export async function listAppointments(filters) {
  const [appointments, patients, doctors, users, clinics] = await Promise.all([
    rows('appointments'), rows('patients'), rows('doctors', doctorColumns), rows('users'), rows('clinics'),
  ]);
  const patientMap = byId(patients); const doctorMap = byId(doctors); const userMap = byId(users); const clinicMap = byId(clinics);
  const found = appointments.flatMap((appointment) => {
    const patient = patientMap.get(appointment.patient_id); const doctor = doctorMap.get(appointment.doctor_id);
    const patientUser = userMap.get(patient?.user_id); const doctorUser = userMap.get(doctor?.user_id);
    const clinic = clinicMap.get(doctor?.clinic_id);
    if ((filters.status && appointment.status !== filters.status) || (filters.doctorId && appointment.doctor_id !== filters.doctorId)
      || (filters.patientId && appointment.patient_id !== filters.patientId) || (filters.clinicId && doctor?.clinic_id !== filters.clinicId)
      || (filters.from && appointment.scheduled_start.slice(0, 10) < filters.from)
      || (filters.to && appointment.scheduled_start.slice(0, 10) > filters.to)
      || (filters.search && ![patientUser?.name, patientUser?.email, doctorUser?.name, clinic?.name].some((value) => matches(value, filters.search)))) return [];
    return [{
      id: appointment.id, scheduledStart: appointment.scheduled_start, scheduledEnd: appointment.scheduled_end,
      status: appointment.status, createdAt: appointment.created_at, cancelledAt: appointment.cancelled_at,
      patientUserId: patientUser?.id, patientName: patientUser?.name, patientEmail: patientUser?.email,
      patientId: patient?.id, doctorName: doctorUser?.name, doctorId: doctor?.id,
      clinicName: clinic?.name, clinicId: clinic?.id,
    }];
  }).sort((a, b) => b.scheduledStart.localeCompare(a.scheduledStart));
  return { records: paginate(found, filters.limit, filters.offset), total: found.length };
}

export async function getAppointment(appointmentId) {
  const { data: appointment } = await run(supabaseAdmin.from('appointments').select('*').eq('id', appointmentId).maybeSingle());
  if (!appointment) return null;
  const [patients, doctors, users, clinics] = await Promise.all([
    rows('patients'), rows('doctors', doctorColumns), rows('users'), rows('clinics'),
  ]);
  const patient = byId(patients).get(appointment.patient_id); const doctor = byId(doctors).get(appointment.doctor_id);
  const userMap = byId(users); const clinic = byId(clinics).get(doctor?.clinic_id);
  const cancelActor = userMap.get(appointment.cancellation_actor_user_id);
  return {
    id: appointment.id, scheduledStart: appointment.scheduled_start, scheduledEnd: appointment.scheduled_end,
    status: appointment.status, reason: appointment.reason, fee: appointment.consultation_fee_snapshot,
    createdAt: appointment.created_at, cancelledAt: appointment.cancelled_at, cancelledBy: cancelActor?.name,
    patientName: userMap.get(patient?.user_id)?.name, patientEmail: userMap.get(patient?.user_id)?.email,
    patientId: patient?.id, doctorName: userMap.get(doctor?.user_id)?.name, doctorId: doctor?.id,
    doctorEmail: userMap.get(doctor?.user_id)?.email, clinicName: clinic?.name, clinicId: clinic?.id,
  };
}

export async function getReportLookups() {
  const [clinics, specialties, doctors, users] = await Promise.all([
    rows('clinics', 'id,name,is_active'),
    rows('specialties', 'id,name'),
    rows('doctors', 'id,user_id,clinic_id,primary_specialty_id'),
    rows('users', 'id,name,role'),
  ]);
  const userMap = byId(users);
  return {
    clinics: clinics.map(({ id, name, is_active }) => ({ id, name, isActive: is_active }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    specialties: specialties.map(({ id, name }) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    doctors: doctors.map((doctor) => ({
      id: doctor.id, name: userMap.get(doctor.user_id)?.name || 'Unknown doctor',
      clinicId: doctor.clinic_id, primarySpecialtyId: doctor.primary_specialty_id,
    })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function invalidReportFilter(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

function reportDateRange({ from, to }) {
  const start = `${from}T00:00:00.000Z`;
  const end = new Date(`${to}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end: end.toISOString() };
}

function filterReportStatus(query, status) {
  if (!status) return query;
  if (status === 'no_show') return query.eq('workflow_status', 'no_show');
  if (status === 'completed') return query.or('status.eq.completed,workflow_status.eq.completed');
  if (status === 'confirmed') {
    return query.eq('status', 'confirmed').not('workflow_status', 'in', '(completed,no_show)');
  }
  return query.eq('status', status);
}

function chunks(items, size = 100) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function rowsByIds(table, columns, ids) {
  const found = [];
  for (const idChunk of chunks([...new Set(ids)])) {
    found.push(...await pagedRows(() => supabaseAdmin.from(table).select(columns).in('id', idChunk)));
  }
  return found;
}

export async function getReports(filters) {
  const { start, end } = reportDateRange(filters);
  const [clinicRows, specialtyRows] = await Promise.all([
    rows('clinics', 'id,name'),
    rows('specialties', 'id,name'),
  ]);
  if (filters.clinicId && !clinicRows.some((clinic) => clinic.id === filters.clinicId)) {
    invalidReportFilter('The selected clinic does not exist.');
  }
  if (filters.specialtyId && !specialtyRows.some((specialty) => specialty.id === filters.specialtyId)) {
    invalidReportFilter('The selected specialty does not exist.');
  }

  let doctorQuery = supabaseAdmin.from('doctors')
    .select('id,user_id,clinic_id,primary_specialty_id');
  if (filters.doctorId) doctorQuery = doctorQuery.eq('id', filters.doctorId);
  if (filters.clinicId) doctorQuery = doctorQuery.eq('clinic_id', filters.clinicId);
  if (filters.specialtyId) doctorQuery = doctorQuery.eq('primary_specialty_id', filters.specialtyId);
  const doctors = await pagedRows(() => doctorQuery);
  if (filters.doctorId && !doctors.length) invalidReportFilter('The selected doctor does not match the selected clinic or specialty.');
  const doctorIds = doctors.map((doctor) => doctor.id);
  const usesDoctorFilter = Boolean(filters.doctorId || filters.clinicId || filters.specialtyId);
  const doctorChunks = usesDoctorFilter ? chunks(doctorIds) : [null];
  const appointments = [];
  for (const doctorChunk of doctorChunks) {
    let query = supabaseAdmin.from('appointments')
      .select('id,doctor_id,scheduled_start,scheduled_end,status,workflow_status,is_walk_in')
      .gte('scheduled_start', start).lt('scheduled_start', end);
    if (doctorChunk) query = query.in('doctor_id', doctorChunk);
    query = filterReportStatus(query, filters.status).order('scheduled_start', { ascending: true });
    appointments.push(...await pagedRows(() => query));
  }
  appointments.sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));
  const doctorUserIds = [...new Set(doctors.map((doctor) => doctor.user_id))];
  const users = [];
  for (const userIdChunk of chunks(doctorUserIds)) {
    users.push(...await pagedRows(() => supabaseAdmin.from('users').select('id,name').in('id', userIdChunk)));
  }
  const cancellationEvents = [];
  if (!filters.status || filters.status === 'cancelled') {
    const cancellationChunks = usesDoctorFilter ? chunks(doctorIds) : [null];
    for (const doctorChunk of cancellationChunks) {
      let cancellationQuery = supabaseAdmin.from('appointments')
        .select('id,doctor_id,cancelled_at,status,workflow_status')
        .eq('status', 'cancelled')
        .not('cancelled_at', 'is', null)
        .gte('cancelled_at', start)
        .lt('cancelled_at', end);
      if (doctorChunk) cancellationQuery = cancellationQuery.in('doctor_id', doctorChunk);
      cancellationEvents.push(...await pagedRows(() => cancellationQuery));
    }
  }

  let historyQuery = supabaseAdmin.from('appointment_history')
    .select('appointment_id,changed_at,status,workflow_status')
    .eq('event_type', 'rescheduled')
    .gte('changed_at', start)
    .lt('changed_at', end);
  historyQuery = filterReportStatus(historyQuery, filters.status);
  const historyEvents = await pagedRows(() => historyQuery);
  const historyAppointmentIds = [...new Set(historyEvents.map((event) => event.appointment_id))];
  let historyAppointments = [];
  for (const appointmentChunk of chunks(historyAppointmentIds)) {
    historyAppointments.push(...await pagedRows(() => supabaseAdmin.from('appointments')
      .select('id,doctor_id').in('id', appointmentChunk)));
  }
  const allowedDoctorIds = new Set(doctorIds);
  const matchingHistoryIds = new Set(historyAppointments
    .filter((appointment) => !usesDoctorFilter || allowedDoctorIds.has(appointment.doctor_id))
    .map((appointment) => appointment.id));
  const rescheduleEvents = historyEvents.filter((event) => matchingHistoryIds.has(event.appointment_id));
  const selectedClinics = filters.clinicId
    ? clinicRows.filter((clinic) => clinic.id === filters.clinicId)
    : clinicRows;
  const selectedSpecialties = filters.specialtyId
    ? specialtyRows.filter((specialty) => specialty.id === filters.specialtyId)
    : specialtyRows;
  return aggregateAdminReport({
    appointments,
    doctors,
    users,
    clinics: selectedClinics,
    specialties: selectedSpecialties,
    rescheduleEvents,
    cancellationEvents,
    filters,
  });
}

export async function listActivityLogs(filters) {
  const [logs, users] = await Promise.all([rows('admin_activity_logs'), rows('users')]);
  const userMap = byId(users);
  const found = logs.flatMap((item) => {
    const actor = userMap.get(item.actor_user_id);
    if ((filters.role && item.actor_role !== filters.role) || (filters.eventType && item.event_type !== filters.eventType)
      || (filters.success !== '' && item.success !== (filters.success === 'true'))
      || (filters.from && item.occurred_at.slice(0, 10) < filters.from) || (filters.to && item.occurred_at.slice(0, 10) > filters.to)
      || (filters.search && !matches(actor?.name || item.attempted_email, filters.search))) return [];
    return [{
      id: item.id, actorUserId: item.actor_user_id, actorName: actor?.name, actorRole: item.actor_role,
      targetUserId: item.target_user_id, attemptedEmail: item.attempted_email, eventType: item.event_type,
      success: item.success, occurredAt: item.occurred_at, ipAddress: item.ip_address,
      userAgent: item.user_agent, details: item.details, createdAt: item.occurred_at,
    }];
  }).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return { records: paginate(found, filters.limit, filters.offset), total: found.length };
}

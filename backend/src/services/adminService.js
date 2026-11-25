import * as adminRepository from '../repositories/adminRepository.js';
import { recordActivity } from './auditService.js';

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function notFound() {
  return httpError('The requested record was not found.', 404);
}

async function validateReferences(references) {
  if (!await adminRepository.validateReferences(references)) {
    throw httpError('One or more selected clinics, specialties, or doctors are not active or do not exist.', 400);
  }
}

export async function getDashboard() {
  return adminRepository.getDashboard();
}

export async function listPatients(filters) {
  return adminRepository.listPatients(filters);
}

export async function getPatient(patientId) {
  const patient = await adminRepository.getPatient(patientId);
  if (!patient) throw notFound();
  return patient;
}

export async function updatePatient(patientId, payload, actor, request) {
  const patient = await adminRepository.updatePatient(patientId, payload);
  if (!patient) throw notFound();
  await recordActivity({
    actor,
    targetUserId: patient.id,
    eventType: 'patient.updated',
    request,
    details: { patientId: patient.patientId, isActive: patient.isActive },
  });
  return patient;
}

export async function listDoctors(filters) {
  return adminRepository.listDoctors(filters);
}

export async function getDoctor(doctorId) {
  const doctor = await adminRepository.getDoctor(doctorId);
  if (!doctor) throw notFound();
  return doctor;
}

export async function createDoctor(payload, actor, request) {
  await validateReferences({ clinicId: payload.clinicId, specialtyIds: [payload.primarySpecialtyId] });
  const doctor = await adminRepository.createDoctor({
    ...payload,
  });
  await recordActivity({
    actor, targetUserId: doctor.userId, eventType: 'doctor.created', request,
    details: { doctorId: doctor.id },
  });
  return { id: doctor.id };
}

export async function updateDoctor(doctorId, payload, actor, request) {
  await validateReferences({ clinicId: payload.clinicId, specialtyIds: [payload.primarySpecialtyId] });
  const doctor = await adminRepository.updateDoctor(doctorId, payload);
  if (!doctor) throw notFound();
  const detail = await adminRepository.getDoctor(doctorId);
  await recordActivity({
    actor, targetUserId: detail.userId, eventType: 'doctor.updated', request,
    details: { doctorId, isActive: payload.isActive, acceptingAppointments: payload.acceptingAppointments },
  });
  return detail;
}

export async function deleteDoctor(doctorId, actor, request) {
  const deleted = await adminRepository.deleteDoctor(doctorId);
  if (!deleted) throw httpError('Doctor profile row was not found.', 404);
  await recordActivity({
    actor, eventType: 'doctor.deleted', request,
    details: { doctorId, userId: deleted.id },
  });
  return deleted;
}

export async function listClinics(filters) {
  return adminRepository.listClinics(filters);
}

export async function saveClinic(clinicId, payload, actor, request) {
  const clinic = await adminRepository.saveClinic(clinicId, payload);
  if (!clinic) throw notFound();
  await recordActivity({
    actor, eventType: clinicId ? 'clinic.updated' : 'clinic.created', request,
    details: { clinicId: clinic.id, isActive: clinic.isActive },
  });
  return clinic;
}

export async function listSpecialties(filters) {
  return adminRepository.listSpecialties(filters);
}

export async function saveSpecialty(specialtyId, payload, actor, request) {
  const specialty = await adminRepository.saveSpecialty(specialtyId, payload);
  if (!specialty) throw notFound();
  await recordActivity({
    actor, eventType: specialtyId ? 'specialty.updated' : 'specialty.created', request,
    details: { specialtyId: specialty.id },
  });
  return specialty;
}

export async function deleteSpecialty(specialtyId, actor, request) {
  const specialty = await adminRepository.deleteSpecialty(specialtyId);
  if (!specialty) throw notFound();
  if (specialty.inUse) {
    throw httpError('This specialty is assigned to one or more doctors and cannot be deleted.', 409);
  }
  await recordActivity({
    actor, eventType: 'specialty.deleted', request,
    details: { specialtyId: specialty.id, name: specialty.name },
  });
  return specialty;
}

export async function listServices(filters) {
  return adminRepository.listServices(filters);
}

export async function saveService(serviceId, payload, actor, request) {
  await validateReferences({ clinicIds: payload.clinicIds, doctorIds: payload.doctorIds });
  const service = await adminRepository.saveService(serviceId, payload);
  if (!service) throw notFound();
  await recordActivity({
    actor, eventType: serviceId ? 'service.updated' : 'service.created', request,
    details: { serviceId: service.id, isActive: payload.isActive ?? true },
  });
  return service;
}

export async function listAccounts(role, filters) {
  return adminRepository.listAccounts(role, filters);
}

export async function listAdmins(filters) {
  return adminRepository.listAccounts('admin', filters);
}

export async function createAdmin(payload, actor, request) {
  const account = await adminRepository.createAccount({ ...payload, role: 'admin' });
  await recordActivity({
    actor, targetUserId: account.id, request, eventType: 'admin.created',
    details: { isSuperAdmin: false },
  });
  return account;
}

export async function updateAdmin(userId, payload, actor, request) {
  if (actor.id === userId) {
    throw httpError('You cannot edit your own administrator account here.', 409);
  }
  const account = await adminRepository.updateAccount(userId, 'admin', payload);
  if (!account) throw notFound();
  await recordActivity({
    actor, targetUserId: account.id, request, eventType: 'admin.updated',
    details: { isActive: account.isActive },
  });
  return account;
}

export async function deleteAdmin(userId, actor, request) {
  if (actor.id === userId) {
    throw httpError('You cannot delete your own administrator account.', 409);
  }
  const deleted = await adminRepository.deleteAccount(userId, 'admin');
  if (!deleted) throw httpError('The regular admin account was not found.', 404);
  await recordActivity({
    actor, request, eventType: 'admin.deleted',
    details: { userId },
  });
  return deleted;
}

export async function createAccount(role, payload, actor, request) {
  if (role === 'receptionist') await validateReferences({ clinicIds: payload.clinicIds });
  const account = await adminRepository.createAccount({
    ...payload,
    role,
  });
  await recordActivity({
    actor, targetUserId: account.id, request,
    eventType: `${role}.created`,
    details: { role },
  });
  return account;
}

export async function updateAccount(role, userId, payload, actor, request) {
  if (actor.id === userId && !payload.isActive) {
    throw httpError('You cannot deactivate your own administrator account.', 409);
  }
  if (role === 'receptionist') await validateReferences({ clinicIds: payload.clinicIds });
  const account = await adminRepository.updateAccount(userId, role, payload);
  if (!account) throw notFound();
  await recordActivity({
    actor, targetUserId: account.id, request,
    eventType: `${role}.updated`,
    details: { role, isActive: account.isActive },
  });
  return account;
}

export async function getAccount(role, userId) {
  const account = await adminRepository.getAccount(userId, role);
  if (!account) throw notFound();
  return account;
}

export async function deleteAccount(role, userId, actor, request) {
  const deleted = await adminRepository.deleteAccount(userId, role);
  if (!deleted) throw httpError(`The ${role} profile row was not found.`, 404);
  await recordActivity({
    actor, eventType: `${role}.deleted`, request,
    details: {
      userId,
      ...(deleted.clinicAssignmentsRemoved ? { clinicAssignmentsRemoved: deleted.clinicAssignmentsRemoved } : {}),
    },
  });
  return deleted;
}

export async function listAppointments(filters) {
  return adminRepository.listAppointments(filters);
}

export async function getAppointment(appointmentId) {
  const appointment = await adminRepository.getAppointment(appointmentId);
  if (!appointment) throw notFound();
  return appointment;
}

export async function getReports(filters) {
  return adminRepository.getReports(filters);
}

export async function getReportLookups() {
  return adminRepository.getReportLookups();
}

export async function listActivityLogs(filters) {
  return adminRepository.listActivityLogs(filters);
}

export async function getLookups() {
  return adminRepository.getLookups();
}

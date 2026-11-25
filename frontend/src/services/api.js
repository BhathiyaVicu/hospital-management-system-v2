const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const ACCESS_TOKEN_KEY = 'mediconnect_access_token';
const REFRESH_TOKEN_KEY = 'mediconnect_refresh_token';
let refreshPromise = null;
let refreshTimer = null;

export function getAccessToken() {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  if (token && !refreshTimer) scheduleSessionRefresh(token);
  return token;
}

export function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

function tokenExpiry(token) {
  try {
    const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded));
    return Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function scheduleSessionRefresh(token) {
  if (refreshTimer) clearTimeout(refreshTimer);
  if (!getRefreshToken()) {
    refreshTimer = null;
    return;
  }
  const expiresAt = tokenExpiry(token);
  if (!expiresAt) return;
  const delay = Math.max(1000, expiresAt - Date.now() - 60_000);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshAuthSession().catch((error) => {
      if (error.status === 401) {
        window.dispatchEvent(new CustomEvent('auth:session-expired'));
      } else {
        console.error('Unable to refresh the Supabase session:', error);
      }
    });
  }, delay);
}

export function setAccessToken(token, refreshToken) {
  if (token) {
    localStorage.setItem(ACCESS_TOKEN_KEY, token);
    if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    scheduleSessionRefresh(token);
  } else {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

async function readPayload(response) {
  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('application/json') ? response.json() : response.text();
}

export async function refreshAuthSession() {
  if (refreshPromise) return refreshPromise;
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  refreshPromise = (async () => {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    const payload = await readPayload(response);
    if (!response.ok || !payload?.token || !payload?.refreshToken) {
      const error = new Error(typeof payload === 'string' ? payload : payload?.message || 'Session refresh failed.');
      error.status = response.status;
      if (response.status === 400 || response.status === 401) setAccessToken(null);
      throw error;
    }
    setAccessToken(payload.token, payload.refreshToken);
    window.dispatchEvent(new CustomEvent('auth:session-changed'));
    return payload.token;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function request(endpoint, options = {}) {
  const method = options.method || 'GET';
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  let token = getAccessToken();
  const authPublicEndpoint = ['/auth/login', '/auth/refresh'].includes(endpoint);
  const expiresAt = token ? tokenExpiry(token) : null;
  if (token && !authPublicEndpoint && expiresAt && expiresAt <= Date.now() + 60_000 && getRefreshToken()) {
    try {
      token = await refreshAuthSession();
    } catch (error) {
      if (error.status === 401 && endpoint !== '/auth/me') {
        window.dispatchEvent(new CustomEvent('auth:session-expired'));
      }
      throw error;
    }
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  const sendRequest = (accessToken) => fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    method,
    headers: {
      ...headers,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });
  let response = await sendRequest(token);
  if (response.status === 401 && !authPublicEndpoint && getRefreshToken()) {
    try {
      token = await refreshAuthSession();
      response = await sendRequest(token);
    } catch (error) {
      if (error.status === 401 && endpoint !== '/auth/me') {
        window.dispatchEvent(new CustomEvent('auth:session-expired'));
      }
      throw error;
    }
  }
  if (response.status === 401) {
    setAccessToken(null);
    if (!['/auth/login', '/auth/me'].includes(endpoint)) {
      window.dispatchEvent(new CustomEvent('auth:session-expired'));
    }
  }
  const payload = await readPayload(response);

  if (!response.ok) {
    const message = typeof payload === 'string' ? payload : payload?.message || 'Request failed.';
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return payload;
}

export function getDoctors(filters = '') {
  const params = new URLSearchParams();
  if (typeof filters === 'string') {
    if (filters) params.set('specialty', filters);
  } else {
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, value);
    });
  }
  return request(`/doctors${params.size ? `?${params.toString()}` : ''}`);
}

export function getDoctor(id) {
  return request(`/doctors/${encodeURIComponent(id)}`);
}

export function getSpecialties() {
  return request('/specialties');
}

export function getClinics() {
  return request('/clinics');
}

export function registerUser(payload) {
  return request('/auth/register', { method: 'POST', body: JSON.stringify(payload) });
}

export function loginUser(payload) {
  return request('/auth/login', { method: 'POST', body: JSON.stringify(payload) }).then((result) => {
    const token = result.token || result.access_token;
    if (!token || !result.refreshToken) throw new Error('Authentication response did not include a complete Supabase session.');
    setAccessToken(token, result.refreshToken);
    window.dispatchEvent(new CustomEvent('auth:session-changed'));
    return result;
  });
}

export async function logoutUser() {
  try {
    return await request('/auth/logout', { method: 'POST' });
  } finally {
    setAccessToken(null);
    window.dispatchEvent(new CustomEvent('auth:session-changed'));
  }
}

export function getCurrentUser() {
  return request('/auth/me');
}

export function changePassword(payload) {
  return request('/auth/change-password', { method: 'POST', body: JSON.stringify(payload) });
}

export function completeFirstLogin() {
  return request('/auth/complete-first-login', { method: 'POST' });
}

export function getAdminDashboard() {
  return request('/admin/dashboard');
}

export function getAdminLookups() {
  return request('/admin/lookups');
}

function adminList(resource, filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, value);
  });
  return request(`/admin/${resource}${params.size ? `?${params.toString()}` : ''}`);
}

export function getAdminPatients(filters) { return adminList('patients', filters); }
export function getAdminPatient(id) { return request(`/admin/patients/${encodeURIComponent(id)}`); }
export function updateAdminPatient(id, payload) {
  return request(`/admin/patients/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
}
export function getAdminDoctors(filters) { return adminList('doctors', filters); }
export function getAdminDoctor(id) { return request(`/admin/doctors/${encodeURIComponent(id)}`); }
export function createAdminDoctor(payload) {
  return request('/admin/doctors', { method: 'POST', body: JSON.stringify(payload) });
}
export function updateAdminDoctor(id, payload) {
  return request(`/admin/doctors/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
}
export function deleteAdminDoctor(id) {
  return request(`/admin/doctors/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
export function getAdminClinics(filters) { return adminList('clinics', filters); }
export function createAdminClinic(payload) {
  return request('/admin/clinics', { method: 'POST', body: JSON.stringify(payload) });
}
export function updateAdminClinic(id, payload) {
  return request(`/admin/clinics/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
}
export function getAdminStaff(filters) { return adminList('staff', filters); }
export function getAdminStaffDetail(id) { return request(`/admin/staff/${encodeURIComponent(id)}`); }
export function createAdminStaff(payload) {
  return request('/admin/staff', { method: 'POST', body: JSON.stringify(payload) });
}
export function updateAdminStaff(id, payload) {
  return request(`/admin/staff/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
}
export function deleteAdminStaff(id) {
  return request(`/admin/staff/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
export function getAdminAdmins(filters) { return adminList('admins', filters); }
export function createAdminAdmin(payload) {
  return request('/admin/admins', { method: 'POST', body: JSON.stringify(payload) });
}
export function updateAdminAdmin(id, payload) {
  return request(`/admin/admins/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
}
export function deleteAdminAdmin(id) {
  return request(`/admin/admins/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
export function getAdminReceptionists(filters) { return adminList('receptionists', filters); }
export function getAdminReceptionistDetail(id) { return request(`/admin/receptionists/${encodeURIComponent(id)}`); }
export function createAdminReceptionist(payload) {
  return request('/admin/receptionists', { method: 'POST', body: JSON.stringify(payload) });
}
export function updateAdminReceptionist(id, payload) {
  return request(`/admin/receptionists/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
}
export function deleteAdminReceptionist(id) {
  return request(`/admin/receptionists/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
export function getAdminSpecialties(filters) { return adminList('specialties', filters); }
export function createAdminSpecialty(payload) {
  return request('/admin/specialties', { method: 'POST', body: JSON.stringify(payload) });
}
export function updateAdminSpecialty(id, payload) {
  return request(`/admin/specialties/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
}
export function deleteAdminSpecialty(id) {
  return request(`/admin/specialties/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
export function getAdminAppointments(filters) { return adminList('appointments', filters); }
export function getAdminAppointment(id) { return request(`/admin/appointments/${encodeURIComponent(id)}`); }
export function getAdminReports(filters) { return adminList('reports', filters); }
export function getAdminReportLookups() { return request('/admin/reports/lookups'); }
export function getAdminActivityLogs(filters) { return adminList('activity-logs', filters); }
export function getAdminSupportTickets(filters) { return adminList('support/tickets', filters); }
export function getAdminSupportTicket(id) { return request(`/admin/support/tickets/${encodeURIComponent(id)}`); }
export function getAdminSupportStaff() { return request('/admin/support/staff'); }
export function replyToAdminSupportTicket(id, message) {
  return request(`/admin/support/tickets/${encodeURIComponent(id)}/messages`, { method: 'POST', body: JSON.stringify({ message }) });
}
export function updateAdminSupportTicketStatus(id, status) {
  return request(`/admin/support/tickets/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
}
export function assignAdminSupportTicket(id, assignedStaffId) {
  return request(`/admin/support/tickets/${encodeURIComponent(id)}/assignment`, { method: 'PATCH', body: JSON.stringify({ assignedStaffId }) });
}
export function getAdminScheduleDoctors() { return request('/admin/schedules/doctors'); }
export function getAdminSchedules(filters = {}) { return adminList('schedules', filters); }
export function getAdminDoctorCalendar(doctorId, filters = {}) {
  const params = new URLSearchParams({ ...filters, doctorId });
  return request(`/admin/schedules/calendar?${params.toString()}`);
}
export function saveAdminDoctorDateSchedule(doctorId, date, payload) {
  return request(`/admin/schedules/dates/${encodeURIComponent(date)}?doctorId=${encodeURIComponent(doctorId)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}
export function createAdminWeeklySchedule(payload) {
  return request('/admin/schedules/weekly', { method: 'POST', body: JSON.stringify(payload) });
}
export function updateAdminWeeklySchedule(id, payload) {
  return request(`/admin/schedules/weekly/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
}
export function createAdminScheduleException(payload) {
  return request('/admin/schedules/exceptions', { method: 'POST', body: JSON.stringify(payload) });
}
export function updateAdminScheduleException(id, payload) {
  return request(`/admin/schedules/exceptions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
}
export function deleteAdminScheduleException(id) {
  return request(`/admin/schedules/exceptions/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

function workspaceList(path, filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, value);
  });
  return request(`${path}${params.size ? `?${params.toString()}` : ''}`);
}

export function getDoctorWorkspaceDashboard() { return request('/doctor/dashboard'); }
export function getDoctorWorkspaceProfile() { return request('/doctor/profile'); }
export function updateDoctorWorkspaceProfile(payload) {
  return request('/doctor/profile', { method: 'PATCH', body: JSON.stringify(payload) });
}
export function getDoctorWorkspaceAppointments(filters = {}) { return workspaceList('/doctor/appointments', filters); }
export function getDoctorWorkspaceAppointment(id) { return request(`/doctor/appointments/${encodeURIComponent(id)}`); }
export function updateDoctorAppointmentWorkflow(id, workflowStatus) {
  return request(`/doctor/appointments/${encodeURIComponent(id)}/workflow`, {
    method: 'PATCH', body: JSON.stringify({ workflowStatus }),
  });
}
export function getDoctorConsultation(id) { return request(`/doctor/appointments/${encodeURIComponent(id)}/consultation`); }
export function saveDoctorConsultation(id, payload) {
  return request(`/doctor/appointments/${encodeURIComponent(id)}/consultation`, { method: 'PUT', body: JSON.stringify(payload) });
}
export function getDoctorWorkspaceSchedules(filters = {}) { return workspaceList('/doctor/schedules', filters); }
export function getDoctorScheduleCalendar(filters = {}) { return workspaceList('/doctor/schedules/calendar', filters); }
export function saveDoctorDateSchedule(date, payload) {
  return request(`/doctor/schedules/dates/${encodeURIComponent(date)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}
export function createDoctorWeeklySchedule(payload) {
  return request('/doctor/schedules/weekly', { method: 'POST', body: JSON.stringify(payload) });
}
export function updateDoctorWeeklySchedule(id, payload) {
  return request(`/doctor/schedules/weekly/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
}
export function createDoctorScheduleException(payload) {
  return request('/doctor/schedules/exceptions', { method: 'POST', body: JSON.stringify(payload) });
}
export function updateDoctorScheduleException(id, payload) {
  return request(`/doctor/schedules/exceptions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
}
export function deleteDoctorScheduleException(id) {
  return request(`/doctor/schedules/exceptions/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function getReceptionistDashboard() { return request('/receptionist/dashboard'); }
export function getReceptionistProfile() { return request('/receptionist/profile'); }
export function updateReceptionistProfile(payload) {
  return request('/receptionist/profile', { method: 'PATCH', body: JSON.stringify(payload) });
}
export function getReceptionistClinics() { return request('/receptionist/clinics'); }
export function getReceptionistPatients(filters = {}) { return workspaceList('/receptionist/patients', filters); }
export function registerReceptionistPatient(payload) {
  return request('/receptionist/patients', { method: 'POST', body: JSON.stringify(payload) });
}
export function linkReceptionistPatient(payload) {
  return request('/receptionist/patients/link', { method: 'POST', body: JSON.stringify(payload) });
}
export function updateReceptionistPatient(id, payload) {
  return request(`/receptionist/patients/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
}
export function getReceptionistDoctors(clinicId) {
  return workspaceList('/receptionist/doctors', { clinicId });
}
export function getReceptionistDoctorSlots(doctorId, clinicId, date) {
  return workspaceList(`/receptionist/doctors/${encodeURIComponent(doctorId)}/slots`, { clinicId, date });
}
export function getReceptionistAppointments(filters = {}) { return workspaceList('/receptionist/appointments', filters); }
export function getReceptionistAppointment(id) { return request(`/receptionist/appointments/${encodeURIComponent(id)}`); }
export function createReceptionistAppointment(payload) {
  return request('/receptionist/appointments', { method: 'POST', body: JSON.stringify(payload) });
}
export function rescheduleReceptionistAppointment(id, payload) {
  return request(`/receptionist/appointments/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
}
export function cancelReceptionistAppointment(id) {
  return request(`/receptionist/appointments/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
}
export function updateReceptionistAppointmentWorkflow(id, workflowStatus) {
  return request(`/receptionist/appointments/${encodeURIComponent(id)}/workflow`, {
    method: 'PATCH', body: JSON.stringify({ workflowStatus }),
  });
}

export function getPatientProfile() {
  return request('/patients/me');
}

export function updatePatientProfile(payload) {
  return request('/patients/me', { method: 'PATCH', body: JSON.stringify(payload) });
}

export function getPatientDashboard() {
  return request('/patients/me/dashboard');
}

export function forgotPassword(payload) {
  return request('/auth/forgot-password', { method: 'POST', body: JSON.stringify(payload) });
}

export function resetPassword(payload) {
  return request('/auth/reset-password', { method: 'POST', body: JSON.stringify(payload) });
}

export function verifyEmail(payload) {
  if (payload.accessToken) {
    setAccessToken(payload.accessToken);
    window.dispatchEvent(new CustomEvent('auth:session-changed'));
  }
  return request('/auth/verify-email', { method: 'POST', body: JSON.stringify(payload) });
}

export function resendVerification(payload) {
  return request('/auth/resend-verification', { method: 'POST', body: JSON.stringify(payload) });
}

export function getNotifications() {
  return request('/notifications');
}

export function markNotificationRead(id) {
  return request(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
}

export function markAllNotificationsRead() {
  return request('/notifications/read-all', { method: 'PATCH' });
}

export function getAvailability(doctorId) {
  return request(`/doctors/${encodeURIComponent(doctorId)}/availability`);
}

export function bookAppointment(payload) {
  return request('/appointments', { method: 'POST', body: JSON.stringify(payload) });
}

export function getMyAppointments(filters = {}) {
  const params = new URLSearchParams(filters);
  return request(`/appointments${params.size ? `?${params.toString()}` : ''}`);
}

export function getAppointment(appointmentId) {
  return request(`/appointments/${encodeURIComponent(appointmentId)}`);
}

export function cancelAppointment(appointmentId) {
  return request(`/appointments/${encodeURIComponent(appointmentId)}/cancel`, { method: 'PATCH' });
}

export function rescheduleAppointment(appointmentId, payload) {
  return request(`/appointments/${encodeURIComponent(appointmentId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function getPatientTickets(filters = {}) {
  const params = new URLSearchParams(filters);
  return request(`/support/tickets${params.size ? `?${params.toString()}` : ''}`);
}

export function createPatientTicket(payload) {
  return request('/support/tickets', { method: 'POST', body: JSON.stringify(payload) });
}

export function getPatientTicket(ticketId) {
  return request(`/support/tickets/${encodeURIComponent(ticketId)}`);
}

export function replyToPatientTicket(ticketId, message) {
  return request(`/support/tickets/${encodeURIComponent(ticketId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

export function getStaffSupportDashboard() {
  return request('/staff/support/dashboard');
}

export function getStaffTickets(filters = {}) {
  const params = new URLSearchParams(filters);
  return request(`/staff/support/tickets${params.size ? `?${params.toString()}` : ''}`);
}

export function getStaffTicket(ticketId) {
  return request(`/staff/support/tickets/${encodeURIComponent(ticketId)}`);
}

export function replyToStaffTicket(ticketId, message) {
  return request(`/staff/support/tickets/${encodeURIComponent(ticketId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

export function updateStaffTicketStatus(ticketId, status) {
  return request(`/staff/support/tickets/${encodeURIComponent(ticketId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function updateStaffTicketAssignment(ticketId, assignedStaffId) {
  return request(`/staff/support/tickets/${encodeURIComponent(ticketId)}/assignment`, {
    method: 'PATCH',
    body: JSON.stringify({ assignedStaffId }),
  });
}

export function getSupportStaff() {
  return request('/staff/support/staff');
}

export default {
  getDoctors,
  getDoctor,
  getSpecialties,
  getClinics,
  registerUser,
  loginUser,
  logoutUser,
  getCurrentUser,
  getNotifications,
  markNotificationRead,
  getPatientProfile,
  updatePatientProfile,
  getPatientDashboard,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
  getAvailability,
  bookAppointment,
  getMyAppointments,
  getAppointment,
  cancelAppointment,
  rescheduleAppointment,
  getPatientTickets,
  createPatientTicket,
  getPatientTicket,
  replyToPatientTicket,
  getStaffSupportDashboard,
  getStaffTickets,
  getStaffTicket,
  replyToStaffTicket,
  updateStaffTicketStatus,
  updateStaffTicketAssignment,
  getSupportStaff,
};

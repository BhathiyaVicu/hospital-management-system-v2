import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { run, rows, paginate, byId, matches } from './supabaseHelpers.js';

async function ticketView(ticket, includeMessages = false, includePatientEmail = false) {
  const [patientResult, patients, users, appointments, doctors, messages] = await Promise.all([
    run(supabaseAdmin.from('patients').select('*').eq('id', ticket.patient_id).maybeSingle()),
    rows('patients'), rows('users'), rows('appointments'), rows('doctors'),
    includeMessages ? run(supabaseAdmin.from('support_ticket_messages').select('*')
      .eq('ticket_id', ticket.id).order('created_at', { ascending: true })) : Promise.resolve({ data: [] }),
  ]);
  const patient = patientResult.data || byId(patients).get(ticket.patient_id);
  const userMap = byId(users);
  const appointment = appointments.find((item) => item.id === ticket.appointment_id);
  const doctor = byId(doctors).get(appointment?.doctor_id);
  const account = userMap.get(patient?.user_id);
  const assigned = userMap.get(ticket.assigned_staff_id);
  const output = {
    id: ticket.id, ticketNumber: ticket.ticket_number, patientId: ticket.patient_id,
    assignedStaffId: ticket.assigned_staff_id, appointmentId: ticket.appointment_id,
    category: ticket.category, priority: ticket.priority, subject: ticket.subject, status: ticket.status,
    resolvedAt: ticket.resolved_at, closedAt: ticket.closed_at, createdAt: ticket.created_at, updatedAt: ticket.updated_at,
    patientName: account?.name, assignedStaffName: assigned?.name,
    appointmentStart: appointment?.scheduled_start, appointmentDoctorName: userMap.get(doctor?.user_id)?.name,
    ...(includePatientEmail ? { patientEmail: account?.email, patientUserId: account?.id } : {}),
  };
  if (includeMessages) {
    const messagesData = messages.data || [];
    output.messages = messagesData.map((message) => ({
      id: message.id, message: message.message, createdAt: message.created_at,
      senderId: message.sender_user_id, senderName: userMap.get(message.sender_user_id)?.name,
      senderRole: userMap.get(message.sender_user_id)?.role,
    }));
    output.patientUserId = account?.id;
  }
  return output;
}

export async function createPatientTicket({ patientId, userId, category, priority, subject, message, appointmentId }) {
  if (appointmentId) {
    const { data: appointment } = await run(supabaseAdmin.from('appointments').select('id')
      .eq('id', appointmentId).eq('patient_id', patientId).maybeSingle());
    if (!appointment) return { invalidAppointment: true };
  }
  const ticketNumber = `MC-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const { data: created } = await run(supabaseAdmin.from('support_tickets').insert({
    ticket_number: ticketNumber, patient_id: patientId, appointment_id: appointmentId || null,
    category, priority, subject,
  }).select('*').single());
  await run(supabaseAdmin.from('support_ticket_messages').insert({
    ticket_id: created.id, sender_user_id: userId, message,
  }));
  return { ticket: await ticketView(created, true) };
}

export async function listTickets(filters, staffView = null) {
  const [tickets, patients, users, appointments, doctors, messages] = await Promise.all([
    rows('support_tickets'), rows('patients'), rows('users'), rows('appointments'), rows('doctors'), rows('support_ticket_messages'),
  ]);
  const patientMap = byId(patients); const userMap = byId(users);
  const appointmentMap = byId(appointments); const doctorMap = byId(doctors);
  const found = tickets.filter((ticket) => {
    const patientName = userMap.get(patientMap.get(ticket.patient_id)?.user_id)?.name;
    return (!filters.patientId || ticket.patient_id === filters.patientId)
      && (!filters.status || ticket.status === filters.status)
      && (!filters.category || ticket.category === filters.category)
      && (!filters.search || matches(ticket.ticket_number, filters.search) || matches(ticket.subject, filters.search) || matches(patientName, filters.search))
      && (!staffView || !ticket.assigned_staff_id || ticket.assigned_staff_id === staffView);
  }).sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
  const result = paginate(found, filters.limit, filters.offset).map((ticket) => {
    const patient = patientMap.get(ticket.patient_id);
    const appointment = appointmentMap.get(ticket.appointment_id);
    const doctor = doctorMap.get(appointment?.doctor_id);
    const latest = messages.filter((message) => message.ticket_id === ticket.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return {
      id: ticket.id, ticketNumber: ticket.ticket_number, patientId: ticket.patient_id,
      assignedStaffId: ticket.assigned_staff_id, appointmentId: ticket.appointment_id,
      category: ticket.category, priority: ticket.priority, subject: ticket.subject, status: ticket.status,
      resolvedAt: ticket.resolved_at, closedAt: ticket.closed_at, createdAt: ticket.created_at,
      updatedAt: ticket.updated_at, patientName: userMap.get(patient?.user_id)?.name,
      assignedStaffName: userMap.get(ticket.assigned_staff_id)?.name, appointmentStart: appointment?.scheduled_start,
      appointmentDoctorName: userMap.get(doctor?.user_id)?.name,
      latestMessage: latest ? { message: latest.message, createdAt: latest.created_at } : null,
    };
  });
  return { tickets: result, total: found.length };
}

export async function getPatientTicket(patientId, ticketId) {
  const { data } = await run(supabaseAdmin.from('support_tickets').select('*').eq('id', ticketId)
    .eq('patient_id', patientId).maybeSingle());
  return data ? ticketView(data, true) : null;
}

export async function getStaffTicket(ticketId) {
  const { data } = await run(supabaseAdmin.from('support_tickets').select('*').eq('id', ticketId).maybeSingle());
  return data ? ticketView(data, true, true) : null;
}

export async function addTicketMessage({ ticketId, userId, role, patientId, message }) {
  const { data: ticket } = await run(supabaseAdmin.from('support_tickets').select('*').eq('id', ticketId).maybeSingle());
  if (!ticket || (role === 'patient' && ticket.patient_id !== patientId)) return null;
  if (ticket.status === 'closed' || (role === 'patient' && !['open', 'in_progress', 'waiting_for_patient', 'resolved'].includes(ticket.status))
    || (role === 'staff' && ticket.status === 'resolved')) return { closed: true };
  const { data: createdMessage } = await run(supabaseAdmin.from('support_ticket_messages').insert({
    ticket_id: ticketId, sender_user_id: userId, message,
  }).select('id').single());
  let nextStatus = ticket.status;
  if (role === 'patient' && ['waiting_for_patient', 'resolved'].includes(ticket.status)) nextStatus = 'in_progress';
  else if (role === 'staff') nextStatus = 'waiting_for_patient';
  const updatedFields = { updated_at: new Date().toISOString() };
  if (nextStatus !== ticket.status) updatedFields.status = nextStatus;
  if (role === 'patient' && nextStatus === 'in_progress') updatedFields.resolved_at = null;
  await run(supabaseAdmin.from('support_tickets').update(updatedFields).eq('id', ticketId));
  const updated = { ...ticket, ...updatedFields };
  const full = await ticketView(updated, true, true);
  return {
    ticket: full, messageId: createdMessage.id,
    patientUserId: full.patientUserId, assignedStaffId: full.assignedStaffId,
  };
}

export async function updateTicketStatus(ticketId, status) {
  const { data: current } = await run(supabaseAdmin.from('support_tickets').select('*').eq('id', ticketId).maybeSingle());
  if (!current) return null;
  const transitions = {
    open: ['in_progress', 'waiting_for_patient', 'resolved', 'closed'],
    in_progress: ['open', 'waiting_for_patient', 'resolved', 'closed'],
    waiting_for_patient: ['in_progress', 'resolved', 'closed'],
    resolved: ['in_progress', 'closed'], closed: [],
  };
  if (current.status !== status && !transitions[current.status]?.includes(status)) {
    return { invalidTransition: true, currentStatus: current.status };
  }
  const updatedFields = {
    status,
    resolved_at: status === 'resolved' ? current.resolved_at || new Date().toISOString() : null,
    closed_at: status === 'closed' ? current.closed_at || new Date().toISOString() : null,
  };
  const { data } = await run(supabaseAdmin.from('support_tickets').update(updatedFields).eq('id', ticketId).select('*').single());
  return {
    ticket: await ticketView({ ...data, ...updatedFields }, true, true),
    previousStatus: current.status,
  };
}

export async function updateTicketAssignment(ticketId, assignedStaffId) {
  const { data: current } = await run(supabaseAdmin.from('support_tickets').select('*')
    .eq('id', ticketId).maybeSingle());
  if (!current) return null;
  if (assignedStaffId) {
    const { data: staff } = await run(supabaseAdmin.from('users').select('id')
      .eq('id', assignedStaffId).eq('role', 'staff').eq('is_active', true).maybeSingle());
    if (!staff) return { invalidStaff: true };
  }
  const { data } = await run(supabaseAdmin.from('support_tickets').update({ assigned_staff_id: assignedStaffId })
    .eq('id', ticketId).select('*').maybeSingle());
  return data ? {
    ticket: await ticketView(data, true, true),
    previousAssignedStaffId: current.assigned_staff_id,
  } : null;
}

export async function getStaffDashboard() {
  const tickets = await rows('support_tickets');
  const stats = {
    total: tickets.length,
    open: tickets.filter((item) => item.status === 'open').length,
    inProgress: tickets.filter((item) => item.status === 'in_progress').length,
    waitingForPatient: tickets.filter((item) => item.status === 'waiting_for_patient').length,
    resolved: tickets.filter((item) => item.status === 'resolved').length,
    closed: tickets.filter((item) => item.status === 'closed').length,
  };
  const recent = await listTickets({ limit: 6, offset: 0 });
  return { stats, recent: recent.tickets };
}

export async function listAvailableStaff() {
  return (await rows('users')).filter((user) => user.role === 'staff' && user.is_active)
    .map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

import * as supportRepository from '../repositories/supportRepository.js';
import { recordActivity } from './auditService.js';
import * as notificationRepository from '../repositories/notificationRepository.js';

function requirePatientId(patientId) {
  if (patientId) return;
  const error = new Error('A patient account is required to access support tickets.');
  error.status = 403;
  throw error;
}

function notFound() {
  const error = new Error('Support ticket not found.');
  error.status = 404;
  return error;
}

export async function createPatientTicket(user, payload) {
  requirePatientId(user.patient_id);
  const result = await supportRepository.createPatientTicket({
    patientId: user.patient_id,
    userId: user.id,
    ...payload,
  });
  if (result.invalidAppointment) {
    const error = new Error('The linked appointment was not found.');
    error.status = 400;
    throw error;
  }
  const staff = await supportRepository.listAvailableStaff();
  await Promise.all(staff.map((member) => notificationRepository.create({
    userId: member.id,
    type: 'support_ticket_created',
    title: 'New support ticket',
    message: `A patient opened support ticket ${result.ticket.ticketNumber}.`,
    link: `/staff/support/tickets/${result.ticket.id}`,
    metadata: { ticketId: result.ticket.id },
    dedupeKey: `support-ticket:${result.ticket.id}:created:${member.id}`,
  })));
  return result.ticket;
}

export async function listPatientTickets(patientId, filters) {
  requirePatientId(patientId);
  return supportRepository.listTickets({ ...filters, patientId });
}

export async function getPatientTicket(patientId, ticketId) {
  requirePatientId(patientId);
  const ticket = await supportRepository.getPatientTicket(patientId, ticketId);
  if (!ticket) throw notFound();
  return ticket;
}

export async function replyAsPatient(user, ticketId, message) {
  requirePatientId(user.patient_id);
  const result = await supportRepository.addTicketMessage({
    ticketId, userId: user.id, role: 'patient', patientId: user.patient_id, message,
  });
  if (!result) throw notFound();
  if (result.closed) {
    const error = new Error('This ticket is closed and cannot receive further replies.');
    error.status = 409;
    throw error;
  }
  const recipients = result.assignedStaffId
    ? [result.assignedStaffId]
    : (await supportRepository.listAvailableStaff()).map((staff) => staff.id);
  await Promise.all(recipients.map((userId) => notificationRepository.create({
    userId, type: 'support_reply', title: 'New patient support reply',
    message: `A patient replied to support ticket ${result.ticket.ticketNumber}.`,
    link: `/staff/support/tickets/${ticketId}`,
    metadata: { ticketId },
    dedupeKey: `support-message:${result.messageId}:${userId}`,
  })));
  return result.ticket;
}

export async function getStaffDashboard() {
  return supportRepository.getStaffDashboard();
}

export async function listStaffTickets(filters, staffId) {
  return supportRepository.listTickets(filters, staffId);
}

export async function getStaffTicket(ticketId) {
  const ticket = await supportRepository.getStaffTicket(ticketId);
  if (!ticket) throw notFound();
  return ticket;
}

export async function replyAsStaff(user, ticketId, message, request) {
  const result = await supportRepository.addTicketMessage({
    ticketId, userId: user.id, role: 'staff', message,
  });
  if (!result) throw notFound();
  if (result.closed) {
    const error = new Error('This ticket cannot receive further replies.');
    error.status = 409;
    throw error;
  }
  if (result.patientUserId) {
    await notificationRepository.create({
      userId: result.patientUserId, type: 'support_reply',
      title: 'New support reply',
      message: `A support staff member replied to ticket ${result.ticket.ticketNumber}.`,
      link: `/dashboard/support/tickets/${ticketId}`,
      metadata: { ticketId },
      dedupeKey: `support-message:${result.messageId}:${result.patientUserId}`,
    });
  }
  await recordActivity({
    actor: { id: user.id, role: user.role },
    eventType: 'support.ticket.replied',
    request,
    details: { ticketId },
  });
  return result.ticket;
}

export async function setTicketStatus(ticketId, status, user = null, request = null) {
  const result = await supportRepository.updateTicketStatus(ticketId, status);
  if (!result) throw notFound();
  if (result.invalidTransition) {
    const error = new Error(`Ticket status cannot transition from ${result.currentStatus} to ${status}.`);
    error.status = 409;
    throw error;
  }
  if (result.previousStatus !== status) {
    const recipients = new Set([result.ticket.patientUserId, result.ticket.assignedStaffId]
      .filter((recipientId) => recipientId && recipientId !== user?.id));
    await Promise.all([...recipients].map((recipientId) => {
      const isPatient = recipientId === result.ticket.patientUserId;
      return notificationRepository.create({
        userId: recipientId,
        type: 'support_status_changed',
        title: 'Support ticket updated',
        message: `Ticket ${result.ticket.ticketNumber} status changed to ${status.replaceAll('_', ' ')}.`,
        link: isPatient ? `/dashboard/support/tickets/${ticketId}` : `/staff/support/tickets/${ticketId}`,
        metadata: { ticketId, status },
        dedupeKey: `support-ticket:${ticketId}:status:${status}:${result.ticket.updatedAt}:${recipientId}`,
      });
    }));
  }
  if (user) {
    await recordActivity({
      actor: { id: user.id, role: user.role },
      eventType: 'support.ticket.status_changed',
      request,
      details: { ticketId, status },
    });
  }
  return result.ticket;
}

export async function assignTicket(ticketId, staffId, user = null, request = null) {
  const result = await supportRepository.updateTicketAssignment(ticketId, staffId);
  if (!result) throw notFound();
  if (result.invalidStaff) {
    const error = new Error('The selected support staff account is not active.');
    error.status = 400;
    throw error;
  }
  if (staffId && result.previousAssignedStaffId !== staffId) {
    await notificationRepository.create({
      userId: staffId,
      type: 'support_ticket_assigned',
      title: 'Support ticket assigned',
      message: `Ticket ${result.ticket.ticketNumber} has been assigned to you.`,
      link: `/staff/support/tickets/${ticketId}`,
      metadata: { ticketId },
      dedupeKey: `support-ticket:${ticketId}:assigned:${staffId}:${result.ticket.updatedAt}`,
    });
  }
  if (user) {
    await recordActivity({
      actor: { id: user.id, role: user.role },
      targetUserId: staffId,
      eventType: 'support.ticket.assigned',
      request,
      details: { ticketId },
    });
  }
  return result.ticket;
}

export async function listStaff() {
  return supportRepository.listAvailableStaff();
}

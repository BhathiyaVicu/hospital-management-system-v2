import * as notificationRepository from '../repositories/notificationRepository.js';

async function notifyRecipients(appointment, event, messages) {
  const recipients = [
    appointment.doctor_user_id && {
      userId: appointment.doctor_user_id,
      link: '/doctor/appointments',
      message: messages.doctor,
    },
    appointment.patient_user_id && {
      userId: appointment.patient_user_id,
      link: `/dashboard/appointments/${appointment.id}`,
      message: messages.patient,
    },
  ].filter(Boolean);
  const eventKey = event === 'rescheduled' ? appointment.updated_at || appointment.scheduled_start : event;
  await Promise.all(recipients.map(({ userId, link, message }) => notificationRepository.create({
    userId, type: `appointment_${event}`, title: messages.title, message, link,
    metadata: { appointmentId: appointment.id },
    dedupeKey: `appointment:${appointment.id}:${event}:${eventKey}:${userId}`,
  })));
}

export function notifyAppointmentBooked(appointment) {
  return notifyRecipients(
    appointment, 'booked', {
      title: 'Appointment booked',
      doctor: 'A new appointment has been added to your schedule.',
      patient: 'Your appointment has been booked.',
    },
  );
}

export function notifyAppointmentCancelled(appointment) {
  return notifyRecipients(
    appointment, 'cancelled', {
      title: 'Appointment cancelled',
      doctor: 'An appointment has been cancelled from your schedule.',
      patient: 'Your appointment has been cancelled.',
    },
  );
}

export function notifyAppointmentRescheduled(appointment) {
  return notifyRecipients(
    appointment, 'rescheduled', {
      title: 'Appointment rescheduled',
      doctor: 'An appointment in your schedule has been rescheduled.',
      patient: 'Your appointment has been rescheduled.',
    },
  );
}

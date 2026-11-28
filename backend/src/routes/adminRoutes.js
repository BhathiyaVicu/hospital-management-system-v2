import { Router } from 'express';
import * as controller from '../controllers/adminController.js';
import {
  authenticate, requireRole, requireSuperAdmin, requireVerifiedEmail,
} from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import {
  createScheduleExceptionSchema,
  createWeeklyScheduleSchema,
  adminDoctorCalendarSchema,
  adminDoctorDateScheduleSchema,
  schedulesListSchema,
  updateScheduleExceptionSchema,
  updateWeeklyScheduleSchema,
} from '../validators/adminSchedules.js';
import {
  createTicketMessageSchema,
  ticketIdSchema,
  ticketListSchema,
  updateTicketAssignmentSchema,
  updateTicketStatusSchema,
} from '../validators/support.js';
import {
  accountListSchema,
  accountParamsSchema,
  activityListSchema,
  appointmentListSchema,
  appointmentParamsSchema,
  clinicListSchema,
  clinicParamsSchema,
  createAccountSchema,
  createReceptionistSchema,
  createClinicSchema,
  createDoctorSchema,
  createServiceSchema,
  createSpecialtySchema,
  doctorListSchema,
  doctorParamsSchema,
  patientListSchema,
  patientParamsSchema,
  patientUpdateSchema,
  reportsSchema,
  serviceListSchema,
  serviceParamsSchema,
  specialtyListSchema,
  specialtyParamsSchema,
  updateAccountSchema,
  updateReceptionistSchema,
  updateClinicSchema,
  updateDoctorSchema,
  updateServiceSchema,
  updateSpecialtySchema,
} from '../validators/admin.js';

const router = Router();
router.use(authenticate, requireVerifiedEmail, requireRole('admin', 'receptionist'));
const superAdminOnly = [requireSuperAdmin];

router.get('/dashboard', controller.dashboard);
router.get('/lookups', controller.lookups);

router.get('/patients', validate(patientListSchema), controller.patients);
router.get('/patients/:patientId', validate(patientParamsSchema), controller.patient);
router.patch('/patients/:patientId', validate(patientUpdateSchema), controller.updatePatient);

router.get('/doctors', validate(doctorListSchema), controller.doctors);
router.post('/doctors', validate(createDoctorSchema), controller.createDoctor);
router.get('/doctors/:doctorId', validate(doctorParamsSchema), controller.doctor);
router.patch('/doctors/:doctorId', validate(updateDoctorSchema), controller.updateDoctor);
router.delete('/doctors/:doctorId', validate(doctorParamsSchema), controller.deleteDoctor);

router.get('/clinics', validate(clinicListSchema), controller.clinics);
router.post('/clinics', validate(createClinicSchema), controller.createClinic);
router.patch('/clinics/:clinicId', validate(updateClinicSchema), controller.updateClinic);

router.get('/specialties', validate(specialtyListSchema), controller.specialties);
router.post('/specialties', validate(createSpecialtySchema), controller.createSpecialty);
router.patch('/specialties/:specialtyId', validate(updateSpecialtySchema), controller.updateSpecialty);
router.delete('/specialties/:specialtyId', validate(specialtyParamsSchema), controller.deleteSpecialty);

router.get('/services', validate(serviceListSchema), controller.services);
router.post('/services', validate(createServiceSchema), controller.createService);
router.patch('/services/:serviceId', validate(updateServiceSchema), controller.updateService);

router.get('/staff', validate(accountListSchema), controller.staff);
router.post('/staff', validate(createAccountSchema), controller.createStaff);
router.get('/staff/:userId', validate(accountParamsSchema), controller.staffAccount);
router.patch('/staff/:userId', validate(accountParamsSchema.merge(updateAccountSchema)), controller.updateStaff);
router.delete('/staff/:userId', validate(accountParamsSchema), controller.deleteStaff);

router.get('/receptionists', validate(accountListSchema), controller.receptionists);
router.post('/receptionists', validate(createReceptionistSchema), controller.createReceptionist);
router.get('/receptionists/:userId', validate(accountParamsSchema), controller.receptionistAccount);
router.patch('/receptionists/:userId', validate(updateReceptionistSchema), controller.updateReceptionist);
router.delete('/receptionists/:userId', validate(accountParamsSchema), controller.deleteReceptionist);

router.get('/admins', ...superAdminOnly, validate(accountListSchema), controller.admins);
router.post('/admins', ...superAdminOnly, validate(createAccountSchema), controller.createAdmin);
router.patch('/admins/:userId', ...superAdminOnly, validate(accountParamsSchema.merge(updateAccountSchema)), controller.updateAdmin);
router.delete('/admins/:userId', ...superAdminOnly, validate(accountParamsSchema), controller.deleteAdmin);

router.get('/appointments', validate(appointmentListSchema), controller.appointments);
router.get('/appointments/:appointmentId', validate(appointmentParamsSchema), controller.appointment);
router.get('/reports/lookups', controller.reportLookups);
router.get('/reports', validate(reportsSchema), controller.reports);
router.get('/activity-logs', validate(activityListSchema), controller.activityLogs);
router.get('/support/staff', controller.supportStaff);
router.get('/support/tickets', validate(ticketListSchema), controller.supportTickets);
router.get('/support/tickets/:ticketId', validate(ticketIdSchema), controller.supportTicket);
router.post('/support/tickets/:ticketId/messages', validate(createTicketMessageSchema), controller.replySupportTicket);
router.patch('/support/tickets/:ticketId/status', validate(updateTicketStatusSchema), controller.updateSupportTicketStatus);
router.patch('/support/tickets/:ticketId/assignment', validate(updateTicketAssignmentSchema), controller.assignSupportTicket);
router.get('/schedules', validate(schedulesListSchema), controller.schedules);
router.get('/schedules/doctors', controller.scheduleDoctors);
router.get('/schedules/calendar', validate(adminDoctorCalendarSchema), controller.doctorCalendar);
router.put('/schedules/dates/:date', validate(adminDoctorDateScheduleSchema), controller.saveDoctorDateSchedule);
router.post('/schedules/weekly', validate(createWeeklyScheduleSchema), controller.createWeeklySchedule);
router.patch('/schedules/weekly/:availabilityId', validate(updateWeeklyScheduleSchema), controller.updateWeeklySchedule);
router.post('/schedules/exceptions', validate(createScheduleExceptionSchema), controller.createScheduleException);
router.patch('/schedules/exceptions/:exceptionId', validate(updateScheduleExceptionSchema), controller.updateScheduleException);
router.delete('/schedules/exceptions/:exceptionId', validate(updateScheduleExceptionSchema.pick({ params: true })), controller.deleteScheduleException);

export default router;

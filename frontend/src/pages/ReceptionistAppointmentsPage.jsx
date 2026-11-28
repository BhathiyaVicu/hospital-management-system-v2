import { useCallback, useEffect, useMemo, useState } from 'react';
import PortalHeading from '../components/common/PortalHeading';
import WorkspaceLayout from '../components/workspace/WorkspaceLayout';
import {
  cancelReceptionistAppointment,
  createReceptionistAppointment,
  getReceptionistAppointment,
  getReceptionistAppointments,
  getReceptionistClinics,
  getReceptionistDoctorSlots,
  getReceptionistDoctors,
  getReceptionistPatients,
  linkReceptionistPatient,
  registerReceptionistPatient,
  rescheduleReceptionistAppointment,
  updateReceptionistAppointmentWorkflow,
  getAdminDoctorCalendar,
} from '../services/api';

const inputClass = 'mt-1.5 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15';
const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
const todayStr = () => dateKey(new Date());

export default function ReceptionistAppointmentsPage() {
  const [clinics, setClinics] = useState([]);
  const [clinicId, setClinicId] = useState('');
  const [doctors, setDoctors] = useState([]);
  const [patients, setPatients] = useState([]);
  const [patientSearch, setPatientSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState(null);
  
  const [doctorId, setDoctorId] = useState('');
  
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [calendar, setCalendar] = useState(null);
  const [loadingCalendar, setLoadingCalendar] = useState(false);
  const [appointmentDate, setAppointmentDate] = useState(todayStr());
  
  const [slots, setSlots] = useState([]);
  const [slotId, setSlotId] = useState('');
  const [reason, setReason] = useState('');
  const [isWalkIn, setIsWalkIn] = useState(false);
  const [walkInReason, setWalkInReason] = useState('');
  
  const [appointments, setAppointments] = useState([]);
  const [statusFilter, setStatusFilter] = useState('active'); // Default to 'active' to hide cancelled
  const [reschedule, setReschedule] = useState(null);
  const [rescheduleDate, setRescheduleDate] = useState(todayStr());
  const [rescheduleSlots, setRescheduleSlots] = useState([]);
  const [detail, setDetail] = useState(null);
  const [newPatient, setNewPatient] = useState(false);
  const [newPatientValues, setNewPatientValues] = useState({ name: '', email: '', phone: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [cancelConfirm, setCancelConfirm] = useState(null);


  const loadAppointments = useCallback(async () => {
    // If 'active' is selected, don't pass a status so we get everything EXCEPT cancelled
    // But the backend might not support "not equal" easily, so we filter on frontend
    const { data } = await getReceptionistAppointments({ clinicId, limit: 100 });
    setAppointments(data || []);
  }, [clinicId]);

  useEffect(() => {
    let active = true;
    getReceptionistClinics().then(({ data }) => {
      if (!active) return;
      setClinics(data || []);
      if (data?.length) setClinicId(data[0].id);
    }).catch((requestError) => { if (active) setError(requestError.message || 'Unable to load assigned clinics.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!clinicId) { setDoctors([]); return; }
    let active = true;
    getReceptionistDoctors(clinicId).then(({ data }) => {
      if (active) {
        setDoctors(data || []);
        setDoctorId('');
      }
    }).catch((requestError) => { if (active) setError(requestError.message || 'Unable to load clinic doctors.'); });
    return () => { active = false; };
  }, [clinicId]);

  useEffect(() => {
    if (!clinicId) return;
    let active = true;
    loadAppointments().catch((requestError) => {
      if (active) setError(requestError.message || 'Unable to load clinic appointments.');
    });
    return () => { active = false; };
  }, [clinicId, loadAppointments]);

  // Load Calendar for selected doctor
  useEffect(() => {
    if (!doctorId) { setCalendar(null); return; }
    let active = true;
    setLoadingCalendar(true);
    const monthStart = dateKey(month);
    const monthEnd = dateKey(new Date(month.getFullYear(), month.getMonth() + 1, 0));
    
    getAdminDoctorCalendar(doctorId, { from: monthStart, to: monthEnd })
      .then(({ data }) => {
        if (active) setCalendar(data);
      })
      .catch((requestError) => { if (active) setError(requestError.message || 'Unable to load calendar.'); })
      .finally(() => { if (active) setLoadingCalendar(false); });
      
    return () => { active = false; };
  }, [doctorId, month]);

  useEffect(() => {
    if (!patientSearch.trim()) { setPatients([]); return; }
    let active = true;
    const timer = setTimeout(() => {
      getReceptionistPatients({ search: patientSearch.trim(), limit: 10 }).then(({ data }) => {
        if (active) setPatients(data || []);
      }).catch((requestError) => { if (active) setError(requestError.message || 'Unable to search patients.'); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [patientSearch]);

  useEffect(() => {
    setSlots([]);
    setSlotId('');
    if (!clinicId || !doctorId || !appointmentDate) return;
    let active = true;
    getReceptionistDoctorSlots(doctorId, clinicId, appointmentDate).then(({ data }) => {
      if (active) setSlots(data || []);
    }).catch((requestError) => { if (active) setError(requestError.message || 'Unable to load appointment times.'); });
    return () => { active = false; };
  }, [clinicId, doctorId, appointmentDate]);

  useEffect(() => {
    setRescheduleSlots([]);
    if (!reschedule || !rescheduleDate) return;
    let active = true;
    getReceptionistDoctorSlots(reschedule.doctorId, reschedule.clinicId, rescheduleDate).then(({ data }) => {
      if (active) setRescheduleSlots(data || []);
    }).catch((requestError) => { if (active) setError(requestError.message || 'Unable to load rescheduling times.'); });
    return () => { active = false; };
  }, [reschedule, rescheduleDate]);

  const calendarCells = useMemo(() => {
    const firstWeekday = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [...Array(firstWeekday).fill(null), ...Array.from({ length: count }, (_, index) => index + 1)];
  }, [month]);

  const daysByDate = useMemo(() => {
    return new Map((calendar?.days || []).map((day) => [day.date, day]));
  }, [calendar]);

  const submitBooking = async (event) => {
    event.preventDefault();
    if (!selectedPatient || !slotId) return;
    const slot = slots.find((item) => item.id === slotId);
    if (!slot) return;
    setSaving(true);
    setError('');
    try {
      await createReceptionistAppointment({
        patientId: selectedPatient.id,
        doctorId,
        clinicId,
        scheduledStart: slot.startAt,
        reason,
        isWalkIn,
        ...(isWalkIn ? { walkInReason } : {}),
      });
      setNotice(isWalkIn ? 'Walk-in appointment scheduled and recorded.' : 'Appointment booked.');
      
      // Reset form
      setSelectedPatient(null);
      setPatientSearch('');
      setSlotId('');
      setReason('');
      setIsWalkIn(false);
      setWalkInReason('');
      
      // 👇 REFRESH APPOINTMENTS AND CALENDAR/SLOTS
      await loadAppointments();
      
      // Force reload of the calendar to update the dots
      if (doctorId) {
        const monthStart = dateKey(month);
        const monthEnd = dateKey(new Date(month.getFullYear(), month.getMonth() + 1, 0));
        const { data } = await getAdminDoctorCalendar(doctorId, { from: monthStart, to: monthEnd });
        setCalendar(data);
        
        // Reload the slots for the selected date
        const slotsRes = await getReceptionistDoctorSlots(doctorId, clinicId, appointmentDate);
        setSlots(slotsRes.data || []);
      }
    } catch (requestError) {
      setError(requestError.message || 'Unable to book this appointment.');
    } finally {
      setSaving(false);
    }
  };

  const changeWorkflow = async (appointment, workflowStatus) => {
    setSaving(true);
    setError('');
    try {
      await updateReceptionistAppointmentWorkflow(appointment.id, workflowStatus);
      setNotice(`Appointment updated to ${workflowStatus.replaceAll('_', ' ')}.`);
      await loadAppointments();
    } catch (requestError) {
      setError(requestError.message || 'Unable to update appointment workflow.');
    } finally {
      setSaving(false);
    }
  };

  const cancel = async () => {
    if (!cancelConfirm) return;
    setSaving(true);
    setError('');
    try {
      await cancelReceptionistAppointment(cancelConfirm.id);
      setNotice('Appointment cancelled.');
      setCancelConfirm(null); // Close the modal
      
      await loadAppointments();
      
      if (doctorId) {
        const monthStart = dateKey(month);
        const monthEnd = dateKey(new Date(month.getFullYear(), month.getMonth() + 1, 0));
        const { data } = await getAdminDoctorCalendar(doctorId, { from: monthStart, to: monthEnd });
        setCalendar(data);
        
        const slotsRes = await getReceptionistDoctorSlots(doctorId, clinicId, appointmentDate);
        setSlots(slotsRes.data || []);
      }
    } catch (requestError) {
      setError(requestError.message || 'Unable to cancel appointment.');
    } finally {
      setSaving(false);
    }
  };

  const openDetails = async (appointment) => {
    setError('');
    try {
      const { data } = await getReceptionistAppointment(appointment.id);
      setDetail(data);
    } catch (requestError) {
      setError(requestError.message || 'Unable to load appointment history.');
    }
  };

  const saveReschedule = async (appointment, startAt) => {
    setSaving(true);
    setError('');
    try {
      await rescheduleReceptionistAppointment(appointment.id, { scheduledStart: startAt });
      setReschedule(null);
      setNotice('Appointment rescheduled.');
      
      await loadAppointments();
      
      if (doctorId) {
        const monthStart = dateKey(month);
        const monthEnd = dateKey(new Date(month.getFullYear(), month.getMonth() + 1, 0));
        const { data } = await getAdminDoctorCalendar(doctorId, { from: monthStart, to: monthEnd });
        setCalendar(data);
        
        // Reload the slots for the currently selected date in the booking form
        const slotsRes = await getReceptionistDoctorSlots(doctorId, clinicId, appointmentDate);
        setSlots(slotsRes.data || []);
      }
    } catch (requestError) {
      setError(requestError.message || 'Unable to reschedule appointment.');
    } finally {
      setSaving(false);
    }
  };

  // 👇 FILTER LOGIC FOR APPOINTMENTS
  const visibleAppointments = appointments.filter((app) => {
    if (statusFilter === 'active') return app.status !== 'cancelled' && app.workflowStatus !== 'completed' && app.workflowStatus !== 'no_show';
    if (statusFilter === 'cancelled') return app.status === 'cancelled';
    return app.workflowStatus === statusFilter;
  });

  return (
    <WorkspaceLayout role="receptionist">
      <PortalHeading eyebrow="Reception workspace · scheduling" title="Appointments & check-in" description="Book and update clinic appointments, process arrivals, and record walk-ins." />
      
      {error && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      
      {loading ? <p className="py-12 text-center text-on-surface-variant">Loading your clinics...</p> : clinics.length === 0 ? (
        <p className="rounded-xl bg-amber-50 p-5 text-sm text-amber-800">No clinic locations are assigned to your account. Contact an administrator to request access.</p>
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          
          {/* LEFT: BOOKING FORM */}
          <section className="rounded-2xl bg-surface-container-lowest p-4 shadow-sm ring-1 ring-slate-200 sm:p-6">
            <h2 className="text-lg font-semibold">Book an appointment</h2>
            
            <form onSubmit={submitBooking} className="mt-5 space-y-4">
              <label className="block text-sm font-medium">Clinic
                <select value={clinicId} onChange={(event) => { setClinicId(event.target.value); setSelectedPatient(null); }} className={inputClass} required>
                  {clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name} · {clinic.city}</option>)}
                </select>
              </label>
              
              {!newPatient ? (
                <div>
                  <label className="block text-sm font-medium">Patient
                    <input value={patientSearch} onChange={(event) => { setPatientSearch(event.target.value); setSelectedPatient(null); }} placeholder="Search by name, email, or phone" className={inputClass} />
                  </label>
                  
                  {selectedPatient ? (
                    <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
                      <span><strong>{selectedPatient.name}</strong><br />{selectedPatient.email}</span>
                      <button type="button" onClick={() => setSelectedPatient(null)} className="font-semibold text-primary">Change</button>
                    </div>
                  ) : patients.length > 0 && (
                    <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-slate-200 shadow-sm">
                      {patients.map((patient) => (
                        <button key={patient.id} type="button" onClick={() => { setSelectedPatient(patient); setPatientSearch(patient.name); setPatients([]); }} className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm hover:bg-surface-container-low">
                          <span className="font-semibold">{patient.name}</span>
                          <span className="block text-on-surface-variant">{patient.email}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  
                  <button type="button" onClick={() => { setNewPatient(true); setSelectedPatient(null); }} className="mt-2 text-sm font-semibold text-primary hover:underline">
                    Register a new patient
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-surface-container-low p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-sm font-semibold">New patient</p>
                    <button type="button" onClick={() => setNewPatient(false)} className="text-sm font-semibold text-primary">Search existing</button>
                  </div>
                  <div className="space-y-3">
                    <input placeholder="Full name" value={newPatientValues.name} onChange={(event) => setNewPatientValues({ ...newPatientValues, name: event.target.value })} className={inputClass} required />
                    <input type="email" placeholder="Email address" value={newPatientValues.email} onChange={(event) => setNewPatientValues({ ...newPatientValues, email: event.target.value })} className={inputClass} required />
                    <input placeholder="Phone number" value={newPatientValues.phone} onChange={(event) => setNewPatientValues({ ...newPatientValues, phone: event.target.value })} className={inputClass} />
                    <button type="button" disabled={saving} onClick={async () => {
                      setSaving(true); setError('');
                      try {
                        const { data } = await registerReceptionistPatient({ ...newPatientValues, clinicId });
                        setSelectedPatient({ id: data.patientId, name: data.name, email: data.email });
                        setPatientSearch(data.name);
                        setNewPatient(false);
                        setNewPatientValues({ name: '', email: '', phone: '' });
                        setNotice(data.message);
                      } catch (requestError) { setError(requestError.message || 'Unable to register patient.'); }
                      finally { setSaving(false); }
                    }} className="min-h-10 w-full rounded-lg bg-surface-container-high text-sm font-semibold transition hover:bg-slate-300 disabled:opacity-60">
                      Register patient
                    </button>
                  </div>
                </div>
              )}
              
              <label className="block text-sm font-medium">Doctor
                <select value={doctorId} onChange={(event) => setDoctorId(event.target.value)} className={inputClass} required>
                  <option value="">Select a doctor</option>
                  {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name} · {doctor.title}</option>)}
                </select>
              </label>

              {doctorId && (
                <div className="border-t border-slate-100 pt-4">
                  <div className="mb-3 flex items-center justify-between">
                    <label className="block text-sm font-semibold text-on-surface">Select Date</label>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="p-1 rounded hover:bg-surface-container"><span className="material-symbols-outlined text-[18px]">chevron_left</span></button>
                      <span className="text-sm font-medium">{month.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</span>
                      <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="p-1 rounded hover:bg-surface-container"><span className="material-symbols-outlined text-[18px]">chevron_right</span></button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-7 border-b border-slate-100 pb-2 text-center text-[10px] font-semibold text-on-surface-variant uppercase">
                    {weekDays.map((day) => <span key={day}>{day}</span>)}
                  </div>
                  
                  {loadingCalendar ? (
                    <p className="py-6 text-center text-xs text-on-surface-variant">Loading calendar...</p>
                  ) : calendar ? (
                    <div className="mt-2 grid grid-cols-7 gap-1">
                      {calendarCells.map((dateNumber, index) => {
                        if (!dateNumber) return <span key={`empty-${index}`} />;
                        const date = dateKey(new Date(month.getFullYear(), month.getMonth(), dateNumber));
                        const day = daysByDate.get(date);
                        const past = date < (day?.localToday || todayStr());
                        const hasAvail = day?.slots.some(s => s.enabled && !s.booked);
                        const hasBooked = day?.slots.some(s => s.booked);
                        const isSelected = appointmentDate === date;

                        return (
                          <button
                            key={date}
                            type="button"
                            disabled={past}
                            onClick={() => setAppointmentDate(date)}
                            className={`flex flex-col items-center justify-center rounded-lg py-2 transition ${
                              isSelected ? 'bg-primary text-on-primary shadow-sm' 
                              : past ? 'cursor-not-allowed text-slate-300' 
                              : 'hover:bg-surface-container'
                            }`}
                          >
                            <span className="text-sm font-semibold">{dateNumber}</span>
                            <div className="flex gap-0.5 mt-0.5 h-1.5">
                              {hasAvail && <span className={`h-1.5 w-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-emerald-500'}`} />}
                              {hasBooked && <span className={`h-1.5 w-1.5 rounded-full ${isSelected ? 'bg-white/70' : 'bg-amber-500'}`} />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  
                  <div className="mt-2 flex gap-3 text-[10px] text-on-surface-variant justify-center">
                    <span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Available</span>
                    <span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Booked</span>
                  </div>
                </div>
              )}

              <div className="border-t border-slate-100 pt-4">
                <label className="mb-2 block text-sm font-semibold text-on-surface">Available Time</label>
                {slots.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {slots.map((slot) => (
                      <button
                        key={slot.id}
                        type="button"
                        onClick={() => setSlotId(slot.id)}
                        className={`rounded-lg border px-2 py-2 text-center text-xs font-semibold transition ${
                          slotId === slot.id
                            ? 'border-primary bg-primary text-on-primary shadow-sm'
                            : 'border-slate-200 bg-surface-container-lowest text-on-surface-variant hover:border-primary/40 hover:bg-surface-container-low'
                        }`}
                      >
                        {slot.time}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg bg-surface-container-low p-4 text-center text-sm text-on-surface-variant">
                    {doctorId ? 'No open times available on this date.' : 'Select a doctor to view available times.'}
                  </div>
                )}
              </div>

              {isWalkIn && (
                <label className="block text-sm font-medium">Walk-in reason
                  <textarea value={walkInReason} onChange={(event) => setWalkInReason(event.target.value)} maxLength={500} rows={2} className={`${inputClass} h-auto`} required />
                </label>
              )}

              <button type="submit" disabled={saving || !selectedPatient || !slotId} className="min-h-11 w-full rounded-lg bg-primary px-4 text-sm font-semibold text-on-primary shadow-sm transition hover:bg-primary-container disabled:opacity-60">
                {saving ? 'Saving...' : isWalkIn ? 'Schedule walk-in' : 'Book appointment'}
              </button>
            </form>
          </section>

          {/* RIGHT: APPOINTMENT LIST */}
          <section className="min-w-0 rounded-2xl bg-surface-container-lowest p-4 shadow-sm ring-1 ring-slate-200 sm:p-6">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Clinic appointments</h2>
                <p className="mt-1 text-sm text-on-surface-variant">{visibleAppointments.length} displayed</p>
              </div>
              <label className="text-xs font-medium">Filter
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="ml-2 min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm">
                  <option value="active">Active</option>
                  <option value="">All Statuses</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="arrived">Arrived</option>
                  <option value="checked_in">Checked In</option>
                  <option value="waiting">Waiting</option>
                  <option value="in_consultation">In Consultation</option>
                  <option value="completed">Completed</option>
                  <option value="no_show">No Show</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
            </div>
            
            {visibleAppointments.length ? (
              <div className="space-y-3">
                {visibleAppointments.map((appointment) => (
                  <article key={appointment.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-on-surface text-base truncate">{appointment.patientName}</p>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            appointment.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                            appointment.workflowStatus === 'no_show' ? 'bg-slate-200 text-slate-700' :
                            'bg-surface-container text-on-surface-variant'
                          }`}>
                            {appointment.status === 'cancelled' ? 'Cancelled' : appointment.workflowStatus.replaceAll('_', ' ')}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-on-surface-variant flex items-center gap-1.5"><span className="material-symbols-outlined text-[16px]">mail</span>{appointment.patientEmail}</p>
                        <p className="mt-1 text-sm text-on-surface-variant flex items-center gap-1.5"><span className="material-symbols-outlined text-[16px]">call</span>{appointment.patientPhone || 'No phone'}</p>
                        <p className="mt-1 text-sm text-on-surface-variant flex items-center gap-1.5"><span className="material-symbols-outlined text-[16px]">stethoscope</span>{appointment.doctorName}</p>
                        <p className="mt-2 text-sm font-medium text-primary flex items-center gap-1.5"><span className="material-symbols-outlined text-[16px]">event</span>{new Date(appointment.scheduledStart).toLocaleString()}</p>
                        
                        {appointment.isWalkIn && <span className="mt-2 inline-block rounded bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 border border-amber-200">Walk-in</span>}
                      </div>
                      
                      <button type="button" onClick={() => openDetails(appointment)} className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-primary hover:bg-surface-container flex items-center gap-1">
                        <span className="material-symbols-outlined text-[18px]">history</span>
                        History
                      </button>
                    </div>
                    
                    {appointment.status === 'confirmed' && (
                      <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                        {appointment.workflowStatus === 'scheduled' && <button type="button" disabled={saving} onClick={() => changeWorkflow(appointment, 'arrived')} className="min-h-9 rounded-lg bg-primary/10 px-3 text-xs font-semibold text-primary hover:bg-primary/20 transition">Mark arrived</button>}
                        {appointment.workflowStatus === 'arrived' && <button type="button" disabled={saving} onClick={() => changeWorkflow(appointment, 'checked_in')} className="min-h-9 rounded-lg bg-primary/10 px-3 text-xs font-semibold text-primary hover:bg-primary/20 transition">Check in</button>}
                        {appointment.workflowStatus === 'checked_in' && <button type="button" disabled={saving} onClick={() => changeWorkflow(appointment, 'waiting')} className="min-h-9 rounded-lg bg-primary/10 px-3 text-xs font-semibold text-primary hover:bg-primary/20 transition">Mark waiting</button>}
                        {['scheduled', 'arrived', 'checked_in', 'waiting'].includes(appointment.workflowStatus) && <button type="button" disabled={saving} onClick={() => changeWorkflow(appointment, 'no_show')} className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-on-surface-variant hover:bg-surface-container transition">No-show</button>}
                        
                        <button type="button" disabled={saving} onClick={() => { setReschedule(appointment); setRescheduleDate(todayStr()); }} className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-on-surface hover:bg-surface-container transition">Reschedule</button>
                        <button type="button" disabled={saving} onClick={() => setCancelConfirm(appointment)} className="min-h-9 rounded-lg px-3 text-xs font-semibold text-error bg-red-200 hover:bg-red-400 transition">Cancel</button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <p className="rounded-xl bg-surface-container-low p-8 text-center text-sm text-on-surface-variant">No appointments found matching your filter.</p>
            )}
          </section>
        </div>
      )}

      {/* RESCHEDULE MODAL */}
      {reschedule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3">
          <section role="dialog" aria-modal="true" className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">Reschedule appointment</h2>
                <p className="mt-1 text-sm text-on-surface-variant">{reschedule.patientName} · {reschedule.doctorName}</p>
              </div>
              <button type="button" onClick={() => setReschedule(null)} className="h-10 w-10 rounded-lg hover:bg-surface-container"><span className="material-symbols-outlined">close</span></button>
            </div>
            
            <label className="mt-4 block text-sm font-medium">New date
              <input type="date" min={todayStr()} value={rescheduleDate} onChange={(event) => setRescheduleDate(event.target.value)} className={inputClass} />
            </label>
            
            <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {rescheduleSlots.map((slot) => (
                <button key={slot.id} type="button" disabled={saving} onClick={() => saveReschedule(reschedule, slot.startAt)} className="min-h-10 rounded-lg bg-surface-container px-2 text-sm font-semibold transition hover:bg-primary/20 disabled:opacity-60">
                  {slot.time}
                </button>
              ))}
            </div>
            {!rescheduleSlots.length && <p className="mt-3 text-sm text-on-surface-variant">No times available on this date.</p>}
            
            <button type="button" onClick={() => setReschedule(null)} className="mt-6 min-h-10 rounded-lg border border-slate-200 px-4 text-sm font-semibold">Close</button>
          </section>
        </div>
      )}

      {/* HISTORY MODAL */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3 sm:p-6">
          <section role="dialog" aria-modal="true" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">Appointment history</h2>
                <p className="mt-1 text-sm text-on-surface-variant">{detail.patientName} · {detail.doctorName}</p>
              </div>
              <button type="button" onClick={() => setDetail(null)} className="h-10 w-10 rounded-lg hover:bg-surface-container"><span className="material-symbols-outlined">close</span></button>
            </div>
            
            <div className="mt-5 space-y-2">
              {(detail.history || []).map((item) => (
                <article key={`${item.eventType}-${item.changedAt}`} className="rounded-xl bg-surface-container-low p-3">
                  <p className="font-semibold capitalize">{item.eventType.replaceAll('_', ' ')}</p>
                  <p className="mt-1 text-sm">{new Date(item.scheduledStart).toLocaleString()} · {item.status} · {item.workflowStatus.replaceAll('_', ' ')}</p>
                  <p className="mt-1 text-xs text-on-surface-variant">{new Date(item.changedAt).toLocaleString()} · {item.actorName || 'System'}</p>
                </article>
              ))}
            </div>
            
            <h3 className="mt-5 font-semibold">Patient flow history</h3>
            <div className="mt-2 space-y-2">
              {(detail.workflowHistory || []).map((item, index) => (
                <article key={`${item.changedAt}-${index}`} className="rounded-xl bg-surface-container-low p-3 text-sm">
                  <span className="capitalize">{item.previousStatus ? `${item.previousStatus.replaceAll('_', ' ')} → ` : ''}{item.newStatus.replaceAll('_', ' ')}</span>
                  <span className="block mt-1 text-xs text-on-surface-variant">{new Date(item.changedAt).toLocaleString()} · {item.actorName || 'System'}</span>
                </article>
              ))}
            </div>
            
            {detail.isWalkIn && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><strong>Walk-in reason:</strong> {detail.walkInReason}</p>}
            
            <button type="button" onClick={() => setDetail(null)} className="mt-6 min-h-10 rounded-lg border border-slate-200 px-4 text-sm font-semibold">Close</button>
          </section>
        </div>
      )}

      {cancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3">
          <section role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-3 text-error mb-4">
              <span className="material-symbols-outlined text-3xl">warning</span>
              <h2 className="text-xl font-semibold">Cancel appointment?</h2>
            </div>
            
            <p className="text-sm text-on-surface-variant leading-relaxed">
              Are you sure you want to cancel the appointment for <strong className="text-on-surface">{cancelConfirm.patientName}</strong> with <strong className="text-on-surface">{cancelConfirm.doctorName}</strong>?
            </p>
            <p className="mt-2 text-xs text-on-surface-variant bg-surface-container-low p-2 rounded">
              The time slot will be released and made available for other patients.
            </p>

            <div className="mt-6 flex justify-end gap-2">
              <button 
                type="button" 
                onClick={() => setCancelConfirm(null)} 
                disabled={saving}
                className="min-h-10 rounded-lg border border-slate-200 px-4 text-sm font-semibold hover:bg-surface-container"
              >
                Keep appointment
              </button>
              <button 
                type="button" 
                onClick={cancel} 
                disabled={saving}
                className="min-h-10 rounded-lg bg-error px-4 text-sm font-semibold text-white bg-red-800  hover:bg-red-500  disabled:opacity-60"
              >
                {saving ? 'Cancelling...' : 'Yes, cancel'}
              </button>
            </div>
          </section>
        </div>
      )}

    </WorkspaceLayout>
  );
}
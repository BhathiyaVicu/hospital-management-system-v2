import { useCallback, useEffect, useState } from 'react';
import PortalHeading from '../components/common/PortalHeading';
import WorkspaceLayout from '../components/workspace/WorkspaceLayout';
import {
  getDoctorWorkspaceAppointments,
  getDoctorWorkspaceAppointment,
  getDoctorConsultation,
  saveDoctorConsultation,
  updateDoctorAppointmentWorkflow,
} from '../services/api';

const initialNotes = { clinicalNotes: '', assessment: '', treatmentPlan: '', followUpNotes: '' };
const inputClass = 'mt-1.5 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15';

function localDate(days = 0) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function DoctorAppointmentsPage() {
  const [appointments, setAppointments] = useState([]);
  const [filters, setFilters] = useState({ from: localDate(-14), to: localDate(60), status: '' });
  const [selected, setSelected] = useState(null);
  const [notes, setNotes] = useState(initialNotes);
  const [revisions, setRevisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await getDoctorWorkspaceAppointments({ ...filters, limit: 100 });
      setAppointments(data || []);
    } catch (requestError) {
      setError(requestError.message || 'Unable to load appointments.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const openAppointment = async (item) => {
    setError('');
    try {
      const [{ data: appointment }, { data: consultation }] = await Promise.all([
        getDoctorWorkspaceAppointment(item.id),
        getDoctorConsultation(item.id),
      ]);
      setSelected(appointment);
      setNotes(consultation.consultation || initialNotes);
      setRevisions(consultation.revisions || []);
    } catch (requestError) {
      setError(requestError.message || 'Unable to open this appointment.');
    }
  };

  const changeWorkflow = async (workflowStatus) => {
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      await updateDoctorAppointmentWorkflow(selected.id, workflowStatus);
      setNotice(`Appointment moved to ${workflowStatus.replaceAll('_', ' ')}.`);
      await load();
      await openAppointment({ id: selected.id });
    } catch (requestError) {
      setError(requestError.message || 'Unable to update appointment status.');
    } finally {
      setSaving(false);
    }
  };

  const saveNotes = async (event) => {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      const { data } = await saveDoctorConsultation(selected.id, notes);
      setNotes(data);
      const refreshed = await getDoctorConsultation(selected.id);
      setRevisions(refreshed.data.revisions || []);
      setNotice('Consultation saved. Previous versions remain available in the history.');
    } catch (requestError) {
      setError(requestError.message || 'Unable to save consultation notes.');
    } finally {
      setSaving(false);
    }
  };

  const workflowActions = (appointment) => {
    if (appointment.workflowStatus === 'in_consultation') return [['completed', 'Complete consultation']];
    if (['scheduled', 'arrived', 'checked_in', 'waiting'].includes(appointment.workflowStatus)) {
      return [['in_consultation', 'Start consultation'], ['no_show', 'Mark no-show']];
    }
    return [];
  };

  return (
    <WorkspaceLayout role="doctor">
      <PortalHeading eyebrow="Doctor workspace · patient care" title="Appointments" description="Review your own appointments, manage care status, and maintain private consultation notes." />
      
      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      
      <section className="rounded-2xl bg-surface-container-lowest p-4 shadow-sm ring-1 ring-slate-200 sm:p-6">
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <label className="text-sm font-medium">From
            <input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} className={inputClass} />
          </label>
          <label className="text-sm font-medium">To
            <input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} className={inputClass} />
          </label>
          <label className="text-sm font-medium">Workflow status
            <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })} className={inputClass}>
              <option value="">All statuses</option>
              {['scheduled', 'arrived', 'checked_in', 'waiting', 'in_consultation', 'completed', 'no_show'].map((status) => 
                <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>
              )}
            </select>
          </label>
        </div>

        {loading ? (
          <p className="py-10 text-center text-on-surface-variant">Loading appointments...</p>
        ) : appointments.length ? (
          <div className="space-y-3">
            {appointments.map((item) => (
              <article key={item.id} className="flex flex-col gap-4 rounded-xl border border-slate-200 p-4 transition hover:border-slate-300 hover:shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 grid gap-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-on-surface text-lg">{item.patientName}</p>
                    <span className="inline-flex rounded-full bg-surface-container px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                      {item.workflowStatus.replaceAll('_', ' ')}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-on-surface-variant">
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[16px]">calendar_month</span>
                      {new Date(item.scheduledStart).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[16px]">location_on</span>
                      {item.clinicName || 'Clinic'}
                    </span>
                    {item.patientPhone && (
                      <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-[16px]">call</span>
                        {item.patientPhone}
                      </span>
                    )}
                  </div>
                </div>
                <button 
                  type="button" 
                  onClick={() => openAppointment(item)} 
                  className="shrink-0 rounded-lg bg-primary/10 px-4 py-2 text-sm font-semibold text-primary transition hover:bg-primary/20"
                >
                  Open Record
                </button>
              </article>
            ))}
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-on-surface-variant">No appointments match these filters.</p>
        )}
      </section>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3 sm:p-6">
          <section role="dialog" aria-modal="true" aria-labelledby="doctor-appointment-title" className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">Patient appointment</p>
                <h2 id="doctor-appointment-title" className="mt-1 text-2xl font-semibold">{selected.patientName}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-on-surface-variant">
                  <span>{selected.patientEmail}</span>
                  {selected.patientPhone && <span>· {selected.patientPhone}</span>}
                </div>
                <p className="mt-2 text-sm font-medium text-on-surface flex items-center gap-1">
                  <span className="material-symbols-outlined text-primary text-[18px]">event</span>
                  {new Date(selected.scheduledStart).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}
                </p>
              </div>
              <button type="button" onClick={() => setSelected(null)} aria-label="Close appointment" className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-container hover:bg-surface-container-high">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            
            {selected.reason && (
              <div className="mt-5 rounded-xl bg-surface-container-low p-4 text-sm border border-slate-100">
                <strong className="block mb-1">Visit reason:</strong> 
                <p className="text-on-surface-variant">{selected.reason}</p>
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-on-surface-variant">Status:</span>
              <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-sm font-bold uppercase tracking-wide text-primary">
                {selected.workflowStatus.replaceAll('_', ' ')}
              </span>
              <div className="flex gap-2 ml-auto">
                {workflowActions(selected).map(([status, label]) => (
                  <button key={status} type="button" disabled={saving} onClick={() => changeWorkflow(status)} className="min-h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-on-primary disabled:opacity-60">
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {['in_consultation', 'completed'].includes(selected.workflowStatus) ? (
              <form onSubmit={saveNotes} className="mt-8 border-t border-slate-200 pt-6">
                <h3 className="text-xl font-semibold flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">clinical_notes</span>
                  Private consultation notes
                </h3>
                <p className="mt-1 text-sm text-on-surface-variant mb-5">Only you can access these clinical notes.</p>
                
                <div className="grid gap-5 sm:grid-cols-2">
                  {[
                    ['clinicalNotes', 'Clinical notes'],
                    ['assessment', 'Assessment'],
                    ['treatmentPlan', 'Treatment plan'],
                    ['followUpNotes', 'Follow-up notes'],
                  ].map(([key, label]) => (
                    <label key={key} className="text-sm font-medium">
                      {label}
                      <textarea 
                        value={notes[key] || ''} 
                        onChange={(event) => setNotes({ ...notes, [key]: event.target.value })} 
                        rows={4} 
                        maxLength={key === 'clinicalNotes' ? 20000 : key === 'treatmentPlan' ? 10000 : 5000} 
                        className={`${inputClass} h-auto`} 
                      />
                    </label>
                  ))}
                </div>
                
                <div className="mt-6 flex justify-end">
                  <button type="submit" disabled={saving} className="min-h-11 rounded-lg bg-primary px-6 text-sm font-semibold text-on-primary disabled:opacity-60">
                    {saving ? 'Saving...' : 'Save consultation'}
                  </button>
                </div>

                {revisions.length > 0 && (
                  <div className="mt-8 bg-surface-container-low rounded-xl p-5">
                    <h4 className="font-semibold text-on-surface">Previous versions ({revisions.length})</h4>
                    <div className="mt-3 space-y-2">
                      {revisions.map((revision) => (
                        <details key={revision.id} className="group rounded-lg border border-slate-200 bg-white p-3">
                          <summary className="cursor-pointer text-sm font-medium text-primary hover:underline">
                            {new Date(revision.revisedAt).toLocaleString()}
                          </summary>
                          <p className="mt-3 whitespace-pre-wrap text-sm text-on-surface-variant border-t border-slate-100 pt-3">
                            {revision.clinicalNotes || 'No previous clinical notes.'}
                          </p>
                        </details>
                      ))}
                    </div>
                  </div>
                )}
              </form>
            ) : (
              <p className="mt-6 rounded-xl bg-surface-container-low p-5 text-center text-sm text-on-surface-variant">
                Start the consultation to enter private clinical notes.
              </p>
            )}
          </section>
        </div>
      )}
    </WorkspaceLayout>
  );
}
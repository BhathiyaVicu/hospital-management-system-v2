import { useCallback, useEffect, useState } from 'react';
import PortalHeading from '../components/common/PortalHeading';
import WorkspaceLayout from '../components/workspace/WorkspaceLayout';
import {
  getReceptionistClinics,
  getReceptionistPatients,
  registerReceptionistPatient,
  updateReceptionistPatient,
} from '../services/api';

const inputClass = 'mt-1.5 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';

export default function ReceptionistPatientsPage() {
  const [clinics, setClinics] = useState([]);
  const [clinicId, setClinicId] = useState('');
  const [search, setSearch] = useState('');
  const [patients, setPatients] = useState([]);
  const [editing, setEditing] = useState(null);
  const [newPatient, setNewPatient] = useState({ name: '', email: '', phone: '' });
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      if (search.trim()) {
        const { data } = await getReceptionistPatients({ search: search.trim(), limit: 100 });
        setPatients(data || []);
      } else {
        setPatients([]);
      }
    } catch (requestError) {
      setError(requestError.message || 'Unable to search clinic patients.');
    }
  }, [search]);

  useEffect(() => {
    let active = true;
    getReceptionistClinics().then(({ data }) => {
      if (!active) return;
      setClinics(data || []);
      if (data?.length) setClinicId(data[0].id);
    }).catch((requestError) => { if (active) setError(requestError.message || 'Unable to load clinics.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
  }, [load]);

  const register = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const { data } = await registerReceptionistPatient({ ...newPatient, clinicId });
      setNotice(data.message);
      setNewPatient({ name: '', email: '', phone: '' });
      setShowNew(false);
      setSearch(data.name);
      await load();
    } catch (requestError) {
      setError(requestError.message || 'Unable to register this patient.');
    } finally {
      setSaving(false);
    }
  };

  const saveContact = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await updateReceptionistPatient(editing.id, { name: editing.name, phone: editing.phone || '' });
      setNotice('Patient contact details updated.');
      setEditing(null);
      await load();
    } catch (requestError) {
      setError(requestError.message || 'Unable to update patient contact information.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <WorkspaceLayout role="receptionist">
      <PortalHeading 
        eyebrow="Reception workspace · patient services" 
        title="Patient directory" 
        description="Search patients connected to your assigned clinics, update contact details, and register new patients." 
        actions={
          <button 
            type="button" 
            onClick={() => setShowNew(!showNew)} 
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold shadow-sm transition ${showNew ? 'bg-surface-container text-on-surface hover:bg-surface-container-high' : 'bg-primary text-on-primary hover:bg-primary-container'}`}
          >
            <span className="material-symbols-outlined text-lg">{showNew ? 'close' : 'person_add'}</span>
            {showNew ? 'Close form' : 'Register patient'}
          </button>
        } 
      />
      
      {error && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</p>}

      {loading ? (
        <p className="py-12 text-center text-on-surface-variant">Loading clinics...</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_350px]">
          
          {/* LEFT: Search and Patient List */}
          <div className="space-y-4">
            <div className="rounded-2xl bg-surface-container-lowest p-5 shadow-sm ring-1 ring-slate-200">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-on-surface">Search directory</span>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-3 text-on-surface-variant">search</span>
                  <input 
                    value={search} 
                    onChange={(event) => setSearch(event.target.value)} 
                    placeholder="Search by name, email, or phone..." 
                    className={`${inputClass} pl-10`} 
                  />
                </div>
              </label>
            </div>

            {patients.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {patients.map((patient) => (
                  <article key={patient.id} className="flex flex-col justify-between rounded-xl border border-slate-200 bg-surface-container-lowest p-4 shadow-sm transition hover:border-primary/30 hover:shadow-md">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <span className="material-symbols-outlined text-[18px]">person</span>
                        </span>
                        <p className="font-semibold text-on-surface truncate">{patient.name}</p>
                      </div>
                      <div className="space-y-1 text-sm text-on-surface-variant">
                        <p className="flex items-center gap-1.5 truncate">
                          <span className="material-symbols-outlined text-[16px]">mail</span>
                          {patient.email}
                        </p>
                        <p className="flex items-center gap-1.5 truncate">
                          <span className="material-symbols-outlined text-[16px]">call</span>
                          {patient.phone || 'No phone'}
                        </p>
                      </div>
                    </div>
                    <button 
                      type="button" 
                      onClick={() => setEditing({ id: patient.id, name: patient.name, phone: patient.phone || '' })} 
                      className="mt-4 w-full rounded-lg bg-surface-container py-2 text-xs font-semibold text-on-surface transition hover:bg-surface-container-high"
                    >
                      Edit contact
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-surface-container-lowest p-10 text-center">
                <span className="material-symbols-outlined text-4xl text-slate-300">person_search</span>
                <p className="mt-2 font-medium text-on-surface">
                  {search.trim() ? 'No patients found' : 'Search for a patient'}
                </p>
                <p className="text-sm text-on-surface-variant">
                  {search.trim() ? 'Try a different name, email, or phone number.' : 'Enter a name, email, or phone number to start searching.'}
                </p>
              </div>
            )}
          </div>

          {/* RIGHT: Registration Form */}
          <div>
            {showNew && (
              <form onSubmit={register} className="sticky top-24 rounded-2xl border border-primary/20 bg-surface-container-lowest p-5 shadow-lg ring-4 ring-primary/5">
                <div className="mb-4 flex items-center gap-2">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <span className="material-symbols-outlined">person_add</span>
                  </span>
                  <h2 className="text-lg font-semibold text-on-surface">Register a patient</h2>
                </div>
                
                <p className="mb-4 rounded-lg bg-surface-container-low p-3 text-xs leading-relaxed text-on-surface-variant">
                  <strong>Note:</strong> An email verification link will be sent to the patient. They can set a password using the <em>Forgot password</em> flow after verification.
                </p>

                <div className="space-y-4">
                  <label className="block text-sm font-medium text-on-surface">
                    Clinic
                    <select value={clinicId} onChange={(event) => setClinicId(event.target.value)} className={inputClass} required>
                      {clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm font-medium text-on-surface">
                    Full name
                    <input value={newPatient.name} onChange={(event) => setNewPatient({ ...newPatient, name: event.target.value })} className={inputClass} required maxLength={120} placeholder="e.g. Nuwan Perera" />
                  </label>
                  <label className="block text-sm font-medium text-on-surface">
                    Email address
                    <input type="email" value={newPatient.email} onChange={(event) => setNewPatient({ ...newPatient, email: event.target.value })} className={inputClass} required maxLength={254} placeholder="patient@example.com" />
                  </label>
                  <label className="block text-sm font-medium text-on-surface">
                    Phone
                    <input value={newPatient.phone} onChange={(event) => setNewPatient({ ...newPatient, phone: event.target.value })} className={inputClass} maxLength={32} placeholder="07X XXX XXXX" />
                  </label>
                </div>

                <button type="submit" disabled={saving || !clinicId} className="mt-6 w-full rounded-lg bg-primary py-3 text-sm font-semibold text-on-primary shadow-sm transition hover:bg-primary-container disabled:opacity-60">
                  {saving ? 'Registering...' : 'Register patient'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <form onSubmit={saveContact} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-semibold text-on-surface mb-4">Update patient contact</h2>
            
            <div className="space-y-4">
              <label className="block text-sm font-medium text-on-surface">
                Full name
                <input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} className={inputClass} required />
              </label>
              <label className="block text-sm font-medium text-on-surface">
                Phone number
                <input value={editing.phone} onChange={(event) => setEditing({ ...editing, phone: event.target.value })} className={inputClass} />
              </label>
            </div>

            <p className="mt-3 text-xs text-on-surface-variant bg-surface-container-low p-2 rounded">
              Email cannot be edited here because it is the patient's verified sign-in identity.
            </p>

            <div className="mt-6 flex justify-end gap-3 border-t border-slate-100 pt-4">
              <button type="button" onClick={() => setEditing(null)} className="min-h-10 rounded-lg px-4 text-sm font-semibold text-on-surface-variant hover:bg-surface-container">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="min-h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-on-primary disabled:opacity-60">
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      )}
    </WorkspaceLayout>
  );
}
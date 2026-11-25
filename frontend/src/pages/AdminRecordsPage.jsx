import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import PortalHeading from '../components/common/PortalHeading';
import {
  AdminEmptyState,
  AdminNotice,
  AdminSection,
  AdminStatus,
  AdminTable,
  formatAdminDate,
} from '../components/admin/AdminComponents';
import {
  createAdminClinic,
  createAdminAdmin,
  createAdminDoctor,
  createAdminReceptionist,
  createAdminSpecialty,
  createAdminStaff,
  deleteAdminDoctor,
  deleteAdminAdmin,
  deleteAdminReceptionist,
  deleteAdminSpecialty,
  deleteAdminStaff,
  getAdminDoctor,
  getAdminAdmins,
  getAdminLookups,
  getAdminPatient,
  getAdminReceptionistDetail,
  getAdminStaffDetail,
  getAdminPatients,
  getAdminDoctors,
  getAdminClinics,
  getAdminSpecialties,
  getAdminReceptionists,
  getAdminStaff,
  updateAdminClinic,
  updateAdminAdmin,
  updateAdminDoctor,
  updateAdminPatient,
  updateAdminReceptionist,
  updateAdminSpecialty,
  updateAdminStaff,
} from '../services/api';

const activeField = { key: 'isActive', label: 'Account active', type: 'checkbox' };

const configs = {
  patients: {
    title: 'Patient Registry',
    description: 'Search patient accounts, review care history, and update permitted profile information.',
    list: getAdminPatients,
    detail: getAdminPatient,
    save: updateAdminPatient,
    key: 'patientId',
    columns: [
      { key: 'name', label: 'Patient' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' },
      { key: 'isActive', label: 'Portal access', render: (row) => <AdminStatus active={row.isActive} /> },
      { key: 'createdAt', label: 'Registered', render: (row) => formatAdminDate(row.createdAt) },
    ],
    fields: [
      { key: 'name', label: 'Full name', required: true },
      { key: 'email', label: 'Email', type: 'email', required: true },
      { key: 'phone', label: 'Phone' },
      { key: 'homeAddress', label: 'Home address', type: 'textarea' },
      activeField,
    ],
  },
  doctors: {
    title: 'Physician & Clinician Directory',
    description: 'Manage clinician accounts, specialties, clinic assignments, and appointment availability.',
    list: getAdminDoctors,
    detail: getAdminDoctor,
    create: createAdminDoctor,
    save: updateAdminDoctor,
    key: 'id',
    filters: ['specialtyId', 'clinicId'],
    columns: [
      { key: 'name', label: 'Clinician' }, { key: 'title', label: 'Title' },
      { key: 'specialties', label: 'Primary specialty', render: (row) => row.specialties?.[0] || '—' },
      { key: 'clinicId', label: 'Clinic', render: (row, lookups) => lookups.clinics.find((clinic) => clinic.id === row.clinicId)?.name || '—' },
      { key: 'consultationFee', label: 'Fee', render: (row) => `LKR ${row.consultationFee}` },
      { key: 'isActive', label: 'Account', render: (row) => <AdminStatus active={row.isActive} /> },
    ],
    fields: [
      { key: 'name', label: 'Full name', required: true },
      { key: 'email', label: 'Email', type: 'email', required: true },
      { key: 'password', label: 'Temporary password', type: 'password', requiredOnCreate: true },
      { key: 'title', label: 'Professional title', required: true },
      { key: 'yearsOfExperience', label: 'Years of experience', type: 'number', min: 0 },
      { key: 'consultationFee', label: 'Consultation fee (LKR)', type: 'number', min: 0, required: true },
      { key: 'image', label: 'Profile image URL', type: 'url' },
      { key: 'clinicId', label: 'Clinic', type: 'select', optionsKey: 'clinics' },
      { key: 'primarySpecialtyId', label: 'Primary specialty', type: 'select', optionsKey: 'specialties', required: true },
      { key: 'timeZone', label: 'Time zone', defaultValue: 'Asia/Colombo', required: true },
      { key: 'languages', label: 'Languages (comma-separated)', type: 'comma' },
      { key: 'education', label: 'Education', type: 'textarea' },
      { key: 'bio', label: 'Professional overview', type: 'textarea' },
      { key: 'acceptingAppointments', label: 'Accepting appointments', type: 'checkbox', updateOnly: true },
      { ...activeField, updateOnly: true },
    ],
  },
  clinics: {
    title: 'Clinic Network Management',
    description: 'Maintain clinic locations, contact details, and network availability.',
    list: getAdminClinics,
    create: createAdminClinic,
    save: updateAdminClinic,
    key: 'id',
    columns: [
      { key: 'name', label: 'Clinic' }, { key: 'city', label: 'Location' },
      { key: 'phone', label: 'Phone' }, { key: 'doctorCount', label: 'Doctors' },
      { key: 'appointmentCount', label: 'Appointments' },
      { key: 'isActive', label: 'Status', render: (row) => <AdminStatus active={row.isActive} /> },
    ],
    fields: [
      { key: 'name', label: 'Clinic name', required: true }, { key: 'city', label: 'City', required: true },
      { key: 'address', label: 'Street address', type: 'textarea' }, { key: 'phone', label: 'Phone' },
      { ...activeField, updateOnly: true },
    ],
  },
  specialties: {
    title: 'Clinical Specialties',
    singular: 'specialty',
    description: 'Manage the clinical specialties used in the provider directory and doctor profiles.',
    list: getAdminSpecialties,
    create: createAdminSpecialty,
    save: updateAdminSpecialty,
    statusFilter: false,
    key: 'id',
    columns: [
      { key: 'name', label: 'Specialty' }, { key: 'slug', label: 'Code' },
      { key: 'description', label: 'Description' },
    ],
    fields: [
      { key: 'name', label: 'Specialty name', required: true },
      { key: 'description', label: 'Description', type: 'textarea' },
    ],
  },
  staff: {
    title: 'Staff & User Directory',
    description: 'Manage support staff accounts and review ticket workload.',
    list: getAdminStaff,
    detail: getAdminStaffDetail,
    create: createAdminStaff,
    save: updateAdminStaff,
    key: 'id',
    columns: [
      { key: 'name', label: 'Staff member' }, { key: 'email', label: 'Email' },
      { key: 'assignedTickets', label: 'Assigned tickets' }, { key: 'activeTickets', label: 'Active tickets' },
      { key: 'isActive', label: 'Status', render: (row) => <AdminStatus active={row.isActive} /> },
    ],
    fields: [
      { key: 'name', label: 'Full name', required: true }, { key: 'email', label: 'Email', type: 'email', required: true },
      { key: 'password', label: 'Temporary password', type: 'password', requiredOnCreate: true },
      { ...activeField, updateOnly: true },
    ],
  },
  receptionists: {
    title: 'Receptionist Management',
    description: 'Create receptionist accounts and limit each account to its assigned clinic locations.',
    list: getAdminReceptionists,
    detail: getAdminReceptionistDetail,
    create: createAdminReceptionist,
    save: updateAdminReceptionist,
    key: 'id',
    columns: [
      { key: 'name', label: 'Receptionist' }, { key: 'email', label: 'Email' },
      { key: 'clinicIds', label: 'Assigned clinics', render: (row, lookups) => row.clinicIds?.map((id) => lookups.clinics.find((clinic) => clinic.id === id)?.name).filter(Boolean).join(', ') || 'No clinics' },
      { key: 'isActive', label: 'Status', render: (row) => <AdminStatus active={row.isActive} /> },
      { key: 'createdAt', label: 'Created', render: (row) => formatAdminDate(row.createdAt) },
    ],
    fields: [
      { key: 'name', label: 'Full name', required: true }, { key: 'email', label: 'Email', type: 'email', required: true },
      { key: 'password', label: 'Temporary password', type: 'password', requiredOnCreate: true },
      { key: 'clinicIds', label: 'Assigned clinics', type: 'multi', optionsKey: 'clinics', required: true },
      { ...activeField, updateOnly: true },
    ],
  },
  admins: {
    title: 'Admin Management',
    singular: 'admin',
    description: 'Create and manage Regular Admin accounts. Super Admin privileges cannot be granted here.',
    list: getAdminAdmins,
    create: createAdminAdmin,
    save: updateAdminAdmin,
    key: 'id',
    columns: [
      { key: 'name', label: 'Administrator' },
      { key: 'email', label: 'Email' },
      { key: 'isActive', label: 'Status', render: (row) => <AdminStatus active={row.isActive} /> },
      { key: 'createdAt', label: 'Created', render: (row) => formatAdminDate(row.createdAt) },
    ],
    fields: [
      { key: 'name', label: 'Full name', required: true },
      { key: 'email', label: 'Email', type: 'email', required: true },
      { key: 'password', label: 'Temporary password', type: 'password', requiredOnCreate: true },
      { ...activeField, updateOnly: true },
    ],
  },
};

function getDefaultValues(config, record, createMode) {
  const values = {};
  for (const field of config.fields) {
    if (field.updateOnly && createMode) continue;
    if (field.type === 'checkbox') values[field.key] = record?.[field.key] ?? true;
    else if (field.type === 'multi') values[field.key] = record?.[field.key] || [];
    else if (field.type === 'comma') values[field.key] = record?.[field.key]?.join(', ') || '';
    else values[field.key] = record?.[field.key] ?? field.defaultValue ?? '';
  }
  return values;
}

function presentPayload(config, values) {
  const payload = { ...values };
  
  for (const field of config.fields) {
    if (field.requiredOnCreate && (payload[field.key] === '' || payload[field.key] === undefined)) {
      delete payload[field.key];
    }
  }

  for (const field of config.fields) {
    if (field.type === 'number') {
      payload[field.key] = payload[field.key] === '' || payload[field.key] === undefined
        ? null
        : Number(payload[field.key]);
    }
    if (field.type === 'comma') {
      payload[field.key] = String(payload[field.key] || '').split(',').map((item) => item.trim()).filter(Boolean);
    }
    if (field.key === 'image' && payload[field.key] === '') payload[field.key] = null;
  }
  return payload;
}

function RecordForm({ config, record, lookups, saving, onCancel, onSave, error }) {
  const createMode = !record;
  const [values, setValues] = useState(() => getDefaultValues(config, record, createMode));
  const [showPassword, setShowPassword] = useState(false);
  
  const fields = config.fields.filter((field) => !(field.updateOnly && createMode) && !(field.requiredOnCreate && !createMode));
  const inputClass = 'mt-1.5 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15';

  const update = (key, value) => setValues((current) => ({ ...current, [key]: value }));
  const submit = (event) => {
    event.preventDefault();
    onSave(presentPayload(config, values));
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-3 sm:p-5" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="admin-form-title" className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-7">
        <h2 id="admin-form-title" className="text-xl font-semibold">{createMode ? `Add ${config.singular || config.title.replace(/s$/, '')}` : `Edit ${config.singular || config.title.replace(/s$/, '')}`}</h2>
        <form onSubmit={submit} className="mt-5">
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((field) => (
              <label key={field.key} className={`block ${field.type === 'textarea' || field.type === 'multi' ? 'sm:col-span-2' : ''}`}>
                {field.type === 'checkbox' ? (
                  <span className="flex min-h-11 items-center gap-3 text-sm font-medium"><input type="checkbox" checked={Boolean(values[field.key])} onChange={(event) => update(field.key, event.target.checked)} className="h-4 w-4 accent-primary" />{field.label}</span>
                ) : (
                  <>
                    <span className="text-sm font-medium text-on-surface">{field.label}</span>
                    
                    {field.type === 'textarea' ? (
                      <textarea value={values[field.key] || ''} onChange={(event) => update(field.key, event.target.value)} required={field.required} rows={3} className={`${inputClass} h-auto py-2.5`} />
                    ) : field.type === 'select' || field.type === 'multi' ? (
                      <select multiple={field.type === 'multi'} required={field.required} value={values[field.key] || (field.type === 'multi' ? [] : '')} onChange={(event) => update(field.key, field.type === 'multi' ? [...event.target.selectedOptions].map((option) => option.value) : event.target.value || null)} className={`${inputClass} ${field.type === 'multi' ? 'h-28' : ''}`}>
                        {field.type !== 'multi' && <option value="">{field.key === 'clinicId' ? 'No clinic assigned' : 'Select an option'}</option>}
                        {(lookups[field.optionsKey] || []).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                      </select>
                    ) : field.type === 'password' ? (
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={values[field.key] ?? ''}
                          onChange={(event) => update(field.key, event.target.value)}
                          required={field.required || (field.requiredOnCreate && createMode)}
                          minLength={12}
                          maxLength={128}
                          className={`${inputClass} pr-10`}
                          placeholder="••••••••"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute inset-y-0 bottom-3 right-0 flex items-center justify-center px-3 text-on-surface-variant hover:text-on-surface transition-colors"
                          aria-label={showPassword ? "Hide password" : "Show password"}
                        >
                          <span className="material-symbols-outlined text-[20px]">
                            {showPassword ? 'visibility_off' : 'visibility'}
                          </span>
                        </button>
                        <span className="mt-1 block text-xs text-on-surface-variant">Minimum 12 characters</span>
                      </div>
                    ) : (
                      <input type={field.type === 'comma' ? 'text' : field.type || 'text'} min={field.min} value={values[field.key] ?? ''} onChange={(event) => update(field.key, event.target.value)} required={field.required || (field.requiredOnCreate && createMode)} className={inputClass} />
                    )}
                    
                    {field.type === 'multi' && <span className="mt-1 block text-xs text-on-surface-variant">Hold Ctrl (Windows) or Command (Mac) to select multiple.</span>}
                  </>
                )}
              </label>
            ))}
          </div>
          {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={onCancel} disabled={saving} className="min-h-11 rounded-lg border border-slate-200 px-4 text-sm font-semibold">Cancel</button>
            <button type="submit" disabled={saving} className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-on-primary disabled:opacity-60">{saving ? 'Saving...' : 'Save changes'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default function AdminRecordsPage({ resource }) {
  const navigate = useNavigate();
  const config = configs[resource];
  const location = useLocation();
  const { recordId } = useParams();
  const [records, setRecords] = useState([]);
  const [lookups, setLookups] = useState({ clinics: [], specialties: [], doctors: [] });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [specialtyId, setSpecialtyId] = useState('');
  const [clinicId, setClinicId] = useState('');
  const [record, setRecord] = useState(null);
  const [detail, setDetail] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [pendingAccountDelete, setPendingAccountDelete] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorState, setErrorState] = useState(null);
  const error = errorState?.path === location.pathname ? errorState.message : '';
  const setError = useCallback((message) => {
    setErrorState(message ? { path: location.pathname, message } : null);
  }, [location.pathname]);
  const [notice, setNotice] = useState(null);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const pageSize = 20;
  const activePath = useRef(location.pathname);

  useEffect(() => {
    activePath.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    if (!['doctors', 'receptionists'].includes(resource)) return undefined;
    let active = true;
    getAdminLookups()
      .then(({ data }) => { if (active) setLookups(data); })
      .catch((requestError) => { if (active) setError(requestError.message || 'Unable to load lookup values.'); });
    return () => { active = false; };
  }, [resource, setError]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    config.list({ search, status, specialtyId, clinicId, limit: pageSize, offset: page * pageSize })
      .then(({ data, pagination }) => {
        if (!active) return;
        setRecords(data || []);
        setTotal(pagination?.total || 0);
      })
      .catch((requestError) => { if (active) setError(requestError.message || 'Unable to load records.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [config, resource, search, status, specialtyId, clinicId, page, setError]);

  useEffect(() => {
    if (!recordId) {
      setDetail(null);
      return;
    }

    if (config.detail) {
      let active = true;
      setLoading(true);
      config.detail(recordId)
        .then(({ data }) => { if (active) setDetail(data); })
        .catch((requestError) => { if (active) setError(requestError.message || 'Unable to load record details.'); })
        .finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }

    const existing = records.find((r) => r[config.key] === recordId);
    if (existing) {
      setDetail(existing);
      setLoading(false);
    }
  }, [recordId, config, records, setError]);

  const title = config.title;
  const detailTitle = useMemo(() => detail?.name || 'Record details', [detail]);
  
  const openEdit = async (item) => {
    setError('');
    if (config.detail) {
      try {
        const { data } = await config.detail(item[config.key]);
        setRecord(data);
      } catch (requestError) {
        setError(requestError.message || 'Unable to load record details for editing.');
        return;
      }
    } else {
      setRecord(item);
    }
    setModalOpen(true);
  };

  const save = async (payload) => {
    const requestPath = location.pathname;
    setSaving(true);
    setError('');
    try {
      if (!record && config.create) await config.create(payload);
      else if (config.save) await config.save(record[config.key], payload);
      setModalOpen(false);
      setRecord(null);
      if (activePath.current === requestPath) setNotice({ path: requestPath, message: 'Changes saved successfully.' });
      const { data, pagination } = await config.list({ search, status, specialtyId, clinicId, limit: pageSize, offset: page * pageSize });
      if (activePath.current !== requestPath) return;
      setRecords(data || []);
      setTotal(pagination?.total || 0);
      if (recordId && config.detail) {
        const { data: updatedDetail } = await config.detail(recordId);
        setDetail(updatedDetail);
      }
    } catch (requestError) {
      setError(requestError.message || 'Unable to save changes.');
    } finally {
      setSaving(false);
    }
  };

  const confirmStatusChange = async () => {
    if (!pendingStatus || pendingStatus.path !== location.pathname) return;
    const requestPath = location.pathname;
    const currentRecord = pendingStatus.record;
    const updated = { ...currentRecord, isActive: !currentRecord.isActive };
    try {
      if (resource === 'patients') {
        const patientDetails = await getAdminPatient(currentRecord[config.key]);
        await updateAdminPatient(currentRecord[config.key], {
          name: patientDetails.data.name,
          email: patientDetails.data.email,
          phone: patientDetails.data.phone,
          homeAddress: patientDetails.data.homeAddress,
          isActive: updated.isActive,
        });
      } else if (resource === 'doctors') {
        const doctorDetails = await getAdminDoctor(currentRecord.id);
        const doctor = doctorDetails.data;
        await updateAdminDoctor(currentRecord.id, {
          name: doctor.name,
          email: doctor.email,
          title: doctor.title,
          bio: doctor.bio,
          yearsOfExperience: doctor.yearsOfExperience,
          consultationFee: Number(doctor.consultationFee),
          image: doctor.image,
          clinicId: doctor.clinicId,
          timeZone: doctor.timeZone,
          education: doctor.education,
          languages: doctor.languages,
          primarySpecialtyId: doctor.primarySpecialtyId,
          acceptingAppointments: doctor.acceptingAppointments,
          isActive: updated.isActive,
        });
      } else if (resource === 'clinics') {
        const clinic = currentRecord;
        await updateAdminClinic(clinic.id, { name: clinic.name, city: clinic.city, address: clinic.address, phone: clinic.phone, isActive: updated.isActive });
      } else if (resource === 'staff') {
        await updateAdminStaff(currentRecord.id, { name: currentRecord.name, email: currentRecord.email, isActive: updated.isActive });
      } else if (resource === 'admins') {
        await updateAdminAdmin(currentRecord.id, {
          name: currentRecord.name, email: currentRecord.email, isActive: updated.isActive,
        });
      } else {
        await updateAdminReceptionist(currentRecord.id, {
          name: currentRecord.name,
          email: currentRecord.email,
          isActive: updated.isActive,
          clinicIds: currentRecord.clinicIds || [],
        });
      }
      setPendingStatus(null);
      if (activePath.current === requestPath) {
        setNotice({ path: requestPath, message: `Account ${updated.isActive ? 'reactivated' : 'deactivated'}.` });
      }
      const { data } = await config.list({ search, status, specialtyId, clinicId, limit: pageSize, offset: page * pageSize });
      if (activePath.current === requestPath) {
        setRecords(data || []);
        if (recordId && config.detail) {
          const { data: updatedDetail } = await config.detail(currentRecord[config.key]);
          setDetail(updatedDetail);
        }
      }
    } catch (requestError) {
      setError(requestError.message || 'Unable to change account status.');
      setPendingStatus(null);
    }
  };

  const confirmSpecialtyDelete = async () => {
    if (!pendingDelete || pendingDelete.path !== location.pathname) return;
    const requestPath = location.pathname;
    setError('');
    try {
      const { data } = await deleteAdminSpecialty(pendingDelete.record.id);
      if (activePath.current !== requestPath) return;
      setPendingDelete(null);
      setNotice({
        path: requestPath,
        message: data.inUse
          ? 'This specialty is assigned to one or more doctors and cannot be deleted.'
          : 'Specialty deleted.',
      });
      const { data: recordsResult, pagination } = await config.list({
        search, status, specialtyId, clinicId, limit: pageSize, offset: page * pageSize,
      });
      if (activePath.current === requestPath) {
        setRecords(recordsResult || []);
        setTotal(pagination?.total || 0);
      }
    } catch (requestError) {
      if (activePath.current === requestPath) {
        setError(requestError.message || 'Unable to delete specialty.');
        setPendingDelete(null);
      }
    }
  };

  const confirmAccountDelete = async () => {
    if (!pendingAccountDelete || pendingAccountDelete.path !== location.pathname) return;
    const requestPath = location.pathname;
    const record = pendingAccountDelete.record;
    setError('');
    try {
      if (resource === 'doctors') await deleteAdminDoctor(record.id);
      else if (resource === 'admins') await deleteAdminAdmin(record.id);
      else if (resource === 'staff') await deleteAdminStaff(record.id);
      else await deleteAdminReceptionist(record.id);
      setPendingAccountDelete(null);
      if (recordId) {
        navigate(`/admin/${resource}`, { replace: true });
        return;
      }
      if (activePath.current === requestPath) {
        setNotice({ path: requestPath, message: 'Account deleted.' });
        const { data, pagination } = await config.list({
          search, status, specialtyId, clinicId, limit: pageSize, offset: page * pageSize,
        });
        setRecords(data || []);
        setTotal(pagination?.total || 0);
      }
    } catch (requestError) {
      if (activePath.current === requestPath) {
        setError(requestError.message || 'Unable to delete account. Deactivate the account to preserve its records.');
        setPendingAccountDelete(null);
      }
    }
  };

  if (!config) return null;
  if (recordId) {
    if (loading && !detail) return <p className="py-12 text-center text-on-surface-variant">Loading record details...</p>;
    if (error) return <AdminNotice>{error}</AdminNotice>;
    if (!detail) return <AdminEmptyState title="Record not found" />;
    return (
      <>
        <PortalHeading
          eyebrow="Administration · record details"
          title={detailTitle}
          description={resource === 'patients'
            ? 'Patient profile and care history.'
            : resource === 'doctors'
              ? 'Clinician profile, availability, and appointment overview.'
              : resource === 'staff'
                ? 'Support staff profile, assignment history, and workload.'
                : 'Receptionist profile, clinic assignments, and appointment history.'}
          actions={(
            <>
              <Link to={`/admin/${resource}`} className="min-h-11 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold">Back to directory</Link>
            </>
          )}
        />
        {error && <AdminNotice>{error}</AdminNotice>}
        <div className="grid gap-5 lg:grid-cols-2">
          <AdminSection title={resource === 'patients' ? 'Patient profile' : 'Professional profile'}>
            <dl className="grid gap-3 sm:grid-cols-2">
              {Object.entries(detail)
                .filter(([key, value]) => 
                  !['id', 'userId', 'patientId', 'clinicId', 'appointments', 'tickets', 'availability', 'primarySpecialtyId', 'languages', 'currency'].includes(key) 
                  && value !== null 
                  && typeof value !== 'object'
                )
                .map(([key, value]) => (
                  <div key={key} className="rounded-lg bg-surface-container-low p-3">
                    <dt className="text-xs capitalize text-on-surface-variant">{key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}</dt>
                    <dd className="mt-1 break-words text-sm font-medium">{typeof value === 'boolean' ? <AdminStatus active={value} /> : String(value)}</dd>
                  </div>
                ))}
            </dl>
            
            {resource === 'doctors' && (
              <>
                {detail.clinicId && (
                  <p className="mt-4 text-sm">
                    <strong>Clinic:</strong> {lookups.clinics.find((clinic) => clinic.id === detail.clinicId)?.name || '—'}
                  </p>
                )}
                <p className="mt-4 text-sm"><strong>Specialties:</strong> {detail.specialties?.join(', ') || 'None assigned'}</p>
                <p className="mt-2 text-sm"><strong>Languages:</strong> {detail.languages?.join(', ') || 'Not listed'}</p>
                <p className="mt-2 text-sm"><strong>Total appointments:</strong> {detail.appointmentCount}</p>
              </>
            )}

            {resource === 'receptionists' && detail.clinicIds && (
              <p className="mt-4 text-sm">
                <strong>Assigned Clinics:</strong>{' '}
                {detail.clinicIds.map((id) => lookups.clinics.find((c) => c.id === id)?.name).filter(Boolean).join(', ') || '—'}
              </p>
            )}

            <button type="button" onClick={() => openEdit(detail)} className="mt-5 min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-on-primary">Edit record</button>
          </AdminSection>
          {resource === 'doctors' && <AdminSection title="Weekly availability"><AdminTable columns={[{ key: 'dayOfWeek', label: 'Weekday', render: (row) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][row.dayOfWeek] }, { key: 'startTime', label: 'Start' }, { key: 'endTime', label: 'End' }, { key: 'slotDurationMinutes', label: 'Slot length', render: (row) => `${row.slotDurationMinutes} min` }, { key: 'isAvailable', label: 'Available', render: (row) => row.isAvailable ? 'Yes' : 'No' }]} rows={detail.availability || []} /></AdminSection>}
          {resource === 'patients' && <AdminSection title="Appointment history"><AdminTable columns={[{ key: 'scheduledStart', label: 'Date', render: (row) => formatAdminDate(row.scheduledStart, { timeStyle: 'short' }) }, { key: 'doctorName', label: 'Doctor' }, { key: 'clinicName', label: 'Clinic' }, { key: 'status', label: 'Status' }]} rows={detail.appointments || []} /></AdminSection>}
          {resource === 'staff' && <AdminSection title="Assigned support tickets"><AdminTable columns={[{ key: 'ticketNumber', label: 'Ticket' }, { key: 'subject', label: 'Subject' }, { key: 'status', label: 'Status' }, { key: 'updatedAt', label: 'Updated', render: (row) => formatAdminDate(row.updatedAt) }]} rows={detail.tickets || []} /></AdminSection>}
          {resource === 'receptionists' && <AdminSection title="Appointments created"><AdminTable columns={[{ key: 'scheduledStart', label: 'Date', render: (row) => formatAdminDate(row.scheduledStart, { timeStyle: 'short' }) }, { key: 'patientName', label: 'Patient' }, { key: 'clinicName', label: 'Clinic' }, { key: 'workflowStatus', label: 'Workflow status' }]} rows={detail.appointments || []} /></AdminSection>}
          {resource === 'patients' && <AdminSection title="Support ticket history" className="lg:col-span-2"><AdminTable columns={[{ key: 'ticketNumber', label: 'Reference' }, { key: 'subject', label: 'Subject' }, { key: 'category', label: 'Category' }, { key: 'status', label: 'Status' }, { key: 'createdAt', label: 'Created', render: (row) => formatAdminDate(row.createdAt) }]} rows={detail.tickets || []} /></AdminSection>}
        </div>
        {modalOpen && <RecordForm config={config} record={detail} lookups={lookups} saving={saving} onCancel={() => setModalOpen(false)} onSave={save} error={error} />}
      </>
    );
  }

  return (
    <>
      <PortalHeading
        eyebrow="Administration · management"
        title={title}
        description={config.description}
        actions={config.create && <button type="button" onClick={() => { setRecord(null); setError(''); setModalOpen(true); }} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-on-primary"><span className="material-symbols-outlined text-lg">add</span>Add record</button>}
      />
      {notice?.path === location.pathname && <AdminNotice type="success">{notice.message}</AdminNotice>}
      {error && <AdminNotice>{error}</AdminNotice>}
      <AdminSection>
        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="block"><span className="sr-only">Search records</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Search name, email or details" className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-primary" /></label>
          {config.statusFilter !== false && <select aria-label="Filter by account status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }} className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select>}
          {config.filters?.includes('specialtyId') && <select aria-label="Filter by specialty" value={specialtyId} onChange={(event) => setSpecialtyId(event.target.value)} className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="">All specialties</option>{lookups.specialties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
          {config.filters?.includes('clinicId') && <select aria-label="Filter by clinic" value={clinicId} onChange={(event) => setClinicId(event.target.value)} className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="">All clinics</option>{lookups.clinics.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
          <p className="self-center text-xs text-on-surface-variant">{total} records · page {page + 1}</p>
        </div>
        {loading ? <p className="py-10 text-center text-sm text-on-surface-variant">Loading records...</p> : (
          <AdminTable
            columns={config.columns.map((column) => ({ ...column, render: column.render ? (row) => column.render(row, lookups) : undefined }))}
            rows={records}
            rowKey={config.key}
            renderActions={(item) => (
              <div className="flex justify-end gap-3">
                {['patients', 'doctors', 'staff', 'receptionists'].includes(resource) && (
                  <Link to={`/admin/${resource}/${item[config.key]}`} className="font-semibold text-primary hover:underline">View</Link>
                )}
                <button type="button" onClick={() => openEdit(item)} className="font-semibold text-primary hover:underline">Edit</button>
                {['patients', 'doctors', 'staff', 'receptionists', 'admins'].includes(resource) && <button type="button" onClick={() => setPendingStatus({ path: location.pathname, record: item })} className="font-semibold text-on-surface-variant hover:text-error">{item.isActive ? 'Deactivate' : 'Reactivate'}</button>}
                {['doctors', 'staff', 'receptionists', 'admins'].includes(resource) && <button type="button" onClick={() => setPendingAccountDelete({ path: location.pathname, record: item })} className="font-semibold text-red-600 hover:text-red-800 hover:underline">Delete</button>}
                {resource === 'specialties' && <button type="button" onClick={() => setPendingDelete({ path: location.pathname, record: item })} className="font-semibold text-red-600 hover:text-red-800">Delete</button>}
              </div>
            )}
          />
        )}
        {total > pageSize && <div className="mt-4 flex items-center justify-between"><button type="button" disabled={!page} onClick={() => setPage((value) => Math.max(0, value - 1))} className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm disabled:opacity-40">Previous</button><span className="text-sm text-on-surface-variant">{page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}</span><button type="button" disabled={(page + 1) * pageSize >= total} onClick={() => setPage((value) => value + 1)} className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm disabled:opacity-40">Next</button></div>}
      </AdminSection>
      {modalOpen && <RecordForm config={config} record={record} lookups={lookups} saving={saving} onCancel={() => { setModalOpen(false); setRecord(null); }} onSave={save} error={error} />}
      {pendingStatus?.path === location.pathname && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4"><section role="dialog" aria-modal="true" aria-labelledby="confirm-account-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h2 id="confirm-account-title" className="text-lg font-semibold">{pendingStatus.record.isActive ? 'Deactivate' : 'Reactivate'} this account?</h2><p className="mt-2 text-sm text-on-surface-variant">{pendingStatus.record.isActive ? 'Active sessions will be revoked. Existing appointments and history remain unchanged.' : 'This account will be able to sign in again.'}</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setPendingStatus(null)} className="min-h-10 rounded-lg border border-slate-200 px-4 text-sm font-semibold">Keep current status</button><button type="button" onClick={confirmStatusChange} className="min-h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-on-primary">Confirm</button></div></section></div>}
      {pendingDelete?.path === location.pathname && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4"><section role="dialog" aria-modal="true" aria-labelledby="confirm-specialty-delete-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h2 id="confirm-specialty-delete-title" className="text-lg font-semibold">Delete this specialty?</h2><p className="mt-2 text-sm text-on-surface-variant">Specialties assigned to doctors are protected and cannot be deleted. Existing doctor and appointment records will not be removed.</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setPendingDelete(null)} className="min-h-10 rounded-lg border border-slate-200 px-4 text-sm font-semibold">Cancel</button><button type="button" onClick={confirmSpecialtyDelete} className="min-h-10 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-800">Delete specialty</button></div></section></div>}
      {pendingAccountDelete?.path === location.pathname && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4"><section role="dialog" aria-modal="true" aria-labelledby="confirm-account-delete-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h2 id="confirm-account-delete-title" className="text-lg font-semibold">Permanently delete this account?</h2><p className="mt-2 text-sm text-on-surface-variant">Historical appointments, assignments, or messages protect related accounts. If records exist, deletion will be blocked and you can deactivate the account instead.</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setPendingAccountDelete(null)} className="min-h-10 rounded-lg border border-slate-200 px-4 text-sm font-semibold">Cancel</button><button type="button" onClick={confirmAccountDelete} className="min-h-10 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-800">Delete account</button></div></section></div>}
    </>
  );
}
import { useEffect, useState } from 'react';
import PortalHeading from '../components/common/PortalHeading';
import { getAdminScheduleDoctors } from '../services/api';
import { DoctorScheduleCalendar } from './DoctorSchedulePage';

const inputClass = 'mt-1.5 min-h-11 w-full max-w-xl rounded-lg border border-slate-200 bg-white px-3 text-sm';

export default function AdminDoctorSchedulePage() {
  const [doctors, setDoctors] = useState([]);
  const [doctorId, setDoctorId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getAdminScheduleDoctors()
      .then(({ data }) => {
        if (active) setDoctors(data);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || 'Unable to load doctors.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const selectedDoctor = doctors.find((doctor) => doctor.id === doctorId);

  return (
    <div className="space-y-5">
      <PortalHeading
        eyebrow="Administration · provider availability"
        title="Doctor schedules"
        description="Review and manage a doctor's date-specific appointment availability."
      />

      <section className="rounded-2xl bg-surface-container-lowest p-4 shadow-sm ring-1 ring-slate-200 sm:p-6">
        <label className="block text-sm font-medium text-on-surface" htmlFor="schedule-doctor">
          Select doctor
          <select
            id="schedule-doctor"
            className={inputClass}
            value={doctorId}
            disabled={loading || doctors.length === 0}
            onChange={(event) => {
              setDoctorId(event.target.value);
              setError('');
            }}
          >
            <option value="">{loading ? 'Loading doctors...' : 'Choose a doctor'}</option>
            {doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>{doctor.name}</option>
            ))}
          </select>
        </label>
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        {!loading && !error && doctors.length === 0 && (
          <p className="mt-3 text-sm text-on-surface-variant">No active doctors are available.</p>
        )}
      </section>

      {selectedDoctor && (
        <DoctorScheduleCalendar
          key={selectedDoctor.id}
          adminDoctorId={selectedDoctor.id}
          doctorName={selectedDoctor.name}
        />
      )}
    </div>
  );
}

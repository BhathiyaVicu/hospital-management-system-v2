import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { completeFirstLogin } from '../services/api';

function homeForRole(role) {
  if (role === 'patient') return '/dashboard';
  if (role === 'doctor') return '/doctor/dashboard';
  if (role === 'admin') return '/admin/dashboard';
  if (role === 'staff') return '/staff/support';
  if (role === 'receptionist') return '/receptionist/dashboard';
  return '/';
}

export default function FirstLoginPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const continueWithCurrentPassword = async () => {
    setLoading(true);
    setError('');
    try {
      const { user } = await completeFirstLogin();
      navigate(homeForRole(user.role), { replace: true });
    } catch (requestError) {
      setError(requestError.message || 'Unable to continue with your current password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-10 sm:py-16">
      <section className="rounded-2xl bg-surface-container-lowest p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-container/15 text-primary">
          <span className="material-symbols-outlined">verified_user</span>
        </span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-primary">First sign-in</p>
        <h1 className="mt-1 text-2xl font-semibold text-on-surface">Choose how to continue</h1>
        <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
          You can keep the temporary password provided by your administrator or replace it with a new password now.
        </p>
        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="mt-6 grid gap-3">
          <button
            type="button"
            onClick={() => navigate('/change-password')}
            disabled={loading}
            className="min-h-11 w-full rounded-lg border border-slate-200 px-4 text-sm font-semibold text-on-surface disabled:opacity-60"
          >
            Change my password
          </button>
          <button
            type="button"
            onClick={continueWithCurrentPassword}
            disabled={loading}
            className="min-h-11 w-full rounded-lg bg-primary px-4 text-sm font-semibold text-on-primary disabled:opacity-60"
          >
            {loading ? 'Continuing...' : 'Continue with current password'}
          </button>
        </div>
      </section>
    </div>
  );
}

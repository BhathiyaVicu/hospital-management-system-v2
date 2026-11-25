import { useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../services/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    try {
      const result = await forgotPassword({ email });
      setMessage(result.message || 'If an account exists for this email, password reset instructions will be sent.');
    } catch (error) {
      setMessage(error.message || 'Unable to process this request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-surface px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-xl rounded-3xl bg-surface-container-lowest p-6 shadow-[0_20px_50px_rgba(8,15,25,0.08)] ring-1 ring-slate-200 sm:p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-surface-container text-primary">
            <span className="material-symbols-outlined text-4xl">lock_reset</span>
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Account recovery</p>
          <h1 className="mt-3 text-3xl font-semibold text-on-surface">Reset your password</h1>
          <p className="mt-3 text-sm text-on-surface-variant">
            Enter your email address and Supabase will send you a secure password reset link.
          </p>
        </div>
        {message && <p role="status" className="mb-5 rounded-xl bg-surface-container p-3 text-sm text-on-surface-variant">{message}</p>}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="reset-email" className="mb-2 block text-sm font-medium text-on-surface">Email address</label>
            <input
              id="reset-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              className="w-full rounded-xl border border-slate-200 bg-surface-container-lowest px-3 py-3 text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
          </div>
          <button disabled={submitting} type="submit" className="w-full rounded-xl bg-primary px-4 py-3.5 text-sm font-semibold text-on-primary disabled:opacity-60">
            {submitting ? 'Sending...' : 'Send reset link'}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-on-surface-variant">
          Return to <Link to="/login" className="font-semibold text-primary">sign in</Link>
        </p>
      </div>
    </div>
  );
}

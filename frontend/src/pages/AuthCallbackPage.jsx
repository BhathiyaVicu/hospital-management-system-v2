import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { setAccessToken } from '../services/api';
import { getSupabaseClient } from '../services/supabase';

const dashboardByRole = {
  patient: '/dashboard',
  doctor: '/doctor/dashboard',
  admin: '/admin/dashboard',
  staff: '/staff/support',
  receptionist: '/receptionist/dashboard',
};

export default function AuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [errorMessage, setErrorMessage] = useState('');
  const started = useRef(false);
  const code = searchParams.get('code');
  const errorDescription = searchParams.get('error_description');

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function completeSignIn() {
      try {
        if (errorDescription) throw new Error(errorDescription);

        const supabase = getSupabaseClient();
        let session;
        let user;

        if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          session = data.session;
          user = data.user;
        } else {
          const hashParams = new URLSearchParams(window.location.hash.slice(1));
          const accessToken = hashParams.get('access_token');
          const refreshToken = hashParams.get('refresh_token');
          if (!accessToken || !refreshToken) {
            throw new Error('The sign-in link is invalid or has expired. Request a new link and try again.');
          }
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
          session = data.session;
          user = data.user;
        }

        if (!session?.access_token || !user) {
          throw new Error('The sign-in link did not return a valid session. Request a new link and try again.');
        }

        setAccessToken(session.access_token, session.refresh_token);
        window.dispatchEvent(new CustomEvent('auth:session-changed'));
        const role = user.user_metadata?.role || 'patient';
        navigate(dashboardByRole[role] || dashboardByRole.patient, { replace: true });
      } catch (error) {
        setErrorMessage(error.message || 'Unable to complete sign-in. Request a new link and try again.');
      }
    }

    completeSignIn();
  }, [code, errorDescription, navigate]);

  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      {errorMessage ? (
        <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : (
        <div role="status" className="text-on-surface-variant">
          <span className="material-symbols-outlined mb-3 animate-spin text-4xl">progress_activity</span>
          <p>Verifying your sign-in link...</p>
        </div>
      )}
    </div>
  );
}

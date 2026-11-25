import { randomUUID } from 'node:crypto';
import { getEnv } from '../config/env.js';
import { supabaseAdmin, supabaseAnon } from '../config/supabase.js';
import * as authRepository from '../repositories/authRepository.js';
import { run } from '../repositories/supabaseHelpers.js';
import { recordActivity } from './auditService.js';

const GENERIC_RESET_MESSAGE = 'If an account exists for this email, password reset instructions will be sent.';
const GENERIC_VERIFICATION_MESSAGE = 'If the account can be verified, a verification link will be sent.';

function authError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export async function register({ name, email, password, phone }) {
  await authRepository.registerPatient({ name, email, password, phone });
  return { message: 'Registration created. Check your email to verify your account.' };
}

export async function registerPatientAtClinic({ name, email, phone, clinicId, actor, request }) {
  const password = `${randomUUID()}${randomUUID()}!`;
  const user = await authRepository.registerPatient({ name, email, password, phone });
  await run(supabaseAdmin.from('patient_clinics').insert({
    patient_id: user.patient_id, clinic_id: clinicId, created_by_user_id: actor.id,
  }));
  await recordActivity({
    actor, targetUserId: user.id, eventType: 'patient.registered_by_receptionist', request, details: { clinicId },
  });
  return {
    patientId: user.patient_id, name: user.name, email: user.email,
    message: 'Patient registered. They must verify their email, then use Forgot password to set their sign-in password.',
  };
}

export async function login({ email, password }, request) {
  const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });
  const authUser = data?.user;
  const user = authUser ? await authRepository.getUserById(authUser.id) : null;
  if (error || !authUser || !user || !user.is_active) {
    await recordActivity({
      actor: user ? { id: user.id, role: user.role } : null,
      targetUserId: user?.id || null, attemptedEmail: email, eventType: 'login.failed', success: false, request,
    });
    throw authError('Invalid email or password.', 401);
  }
  if (!authUser.email_confirmed_at || !user.email_verified_at) {
    await recordActivity({
      actor: { id: user.id, role: user.role }, targetUserId: user.id, attemptedEmail: email,
      eventType: 'login.failed', success: false, request, details: { reason: 'email_not_verified' },
    });
    throw authError('Verify your email address before signing in.', 403);
  }
  const patient = await authRepository.getPatientByUserId(user.id);
  await recordActivity({
    actor: { id: user.id, role: user.role }, targetUserId: user.id, attemptedEmail: email,
    eventType: 'login.succeeded', request,
  });
  return {
    token: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: new Date(data.session.expires_at * 1000),
    user: {
      id: user.id, name: user.name, email: user.email, role: user.role,
      isSuperAdmin: user.is_super_admin === true,
      mustChangePassword: user.must_change_password, patient_id: patient?.id || null,
    },
  };
}

export async function refreshSession(refreshToken) {
  const { data, error } = await supabaseAnon.auth.refreshSession({ refresh_token: refreshToken });
  const authUser = data?.user;
  const user = authUser ? await authRepository.getUserById(authUser.id) : null;
  if (error || !data?.session || !authUser || !user || !user.is_active) {
    throw authError('Session refresh failed. Please sign in again.', 401);
  }
  const patient = await authRepository.getPatientByUserId(user.id);
  return {
    token: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: new Date(data.session.expires_at * 1000),
    user: {
      id: user.id, name: user.name, email: user.email, role: user.role,
      isSuperAdmin: user.is_super_admin === true,
      mustChangePassword: user.must_change_password, patient_id: patient?.id || null,
    },
  };
}

export async function verifyEmail(email, token, accessToken = null) {
  const isEmailOtp = Boolean(email && /^\d{6,8}$/.test(token));
  const { data, error } = accessToken
    ? await supabaseAdmin.auth.getUser(accessToken)
    : isEmailOtp
      ? await supabaseAnon.auth.verifyOtp({ email, token, type: 'signup' })
      : await supabaseAnon.auth.verifyOtp({ token_hash: token, type: 'signup' });
  if (error || !data.user || (email && data.user.email?.toLowerCase() !== email.toLowerCase())) {
    throw authError('This verification link is invalid, expired, or already used.', 400);
  }
  return authRepository.getUserById(data.user.id);
}

export async function resendVerification(email) {
  const { error } = await supabaseAnon.auth.resend({
    type: 'signup', email,
    options: { emailRedirectTo: `${getEnv().FRONTEND_URL}/auth/callback` },
  });
  if (error) console.warn('Supabase verification email could not be resent:', error.message);
  return { message: GENERIC_VERIFICATION_MESSAGE };
}

export async function logout(accessToken) {
  if (!accessToken) return;
  const { error } = await supabaseAdmin.auth.admin.signOut(accessToken, 'global');
  if (error) throw new Error(error.message);
}

export async function recordLogout(user, request) {
  await recordActivity({
    actor: { id: user.id, role: user.role }, targetUserId: user.id, eventType: 'logout', request,
  });
}

export async function changePassword(user, { currentPassword, newPassword }, request) {
  const { error: signInError } = await supabaseAnon.auth.signInWithPassword({ email: user.email, password: currentPassword });
  if (signInError) {
    await recordActivity({
      actor: { id: user.id, role: user.role }, targetUserId: user.id,
      eventType: 'password.change.failed', success: false, request,
    });
    throw authError('Current password is incorrect.', 400);
  }
  const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, { password: newPassword });
  if (error) throw authError(error.message, 400);
  await run(supabaseAdmin.from('users').update({ must_change_password: false }).eq('id', user.id));
  const { data: sessionData, error: sessionError } = await supabaseAnon.auth.signInWithPassword({
    email: user.email,
    password: newPassword,
  });
  if (sessionError || !sessionData.session) {
    throw authError('Password changed, but a new session could not be established. Please sign in with your new password.', 500);
  }
  await recordActivity({
    actor: { id: user.id, role: user.role }, targetUserId: user.id,
    eventType: 'password.changed', request,
  });
  return {
    token: sessionData.session.access_token,
    refreshToken: sessionData.session.refresh_token,
    user: { id: user.id, role: user.role },
  };
}

export async function completeFirstLogin(user, request) {
  if (!user.must_change_password) return { id: user.id, role: user.role };
  await run(supabaseAdmin.from('users').update({ must_change_password: false }).eq('id', user.id));
  await recordActivity({
    actor: { id: user.id, role: user.role },
    targetUserId: user.id,
    eventType: 'password.first_login.continued',
    request,
  });
  return { id: user.id, role: user.role };
}

export async function requestPasswordReset(email) {
  const { error } = await supabaseAnon.auth.resetPasswordForEmail(email, {
    redirectTo: `${getEnv().FRONTEND_URL}/reset-password`,
  });
  if (error) console.warn('Supabase password reset email could not be sent:', error.message);
  return { message: GENERIC_RESET_MESSAGE };
}

export async function resetPassword(accessToken, newPassword) {
  if (!accessToken) throw authError('The password reset link is invalid or expired.', 400);
  const { data, error: verifyError } = await supabaseAdmin.auth.getUser(accessToken);
  if (verifyError || !data.user) throw authError('The password reset link is invalid or expired.', 400);
  const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user.id, { password: newPassword });
  if (error) throw authError(error.message, 400);
}

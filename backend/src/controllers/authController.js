import * as authService from '../services/authService.js';

export async function register(req, res) {
  const result = await authService.register(req.validated.body);
  return res.status(201).json(result);
}

export async function login(req, res) {
  const result = await authService.login(req.validated.body, req);
  return res.json({
    token: result.token,
    refreshToken: result.refreshToken,
    expiresAt: result.expiresAt,
    user: result.user,
  });
}

export async function refresh(req, res) {
  const result = await authService.refreshSession(req.validated.body.refreshToken);
  return res.json({
    token: result.token,
    refreshToken: result.refreshToken,
    expiresAt: result.expiresAt,
    user: result.user,
  });
}

export async function me(req, res) {
  if (!req.user) {
    return res.status(401).json({ message: 'User not found in request.' });
  }
  const { id, name, email, role, email_verified_at: emailVerifiedAt } = req.user;
  return res.json({
    user: {
      id, name, email, role,
      isSuperAdmin: req.user.is_super_admin === true,
      emailVerified: Boolean(emailVerifiedAt),
      mustChangePassword: req.user.must_change_password,
    },
  });
}

export async function logout(req, res) {
  await authService.recordLogout(req.user, req);
  await authService.logout(req.user.access_token);
  return res.json({ message: 'Logout successful.' });
}

export async function changePassword(req, res) {
  const result = await authService.changePassword(req.user, req.validated.body, req);
  return res.json({ message: 'Password changed successfully.', ...result });
}

export async function completeFirstLogin(req, res) {
  const user = await authService.completeFirstLogin(req.user, req);
  return res.json({ message: 'You can continue with your current password.', user });
}

export async function verifyEmail(req, res) {
  const { email, token, accessToken } = req.validated.body;
  const user = await authService.verifyEmail(email, token, accessToken);
  return res.json({ message: 'Email verified successfully.', user });
}

export async function resendVerification(req, res) {
  return res.json(await authService.resendVerification(req.validated.body.email));
}

export async function forgotPassword(req, res) {
  return res.json(await authService.requestPasswordReset(req.validated.body.email));
}

export async function resetPassword(req, res) {
  const accessToken = req.validated.body.accessToken || req.get('authorization')?.replace(/^Bearer\s+/i, '');
  await authService.resetPassword(accessToken, req.validated.body.newPassword);
  return res.json({ message: 'Password updated successfully.' });
}

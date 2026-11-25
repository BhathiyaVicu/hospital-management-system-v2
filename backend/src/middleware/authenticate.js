import { supabaseAdmin, supabaseAnon } from '../config/supabase.js';
import { getPatientByUserId, getUserById } from '../repositories/authRepository.js';

export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Authentication is required.' });
    }

    const token = authHeader.split(' ')[1];

    const { data: { user: authUser }, error } = await supabaseAnon.auth.getUser(token);

    if (error || !authUser) {
      return res.status(401).json({ message: 'Session is invalid or expired.' });
    }

    const user = await getUserById(authUser.id);
    if (!user || !user.is_active) {
      return res.status(401).json({ message: 'Session is invalid or expired.' });
    }

    const patient = await getPatientByUserId(user.id);

    req.user = {
      ...user,
      email_verified_at: authUser.email_confirmed_at || user.email_verified_at,
      must_change_password: user.must_change_password,
      patient_id: patient?.id || null,
      access_token: token,
    };

    const allowedDuringPasswordChange = [
      '/api/auth/me',
      '/api/auth/logout',
      '/api/auth/change-password',
      '/api/auth/complete-first-login',
    ].includes(req.originalUrl.split('?')[0]);

    if (req.user.must_change_password && !allowedDuringPasswordChange) {
      return res.status(403).json({
        message: 'Change your temporary password before continuing.',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }

    return next();
  } catch (error) {
    console.error('AUTH MIDDLEWARE CRASH:', error);
    return res.status(500).json({ message: 'Internal server error during authentication.' });
  }
}

export function requireVerifiedEmail(req, res, next) {
  if (!req.user?.email_verified_at) {
    return res.status(403).json({ message: 'Verify your email address before continuing.' });
  }
  return next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission to perform this action.' });
    }
    return next();
  };
}

export function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin' || req.user.is_super_admin !== true) {
    return res.status(403).json({ message: 'Super Admin privileges are required for this action.' });
  }
  return next();
}
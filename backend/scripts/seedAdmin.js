import 'dotenv/config';
import { getEnv } from '../src/config/env.js';
import { supabaseAdmin } from '../src/config/supabase.js';

async function seedAdmin() {
  const env = getEnv();
  if (env.NODE_ENV === 'production') {
    throw new Error('The development administrator seed is disabled in production.');
  }
  const email = process.env.ADMIN_SEED_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_SEED_PASSWORD;
  if (!email || !password) {
    throw new Error('Set ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD in the local backend environment.');
  }
  if (password.length < 12 || password.length > 128) {
    throw new Error('ADMIN_SEED_PASSWORD must be between 12 and 128 characters.');
  }
  process.env.ADMIN_SEED_PASSWORD = '';
  const { data: existing, error: lookupError } = await supabaseAdmin.from('users')
    .select('id,role,is_super_admin').eq('email', email).maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (existing) {
    if (existing.role !== 'admin') {
      throw new Error('The configured seed email belongs to an account that is not an administrator.');
    }
    if (!existing.is_super_admin) {
      const { error: promoteError } = await supabaseAdmin.from('users')
        .update({ is_super_admin: true }).eq('id', existing.id);
      if (promoteError) throw new Error(promoteError.message);
    }
    console.log('Development Super Admin is ready.');
    return;
  }
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { name: 'MediConnect Administrator', role: 'admin' },
  });
  if (error) throw new Error(error.message);
  const { error: updateError } = await supabaseAdmin.from('users').update({
    role: 'admin', is_super_admin: true, must_change_password: true,
  }).eq('id', data.user.id);
  if (updateError) throw new Error(updateError.message);
  console.log('Development administrator provisioning completed.');
}

seedAdmin().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

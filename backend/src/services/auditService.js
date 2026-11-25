import { supabaseAdmin } from '../config/supabase.js';
import { run } from '../repositories/supabaseHelpers.js';

export async function recordActivity({
  actor = null,
  targetUserId = null,
  attemptedEmail = null,
  eventType,
  success = true,
  request = null,
  details = {},
}) {
  await run(supabaseAdmin.from('admin_activity_logs').insert({
    actor_user_id: actor?.id || null,
    actor_role: actor?.role || null,
    target_user_id: targetUserId,
    attempted_email: attemptedEmail,
    event_type: eventType,
    success,
    ip_address: request?.ip || null,
    user_agent: request?.get('user-agent') || null,
    details,
  }));
}

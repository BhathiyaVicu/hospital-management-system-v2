import { supabaseAdmin } from '../config/supabase.js';
import { run, pagedRows } from './supabaseHelpers.js';

export async function create({
  userId, title, message, link = null, type = 'general', metadata = {}, dedupeKey = null,
}) {
  const notification = {
    user_id: userId, title, message, link, type, metadata, dedupe_key: dedupeKey,
  };
  const request = dedupeKey
    ? supabaseAdmin.from('notifications').insert(notification, {
      onConflict: 'user_id,dedupe_key', ignoreDuplicates: true,
    }).select('*').maybeSingle()
    : supabaseAdmin.from('notifications').insert(notification).select('*').single();
  const { data } = await run(request);
  return data;
}

export async function listForUser(userId) {
  const data = await pagedRows(() => supabaseAdmin.from('notifications').select('*')
    .eq('user_id', userId).order('created_at', { ascending: false }));
  return data.map((item) => ({
    id: item.id, title: item.title, message: item.message, link: item.link,
    type: item.type, metadata: item.metadata, readAt: item.read_at, createdAt: item.created_at,
  }));
}

export async function markAsRead(id, userId) {
  const { data } = await run(supabaseAdmin.from('notifications').update({ read_at: new Date().toISOString() })
    .eq('id', id).eq('user_id', userId).is('read_at', null).select('id').maybeSingle());
  return Boolean(data);
}

export async function markAllAsRead(userId) {
  const { data } = await run(supabaseAdmin.from('notifications').update({ read_at: new Date().toISOString() })
    .eq('user_id', userId).is('read_at', null).select('id'));
  return data?.length || 0;
}

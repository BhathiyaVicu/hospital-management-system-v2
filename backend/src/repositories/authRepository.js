import { supabaseAdmin, supabaseAnon } from '../config/supabase.js';
import { run } from './supabaseHelpers.js';

export async function registerPatient({ name, email, password, phone }) {
  const { data, error } = await supabaseAnon.auth.signUp({
    email, password,
    options: {
      data: { name, role: 'patient' },
      emailRedirectTo: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/auth/callback`,
    },
  });
  if (error) {
    const failure = new Error(error.message);
    failure.status = 400;
    throw failure;
  }
  if (!data.user) throw new Error('Supabase Auth did not return the registered user.');
  const { data: profile } = await run(supabaseAdmin.from('users').select('id,name,email,role,email_verified_at')
    .eq('id', data.user.id).maybeSingle());
  if (!profile) throw new Error('Supabase Auth user profile trigger did not create public.users.');
  const { data: patient } = await run(supabaseAdmin.from('patients').insert({
    user_id: data.user.id, phone: phone || null,
  }).select('id').single());
  return { ...profile, patient_id: patient.id };
}

export async function getUserById(userId) {
  const { data } = await run(supabaseAdmin.from('users').select('*').eq('id', userId).maybeSingle());
  return data || null;
}

export async function getPatientByUserId(userId) {
  const { data } = await run(supabaseAdmin.from('patients').select('id').eq('user_id', userId).maybeSingle());
  return data || null;
}

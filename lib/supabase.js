// Varden — Supabase client
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://ljruzruhbqkbxkflrvzi.supabase.co';
const SUPABASE_ANON = import.meta.env?.SUPABASE_ANON;

if (!SUPABASE_ANON) {
  throw new Error('Varden: Missing SUPABASE_ANON environment variable. Add it to Vercel Settings → Environment Variables.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);
console.log('Varden: Supabase client initialized');

// Auth helpers
export async function signUp(email, password, displayName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } }
  });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export function onAuthChange(cb) {
  return supabase.auth.onAuthStateChange((event, session) => {
    cb(session?.user ?? null);
  });
}

// Profile helpers
export async function getProfile(userId) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertProfile(userId, updates) {
  const { data, error } = await supabase.from('profiles').upsert(
    { id: userId, ...updates },
    { onConflict: 'id' }
  );
  if (error) throw error;
  return data;
}

// Character helpers
export async function getCharacters(userId) {
  const { data, error } = await supabase
    .from('characters')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getCharacter(id) {
  const { data, error } = await supabase.from('characters').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createCharacter(userId, charData) {
  const { data, error } = await supabase.from('characters').insert({
    user_id: userId,
    ...charData,
    slug: charData.slug || slugify(charData.name),
  }).select().single();
  if (error) throw error;
  return data;
}

export async function updateCharacter(id, updates) {
  const { data, error } = await supabase.from('characters').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteCharacter(id) {
  const { error } = await supabase.from('characters').delete().eq('id', id);
  if (error) throw error;
}

// Search characters (public)
export async function searchCharacters(query, limit = 50) {
  const { data, error } = await supabase
    .from('characters')
    .select('*, user_id')
    .ilike('name', `%${query}%`)
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// Upload helpers
export async function uploadImage(userId, file) {
  const ext = file.name.split('.').pop();
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { data, error } = await supabase.storage.from('characters').upload(path, file);
  if (error) throw error;
  
  const { data: uploadRecord } = await supabase.from('uploads').insert({
    user_id: userId,
    path: data.path,
    content_type: file.type,
    size: file.size
  }).select().single();
  
  const { data: { publicUrl } } = supabase.storage.from('characters').getPublicUrl(path);
  return { ...data, publicUrl, uploadRecord };
}

export function getPublicUrl(path) {
  const { data: { publicUrl } } = supabase.storage.from('characters').getPublicUrl(path);
  return publicUrl;
}

// Slug helper
function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

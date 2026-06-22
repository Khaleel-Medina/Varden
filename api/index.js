// Varden API — Supabase-backed endpoints
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://ljruzruhbqkbxkflrvzi.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_ANON || ''
);

export default async function handler(req, res) {
  // CORS for Vercel
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(req, res);
      case 'POST':
        return handlePost(req, res);
      case 'PUT':
        return handlePut(req, res);
      case 'DELETE':
        return handleDelete(req, res);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleGet(req, res) {
  const { searchParams } = new URL(req.url || '');
  const action = searchParams.get('action');
  const id = searchParams.get('id');

  if (action === 'search') {
    const query = searchParams.get('q') || '';
    const { data } = await supabase
      .from('characters')
      .select('*, user_id')
      .ilike('name', `%${query}%`)
      .limit(50);
    return res.status(200).json(data || []);
  }

  if (id) {
    const { data, error } = await supabase.from('characters').select('*').eq('id', id).maybeSingle();
    if (error) return res.status(404).json({ error: 'Character not found' });
    return res.status(200).json(data);
  }

  // List all public characters
  const { data } = await supabase
    .from('characters')
    .select('*, user_id')
    .order('created_at', { ascending: false })
    .limit(50);
  return res.status(200).json(data || []);
}

async function handlePost(req, res) {
  const body = await req.json();
  
  // For now, return stub — server-side auth needed for real writes
  return res.status(501).json({ 
    error: 'Server-side writes require service role key. Use client-side Supabase directly.',
    hint: 'Call supabase.from("characters").insert(...) from the browser instead.'
  });
}

async function handlePut(req, res) {
  return res.status(501).json({ error: 'Use client-side Supabase for updates' });
}

async function handleDelete(req, res) {
  return res.status(501).json({ error: 'Use client-side Supabase for deletes' });
}

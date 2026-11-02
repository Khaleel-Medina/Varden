// Varden — shared character cards.
//
// A Tavern card is a PNG whose tEXt chunk carries the card JSON, so what gets
// published here is the same file a person can import anywhere. The bytes live in
// Supabase Storage (public bucket) and a small row records who published it, so a
// card can be listed and downloaded by anyone without an account.
//
// The Supabase client is imported lazily: the library page must keep working on a
// machine with no network, and a top-level CDN import would take the whole page
// down instead of just disabling sharing.

import { buildCardPng, parseCardFile } from './cards.js';

// Same public project as app.js. The anon key is safe to ship; row policies do the
// actual gating (public read, owner-only write).
const SUPABASE_URL = 'https://ljruzruhbqkbxkflrvzi.supabase.co';
const SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxqcnV6cnVoYmtiY3hrbGZydnppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4MzQ0NjMsImV4cCI6MjA4NDQxMDQ2M30.ZlJcgo3KzQ9ND9VSEpH0yzHyeZFHid';

const BUCKET = 'cards';

let clientPromise = null;

async function getClient() {
  if (!clientPromise) {
    clientPromise = import('https://esm.sh/@supabase/supabase-js@2')
      .then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_ANON))
      .catch((error) => {
        clientPromise = null;
        throw new Error(`Could not load the sharing client (${error?.message || 'offline'}).`);
      });
  }
  return clientPromise;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

// Turn Postgres/Storage errors into something a person can act on. An unapplied
// schema is the most likely failure, so it gets its own instruction.
function explain(error) {
  const message = String(error?.message || error || 'Unknown error');
  if (/does not exist|schema cache|Could not find the table/i.test(message)) {
    return 'Shared cards are not set up yet — run supabase-shared-cards.sql in the Supabase SQL editor.';
  }
  if (/bucket/i.test(message)) {
    return 'The card storage bucket is missing — run supabase-shared-cards.sql in Supabase.';
  }
  if (/Failed to fetch|NetworkError|offline/i.test(message)) {
    return 'Could not reach the sharing service — check the connection and try again.';
  }
  return message;
}

export async function getSharedUser() {
  try {
    const supabase = await getClient();
    const { data } = await supabase.auth.getUser();
    return data?.user ?? null;
  } catch {
    return null;
  }
}

export async function listSharedCards(limit = 60) {
  try {
    const supabase = await getClient();
    const { data, error } = await supabase
      .from('shared_cards')
      .select('id,name,creator,tagline,tags,card_path,card_url,size,created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return { cards: [], error: explain(error) };
    return { cards: data || [], error: null };
  } catch (error) {
    return { cards: [], error: explain(error) };
  }
}

// Publish a card: build the real PNG (embedded data, square art), upload it, then
// record the row. If the row fails the file is removed again so storage does not
// collect orphans.
export async function shareCard(character) {
  const supabase = await getClient();
  const user = await getSharedUser();
  if (!user) throw new Error('Sign in on the catalog page before sharing a card.');

  const png = await buildCardPng(character);
  const slug = slugify(character.name) || 'card';
  const path = `${user.id}/${slug}-${Date.now()}.png`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, png, { contentType: 'image/png', upsert: false });
  if (uploadError) throw new Error(explain(uploadError));

  const { data: publicUrl } = supabase.storage.from(BUCKET).getPublicUrl(path);

  const { error: rowError } = await supabase.from('shared_cards').insert({
    user_id: user.id,
    name: character.name,
    creator: character.creator || 'Anonymous',
    tagline: character.tagline || '',
    tags: Array.isArray(character.tags) ? character.tags.slice(0, 12) : [],
    card_path: path,
    card_url: publicUrl?.publicUrl || null,
    size: png.size || null,
  });

  if (rowError) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw new Error(explain(rowError));
  }

  return { path, url: publicUrl?.publicUrl || null };
}

// Fetch a published card and parse it back into a character, so callers can both
// keep the file (a real PNG card) and add the card to their local library.
export async function fetchSharedCard(row) {
  if (!row?.card_url) throw new Error('That card has no file attached.');
  const response = await fetch(row.card_url);
  if (!response.ok) throw new Error(`Could not download ${row.name} (HTTP ${response.status}).`);
  const blob = await response.blob();
  const filename = `${slugify(row.name) || 'card'}.png`;
  const file = new File([blob], filename, { type: 'image/png' });
  const { character } = await parseCardFile(file);
  return { character, blob, filename };
}

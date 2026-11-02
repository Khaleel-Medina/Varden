// Varden — shared character cards and accounts.
//
// A Tavern card is a PNG whose tEXt chunk carries the card JSON, so what gets
// published here is the same file a person can import anywhere. The bytes live in
// Supabase Storage and a small row records who published it.
//
// Visibility works in pairs: a card marked public lives in the public bucket and
// anyone can download it without an account, while a private card lives in a
// private bucket that only its owner can read (through a short-lived signed URL).
// Saving a card in the other state moves the file to the matching bucket.
//
// The Supabase client is imported lazily: the library page must keep working on a
// machine with no network, and a top-level CDN import would take the whole page
// down instead of just disabling sharing.

import { buildCardPng, parseCardFile } from './cards.js';

// Same public project as app.js. The anon key is safe to ship; row policies do the
// actual gating (public read, owner-only write).
const SUPABASE_URL = 'https://ljruzruhbqkbxkflrvzi.supabase.co';
const SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxqcnV6cnVoYnFrYnhrZmxydnppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNzExOTIsImV4cCI6MjA5NzY0NzE5Mn0.3nMbB6tYCF9-GZUs3Gu76Z-yVYCQrWOnM3EBcSTZlWg';

const PUBLIC_BUCKET = 'cards';
const PRIVATE_BUCKET = 'cards-private';

const CARD_FIELDS =
  'id,name,creator,tagline,tags,card_path,card_url,size,visibility,bucket,created_at,updated_at,user_id';

let clientPromise = null;

async function getClient() {
  if (!clientPromise) {
    clientPromise = import('https://esm.sh/@supabase/supabase-js@2')
      .then(({ createClient }) =>
        createClient(SUPABASE_URL, SUPABASE_ANON, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
        })
      )
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

function bucketFor(visibility) {
  return visibility === 'private' ? PRIVATE_BUCKET : PUBLIC_BUCKET;
}

// Turn Postgres/Storage errors into something a person can act on. An unapplied
// schema is the most likely failure, so it gets its own instruction.
function explain(error) {
  const message = String(error?.message || error || 'Unknown error');
  if (/does not exist|schema cache|Could not find the table|column .* does not exist/i.test(message)) {
    return 'Shared cards are not set up yet — run supabase-shared-cards.sql and supabase-accounts.sql in the Supabase SQL editor.';
  }
  if (/bucket/i.test(message)) {
    return 'The card storage bucket is missing — run supabase-accounts.sql in Supabase.';
  }
  if (/row-level security|permission denied|not authorized/i.test(message)) {
    return 'That card belongs to another account, so it cannot be changed here.';
  }
  if (/already exists/i.test(message)) {
    return 'That card file was just uploaded — try again.';
  }
  if (/Failed to fetch|NetworkError|offline/i.test(message)) {
    return 'Could not reach the sharing service — check the connection and try again.';
  }
  return message;
}

function explainAuth(error) {
  const message = String(error?.message || error || 'Unknown error');
  if (/Invalid login credentials/i.test(message)) return 'That email and password do not match an account.';
  if (/Email not confirmed/i.test(message)) return 'Confirm your email address first, then sign in.';
  if (/User already registered/i.test(message)) return 'That email already has an account — sign in instead.';
  if (/at least 6 characters/i.test(message)) return 'Use a password of at least 6 characters.';
  if (/rate limit|too many/i.test(message)) return 'Too many attempts — wait a minute and try again.';
  if (/signups not allowed|Signups not allowed/i.test(message)) return 'Sign-ups are disabled for this project.';
  return explain(error);
}

/* ---------------- accounts ---------------- */

export async function getSharedUser() {
  try {
    const supabase = await getClient();
    const { data } = await supabase.auth.getUser();
    return data?.user ?? null;
  } catch {
    return null;
  }
}

// Subscribe to sign-in/sign-out. Returns a function that stops listening.
export function onAuthChange(callback) {
  let active = true;
  let subscription = null;
  getClient()
    .then((supabase) => {
      if (!active) return;
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        callback(session?.user ?? null);
      });
      subscription = data?.subscription ?? null;
    })
    .catch(() => callback(null));
  return () => {
    active = false;
    subscription?.unsubscribe?.();
  };
}

// Email + password, so editing and deleting works later without an inbox round
// trip. A project with "Confirm email" on returns no session until the link is
// opened, which the caller reports instead of pretending it signed in.
export async function signUp(email, password) {
  const supabase = await getClient();
  const { data, error } = await supabase.auth.signUp({
    email: String(email || '').trim(),
    password: String(password || ''),
  });
  if (error) throw new Error(explainAuth(error));
  return { user: data?.user ?? null, needsConfirmation: !data?.session };
}

export async function signIn(email, password) {
  const supabase = await getClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(email || '').trim(),
    password: String(password || ''),
  });
  if (error) throw new Error(explainAuth(error));
  return data?.user ?? null;
}

export async function signOut() {
  const supabase = await getClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(explain(error));
}

/* ---------------- reading ---------------- */

// The community feed: public rows only. Signed-in visitors can still see their
// own private cards, but those are listed through listMyCards instead.
export async function listSharedCards(limit = 60) {
  try {
    const supabase = await getClient();
    const { data, error } = await supabase
      .from('shared_cards')
      .select(CARD_FIELDS)
      .eq('visibility', 'public')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return { cards: [], error: explain(error) };
    return { cards: data || [], error: null };
  } catch (error) {
    return { cards: [], error: explain(error) };
  }
}

// Everything this account has published, drafts included.
export async function listMyCards() {
  const user = await getSharedUser();
  if (!user) return { cards: [], error: null, user: null };
  try {
    const supabase = await getClient();
    const { data, error } = await supabase
      .from('shared_cards')
      .select(CARD_FIELDS)
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    if (error) return { cards: [], error: explain(error), user };
    return { cards: data || [], error: null, user };
  } catch (error) {
    return { cards: [], error: explain(error), user };
  }
}

// A usable image URL for a card: the stored public URL, or a one-hour signed URL
// for a private card so the owner can still see their own draft.
export async function cardArtUrl(row) {
  if (!row) return null;
  try {
    const supabase = await getClient();
    if (row.visibility === 'private') {
      const { data, error } = await supabase.storage
        .from(row.bucket || PRIVATE_BUCKET)
        .createSignedUrl(row.card_path, 3600);
      if (error) return null;
      return data?.signedUrl ?? null;
    }
    if (row.card_url) return row.card_url;
    const { data } = supabase.storage.from(row.bucket || PUBLIC_BUCKET).getPublicUrl(row.card_path);
    return data?.publicUrl ?? null;
  } catch {
    return null;
  }
}

/* ---------------- writing ---------------- */

// Publish a card: build the real PNG (embedded data, square art), upload it, then
// record the row. If the row fails the file is removed again so storage does not
// collect orphans.
export async function shareCard(character, { visibility = 'public' } = {}) {
  const supabase = await getClient();
  const user = await getSharedUser();
  if (!user) throw new Error('Sign in before publishing a card.');

  const isPrivate = visibility === 'private';
  const bucket = bucketFor(visibility);
  const png = await buildCardPng(character);
  const slug = slugify(character.name) || 'card';
  const path = `${user.id}/${slug}-${Date.now()}.png`;

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, png, { contentType: 'image/png', upsert: false });
  if (uploadError) throw new Error(explain(uploadError));

  const publicUrl = isPrivate ? null : supabase.storage.from(bucket).getPublicUrl(path).data?.publicUrl ?? null;

  const { error: rowError } = await supabase.from('shared_cards').insert({
    user_id: user.id,
    name: character.name,
    creator: character.creator || 'Anonymous',
    tagline: character.tagline || '',
    tags: Array.isArray(character.tags) ? character.tags.slice(0, 12) : [],
    card_path: path,
    card_url: publicUrl,
    size: png.size || null,
    visibility: isPrivate ? 'private' : 'public',
    bucket,
  });

  if (rowError) {
    await supabase.storage.from(bucket).remove([path]);
    throw new Error(explain(rowError));
  }

  return { path, url: publicUrl, visibility: isPrivate ? 'private' : 'public' };
}

// Save an edit. The PNG embeds the card JSON, so changing a field means rebuilding
// the file rather than editing a row that would then disagree with its download.
export async function updateSharedCard(row, character, { visibility } = {}) {
  const supabase = await getClient();
  const user = await getSharedUser();
  if (!user) throw new Error('Sign in to edit a card.');

  const nextVisibility = visibility === 'private' ? 'private' : 'public';
  const bucket = bucketFor(nextVisibility);
  const png = await buildCardPng(character);
  const slug = slugify(character.name) || 'card';
  const path = `${user.id}/${slug}-${Date.now()}.png`;

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, png, { contentType: 'image/png', upsert: false });
  if (uploadError) throw new Error(explain(uploadError));

  const publicUrl = nextVisibility === 'private' ? null : supabase.storage.from(bucket).getPublicUrl(path).data?.publicUrl ?? null;

  const { error: rowError } = await supabase
    .from('shared_cards')
    .update({
      name: character.name,
      creator: character.creator || 'Anonymous',
      tagline: character.tagline || '',
      tags: Array.isArray(character.tags) ? character.tags.slice(0, 12) : [],
      card_path: path,
      card_url: publicUrl,
      size: png.size || null,
      visibility: nextVisibility,
      bucket,
    })
    .eq('id', row.id)
    .eq('user_id', user.id);

  if (rowError) {
    await supabase.storage.from(bucket).remove([path]);
    throw new Error(explain(rowError));
  }

  const previousBucket = row.bucket || PUBLIC_BUCKET;
  if (row.card_path && (row.card_path !== path || previousBucket !== bucket)) {
    try {
      await supabase.storage.from(previousBucket).remove([row.card_path]);
    } catch (error) {
      console.warn('Varden: could not remove the replaced card file', error);
    }
  }

  return { path, url: publicUrl, visibility: nextVisibility };
}

export async function deleteSharedCard(row) {
  const supabase = await getClient();
  const user = await getSharedUser();
  if (!user) throw new Error('Sign in to delete a card.');

  const { error } = await supabase
    .from('shared_cards')
    .delete()
    .eq('id', row.id)
    .eq('user_id', user.id);
  if (error) throw new Error(explain(error));

  // The row is gone either way; a missing file must not block the delete.
  if (row.card_path) {
    try {
      await supabase.storage.from(row.bucket || PUBLIC_BUCKET).remove([row.card_path]);
    } catch (error) {
      console.warn('Varden: could not remove the deleted card file', error);
    }
  }

  return true;
}

// Fetch a published card and parse it back into a character, so callers can both
// keep the file (a real PNG card) and add the card to their local library.
export async function fetchSharedCard(row) {
  const url = await cardArtUrl(row);
  if (!url) throw new Error('That card has no file attached.');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download ${row.name} (HTTP ${response.status}).`);
  const blob = await response.blob();
  const filename = `${slugify(row.name) || 'card'}.png`;
  const file = new File([blob], filename, { type: 'image/png' });
  const { character } = await parseCardFile(file);
  return { character, blob, filename };
}

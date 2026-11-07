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

import { applyLibrary, buildCardPng, librarySnapshot, onLibraryChange, parseCardFile } from './cards.js';
import { mergeLibraries } from './library-sync.js';

// Same public project as app.js. The anon key is safe to ship; row policies do the
// actual gating (public read, owner-only write).
const SUPABASE_URL = 'https://ljruzruhbqkbxkflrvzi.supabase.co';
const SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxqcnV6cnVoYnFrYnhrZmxydnppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNzExOTIsImV4cCI6MjA5NzY0NzE5Mn0.3nMbB6tYCF9-GZUs3Gu76Z-yVYCQrWOnM3EBcSTZlWg';

const PUBLIC_BUCKET = 'cards';
const PRIVATE_BUCKET = 'cards-private';

const CARD_FIELDS =
  'id,name,creator,tagline,tags,card_path,card_url,size,visibility,bucket,nsfw,created_at,updated_at,user_id';

let clientPromise = null;

async function getClient() {
  if (!clientPromise) {
    clientPromise = import('https://esm.sh/@supabase/supabase-js@2')
      .then(({ createClient }) =>
        createClient(SUPABASE_URL, SUPABASE_ANON, {
          // detectSessionInUrl must stay on: an OAuth provider sends the session
          // back in the URL, and with detection off the visit would look signed out.
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
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
  if (/user_library/i.test(message)) {
    return 'Cross-device sync is not set up yet — run supabase-library-sync.sql in the Supabase SQL editor.';
  }
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
  if (/provider is not enabled|Unsupported provider/i.test(message)) {
    return 'That sign-in provider is not enabled yet — turn it on in Supabase → Authentication → Providers.';
  }
  if (/redirect_uri_mismatch|Invalid redirect|redirect url/i.test(message)) {
    return `The provider does not accept ${oauthRedirectUrl()} as a redirect. Add it in Supabase → Authentication → URL Configuration → Redirect URLs.`;
  }
  if (/access_denied|denied the request|cancelled/i.test(message)) return 'Sign-in was cancelled.';
  if (/invalid_client|client secret|client_id/i.test(message)) {
    return 'The provider rejected the app credentials — check the client ID and secret in Supabase → Authentication → Providers.';
  }
  return explain(error);
}

/* ---------------- OAuth providers ---------------- */

// Offered on the account dialog. Any provider you have not enabled in Supabase
// Auth → Providers still renders; clicking it explains what is missing.
export const OAUTH_PROVIDERS = [
  { id: 'google', label: 'Google' },
  { id: 'discord', label: 'Discord' },
  { id: 'github', label: 'GitHub' },
];

// Which of those the project has actually switched on. The settings endpoint is
// public, so this needs no secret. A provider that answers "not enabled" reads as
// a broken sign-in, so it is better not to offer it at all; when the check cannot
// run (offline, blocked) the full list comes back and a dead provider still
// explains itself on click.
let availableProvidersPromise = null;

export function availableProviders() {
  if (!availableProvidersPromise) {
    availableProvidersPromise = fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((settings) => {
        const external = settings?.external;
        if (!external) return OAUTH_PROVIDERS;
        return OAUTH_PROVIDERS.filter((provider) => external[provider.id] === true);
      })
      .catch(() => OAUTH_PROVIDERS);
  }
  return availableProvidersPromise;
}

// Where the provider returns the browser. This exact URL must be listed in
// Supabase → Authentication → URL Configuration → Redirect URLs (both the
// deployed origin and http://localhost:3000 while developing).
export function oauthRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

// Ask the auth server whether this provider is actually usable before the browser
// leaves the app. A disabled provider answers 400 with JSON; a working one answers
// with a redirect we cannot read but can recognise. When the check itself is
// blocked (CORS), we assume it is fine and let the navigation happen.
export async function probeProviderUrl(url) {
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'manual', credentials: 'omit' });
    if (response.type === 'opaqueredirect' || response.status === 0) return { ok: true };
    if (response.ok) return { ok: true };
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      message = body?.msg || body?.message || body?.error_description || message;
    } catch {
      // Non-JSON body: the status is all we have.
    }
    return { ok: false, message };
  } catch {
    return { ok: true };
  }
}

// Hands the browser to the provider. The URL is requested with the redirect
// suppressed so a provider that was never enabled can be reported in the dialog —
// otherwise the tab is replaced by a raw JSON error and the app is gone.
export async function signInWithProvider(provider) {
  const supabase = await getClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: oauthRedirectUrl(),
      skipBrowserRedirect: true,
      ...(provider === 'google' ? { queryParams: { prompt: 'select_account' } } : {}),
    },
  });
  if (error) throw new Error(explainAuth(error));
  const url = data?.url;
  if (!url) throw new Error('The sign-in service did not return a provider address.');
  const probe = await probeProviderUrl(url);
  if (!probe.ok) throw new Error(explainAuth({ message: probe.message }));
  window.location.assign(url);
  return true;
}

// Providers report refusals on the query string (code flow) or the hash (implicit).
// Both are passed in because the Supabase client rewrites the URL while it looks
// for a session, which can erase the message before anyone reads it.
export function oauthErrorFromUrl(search = '', hash = '') {
  const query = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const fragment = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const code = query.get('error') || fragment.get('error');
  if (!code) return null;
  const description = (query.get('error_description') || fragment.get('error_description') || '').replace(/\+/g, ' ');
  const text = `${code} ${description}`.toLowerCase();
  if (text.includes('access_denied')) return 'Sign-in was cancelled.';
  if (text.includes('provider is not enabled') || text.includes('unsupported provider')) {
    return 'That sign-in provider is not enabled yet — turn it on in Supabase → Authentication → Providers.';
  }
  if (text.includes('redirect')) {
    return `The provider does not accept ${oauthRedirectUrl()} as a redirect. Add it in Supabase → Authentication → URL Configuration → Redirect URLs.`;
  }
  if (text.includes('server_error') || text.includes('invalid_client')) {
    return 'The provider could not verify the app — check its client ID and secret in Supabase, then try again.';
  }
  return description || code;
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
// NSFW is filtered in the query rather than after download, so a hidden card's art
// is never fetched by someone who has the filter on.
export async function listSharedCards(limit = 60, { includeNsfw = false } = {}) {
  try {
    const supabase = await getClient();
    let query = supabase
      .from('shared_cards')
      .select(CARD_FIELDS)
      .eq('visibility', 'public')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (!includeNsfw) query = query.eq('nsfw', false);
    const { data, error } = await query;
    if (error) return { cards: [], error: explain(error) };
    return { cards: data || [], error: null };
  } catch (error) {
    return { cards: [], error: explain(error) };
  }
}

// Whether the signed-in visitor may remove other people's cards. The row is only
// readable by its owner, so a non-admin simply gets null back.
export async function viewerIsAdmin() {
  const user = await getSharedUser();
  if (!user) return false;
  try {
    const supabase = await getClient();
    const { data, error } = await supabase
      .from('admins')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) return false;
    return Boolean(data);
  } catch {
    return false;
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
export async function shareCard(character, { visibility = 'public', nsfw = false } = {}) {
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
    nsfw: Boolean(nsfw),
  });

  if (rowError) {
    await supabase.storage.from(bucket).remove([path]);
    throw new Error(explain(rowError));
  }

  return { path, url: publicUrl, visibility: isPrivate ? 'private' : 'public' };
}

// Save an edit. The PNG embeds the card JSON, so changing a field means rebuilding
// the file rather than editing a row that would then disagree with its download.
export async function updateSharedCard(row, character, { visibility, nsfw = false } = {}) {
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
      nsfw: Boolean(nsfw),
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

// Deleting is gated by row policy rather than by this filter: an owner passes,
// an admin passes for somebody else's card, everyone else is refused. Filtering on
// user_id here would have silently made admin removals match zero rows.
export async function deleteSharedCard(row) {
  const supabase = await getClient();
  const user = await getSharedUser();
  if (!user) throw new Error('Sign in to delete a card.');

  const { error } = await supabase.from('shared_cards').delete().eq('id', row.id);
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

/* ---------------- cross-device library sync ---------------- */

// The library itself stays local: every page reads IndexedDB first and works with
// no account and no network. This adds a second copy per account, so cards and
// chats written on one device turn up on the next one.
//
// One row holds one JSON document rather than a table per record: merging happens on
// the devices by id and `updatedAt`, which keeps edits and deletions honest without
// a server clock. Only the owner can read the row, so syncing a private card never
// makes it public.

const SYNC_TABLE = 'user_library';
let syncRunning = null;
let syncTimer = null;
let syncNotify = null;
let syncHandler = null;

async function readRemoteLibrary(user) {
  const supabase = await getClient();
  const { data, error } = await supabase
    .from(SYNC_TABLE)
    .select('data, saved_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw new Error(explain(error));
  return data?.data || null;
}

async function writeRemoteLibrary(user, library) {
  const supabase = await getClient();
  const savedAt = new Date().toISOString();
  const { error } = await supabase
    .from(SYNC_TABLE)
    .upsert({ user_id: user.id, data: library, saved_at: savedAt }, { onConflict: 'user_id' });
  if (error) throw new Error(explain(error));
  return savedAt;
}

async function runSync() {
  const user = await getSharedUser().catch(() => null);
  if (!user) return { user: null, pulled: false, pushed: false, localChanged: false, error: null };
  try {
    const local = await librarySnapshot();
    const remote = await readRemoteLibrary(user);
    const { merged, localChanged, remoteChanged } = mergeLibraries(local, remote || undefined);
    if (localChanged) await applyLibrary(merged);
    let pushed = false;
    if (remoteChanged || !remote) {
      await writeRemoteLibrary(user, merged);
      pushed = true;
    }
    return { user, pulled: Boolean(remote), pushed, localChanged, error: null };
  } catch (error) {
    return { user, pulled: false, pushed: false, localChanged: false, error: explain(error) };
  }
}

// Concurrent callers share one run: two pages of the site open at once should not
// race each other's writes into the same row.
export function syncLibrary() {
  if (syncRunning) return syncRunning;
  syncRunning = runSync().finally(() => {
    syncRunning = null;
  });
  return syncRunning;
}

function scheduleLibrarySync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncLibrary()
      .then((result) => {
        if (result?.localChanged) syncNotify?.();
      })
      .catch(() => {});
  }, 1800);
}

// Called once per page after the local library is readable. Returns the first pull
// so a page can wait for it (briefly) before painting.
export function startLibrarySync(onRemoteChange) {
  syncNotify = typeof onRemoteChange === 'function' ? onRemoteChange : null;
  if (!syncHandler) {
    syncHandler = onLibraryChange(() => scheduleLibrarySync());
  }
  return syncLibrary()
    .then((result) => {
      if (result?.localChanged) syncNotify?.();
      return result;
    })
    .catch(() => null);
}

export function stopLibrarySync() {
  clearTimeout(syncTimer);
  syncTimer = null;
  syncNotify = null;
  syncHandler?.();
  syncHandler = null;
}


/* ---------------- community: likes and comments ---------------- */

// Likes and comments hang off a published card. Reading is open to everyone because
// the feed is public; writing needs a session and the policies make the row belong
// to that session, so nothing here has to police ownership on its own.

const ENGAGEMENT_LIMIT = 1000;

// Counts for a page of cards in two queries rather than two per card.
export async function loadEngagement(cardIds = []) {
  const ids = [...new Set(cardIds.filter(Boolean))];
  const empty = { likes: {}, comments: {}, liked: [] };
  if (!ids.length) return empty;
  try {
    const supabase = await getClient();
    const user = await getSharedUser();
    const [likeRows, commentRows] = await Promise.all([
      supabase.from('card_likes').select('card_id,user_id').in('card_id', ids).limit(ENGAGEMENT_LIMIT),
      supabase.from('card_comments').select('card_id').in('card_id', ids).limit(ENGAGEMENT_LIMIT),
    ]);
    if (likeRows.error || commentRows.error) return empty;
    const likes = {};
    const liked = [];
    for (const row of likeRows.data || []) {
      likes[row.card_id] = (likes[row.card_id] || 0) + 1;
      if (user && row.user_id === user.id) liked.push(row.card_id);
    }
    const comments = {};
    for (const row of commentRows.data || []) {
      comments[row.card_id] = (comments[row.card_id] || 0) + 1;
    }
    return { likes, comments, liked };
  } catch {
    return empty;
  }
}

export async function listCardComments(cardId, limit = 100) {
  try {
    const supabase = await getClient();
    const { data, error } = await supabase
      .from('card_comments')
      .select('id,card_id,user_id,author,body,created_at')
      .eq('card_id', cardId)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) return { comments: [], error: explain(error) };
    return { comments: data || [], error: null };
  } catch (error) {
    return { comments: [], error: explain(error) };
  }
}

export async function addCardComment(cardId, body) {
  const supabase = await getClient();
  const user = await getSharedUser();
  if (!user) throw new Error('Sign in to comment on a card.');
  const text = String(body || '').trim().slice(0, 800);
  if (!text) throw new Error('Write something first.');
  const author =
    user.user_metadata?.display_name ||
    user.user_metadata?.full_name ||
    user.email?.split('@')[0] ||
    'someone';
  const { data, error } = await supabase
    .from('card_comments')
    .insert({ card_id: cardId, user_id: user.id, author, body: text })
    .select('id,card_id,user_id,author,body,created_at')
    .single();
  if (error) throw new Error(explain(error));
  return data;
}

export async function deleteCardComment(id) {
  const supabase = await getClient();
  const user = await getSharedUser();
  if (!user) throw new Error('Sign in to delete a comment.');
  const { error } = await supabase.from('card_comments').delete().eq('id', id);
  if (error) throw new Error(explain(error));
  return true;
}

// One like per person per card, toggled. The primary key is the real guard; this
// only decides whether to insert or delete.
export async function toggleCardLike(cardId) {
  const supabase = await getClient();
  const user = await getSharedUser();
  if (!user) throw new Error('Sign in to like a card.');
  const { data: existing, error: readError } = await supabase
    .from('card_likes')
    .select('card_id')
    .eq('card_id', cardId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (readError) throw new Error(explain(readError));
  if (existing) {
    const { error } = await supabase.from('card_likes').delete().eq('card_id', cardId).eq('user_id', user.id);
    if (error) throw new Error(explain(error));
    return { liked: false };
  }
  const { error } = await supabase.from('card_likes').insert({ card_id: cardId, user_id: user.id });
  if (error) throw new Error(explain(error));
  return { liked: true };
}

# Varden — Setup Guide

## Architecture
- **Supabase** — Auth (sign in/sign up), character database, row-level security
- **Vercel Blob** — Image storage for character art
- **IndexedDB** — Client-side cache for instant loads + local chat history
- **WebLLM + WebGPU** — Local chat inference in the browser (no API keys)
- **Vercel** — Hosting + serverless API routes

## Quick Start

### 1. Set up Supabase
1. Go to [supabase.com](https://supabase.com) and create a project
2. Go to **Settings → API** — copy your **Project URL** and **anon public key**
3. Go to **SQL Editor** — paste the contents of `supabase-schema.sql` and run it
4. Go to **Storage** → **New bucket** → name: `characters` → **Public** → Create

### 2. Set up Vercel Blob
1. In your Vercel dashboard → **Storage** → **Create Blob Bucket**
2. Name it `varden-images` (or whatever you like)
3. Copy the connection string

### 3. Configure environment variables
On Vercel, go to your project → **Settings → Environment Variables**:
- `SUPABASE_URL` — your Supabase project URL
- `SUPABASE_ANON` — your Supabase anon key
- `BLOB_READ_WRITE_TOKEN` — your Vercel Blob token (from step 2)

### 4. Deploy
```bash
vercel deploy --prod
```

Or connect your GitHub repo to Vercel for auto-deploy on push.

## Character library and cards
`characters.html` is the local character library. Cards follow the SillyTavern
`chara_card_v2` shape, so cards from other tavern apps import directly.

- **Import:** drop PNG or JSON cards onto the library page (or use *Import cards*).
- **Export:** every card exports as a PNG with the card JSON embedded in a `tEXt`
  chunk, or as a plain JSON card.
- **Card fields:** description, personality, scenario, first message, example
  dialogue, system prompt, post-history instructions, tags and world-info entries.
- **Storage:** IndexedDB database `varden-tavern` (stores `characters`, `personas`,
  `chats`, `meta`). Nothing is uploaded, and there is no account requirement.
- **Chat prompt:** `cards.js → buildPrompt()` assembles the system prompt from the
  card, the user persona, triggered world-info entries and the author's note.

## Local AI chat (WebGPU)
`chat.html` runs quantized language models directly on the visitor's GPU using
[WebLLM](https://webllm.mlc.ai). There is no inference server and no API key.

- **Browser support:** Chrome/Edge 113+, Safari 26+, Firefox 141+ with hardware acceleration on.
- **First load per model** downloads the weights (roughly 0.4–3 GB); the browser caches them afterwards.
- **History** lives in IndexedDB (`varden-tavern`) on that device only. Chats from
  the earlier `varden-chat` database are migrated on first load.
- `chat.html?character=natsume-kafka` opens a fresh scene with that card.
- Assistant replies support swipes (alternate generations), editing, deletion and
  continuation; the composer sends whatever the rail has selected.

The model list in `MODEL_CATALOG` (`chat.js`) can be edited freely; every id must
exist in the WebLLM prebuilt registry.

The 8B entries — Hermes 3 (Llama 3.1 8B), Hermes 2 Theta and Hermes 2 Pro — are
Nous Research fine-tunes with minimal refusal behaviour, so a dark or explicit
scene stays in character instead of getting a safety lecture. They need about
5 GB for weights plus KV cache, which in practice means a GPU with 8 GB free.
OpenHermes 2.5 (Mistral 7B) is the same idea at 4.6 GB for smaller cards. Treat
any "uncensored" label as a description of the fine-tune, not a guarantee: the
base model's habits still show up sometimes.

On an 8 GB card (an RTX 4070 Mobile, for example) roughly 5.7 GB of weights is
the practical ceiling once KV cache and the browser's own GPU memory are counted.
The picks for that tier are Qwen3 4B (3.4 GB), Qwen3 8B (5.7 GB, thinking
disabled via the `noThink` flag) and Gemma 2 9B (6.4 GB, which fills the card).

## Local Testing
```bash
npx serve .
```

Open `http://localhost:3000` and sign up for an account.

## Testing
1. Open the site
2. Click "Sign in" → create an account
3. Click "New character" → fill out the form with an image
4. Verify it appears in the grid and persists on refresh
5. Try signing in from another device — your characters sync via Supabase
6. Open **Chat**, pick a model, and send a message — the first reply waits for the weight download
7. Reload the page: the model stays cached and the conversation is restored

## Schema
See `supabase-schema.sql` for the full database schema. Key tables:
- `profiles` — user profiles
- `characters` — character cards (RLS: owner full access, anyone can read)
- `uploads` — image metadata

## Cost
- **Supabase Free** — 500MB DB, 50K MAU, 1GB storage → $0
- **Vercel Blob Free** — 250MB storage, 1M reads/mo → $0
- **Vercel Hosting Free** — serverless functions → $0
- Your domain — ~$10/year (not from Vercel)

## Accounts, drafts and editing uploads

Publishing a card now belongs to an account, which is what makes editing and deleting possible later. Characters and
chats never leave the browser; the account only owns the published PNGs.

1. Run `supabase-shared-cards.sql`, then `supabase-accounts.sql`, in the Supabase SQL editor (Dashboard → SQL → New
   query). Both are safe to run more than once.
2. **Authentication → Providers → Email** must be enabled (it is by default).
3. For instant sign-in while testing, turn off **Authentication → Providers → Email → Confirm email**. With it on, a new
   account is created but cannot publish until the confirmation link is opened, and the site says so instead of
   pretending it signed in.
4. Drafts live in the `cards-private` bucket created by the migration. Its policy is owner-only, so a private card's
   bytes cannot be fetched by guessing a URL — the owner sees the art through a one-hour signed URL.
5. Column-level expectations: `shared_cards.visibility` is `public` or `private`, and `shared_cards.bucket` records which
   bucket holds the file. Saving a card in the other state rebuilds the PNG and moves the file.

## Models on GPUs without f16 shaders

Half-precision (`q4f16_1`) models only compile on GPUs that expose the `shader-f16` WebGPU feature. On hardware that does
not — older Intel/AMD integrated chips, and drivers that hide the feature — the shader module is rejected and the failure
surfaces as `Invalid ShaderModule … entryPoint: index_kernel`.

The chat page probes the adapter, disables models it cannot run, and falls back to an `f32` twin, which needs no f16
feature at the cost of roughly 250 MB–1 GB more memory. The catalog's f32 entries are Llama 3.2 1B/3B, Hermes 3 (3B),
Hermes 2 Pro (8B), Qwen2.5 1.5B/7B and Phi 3.5 mini. If a failure mentions stale shaders on an f32 model, clear the
site's cached model files in DevTools → Application → Storage and reload.

## Sign in with Google, Discord or GitHub

The account dialog offers OAuth next to email and password. Nothing about a provider is stored in this repo — the client
ID and secret live in Supabase, and the browser only ever sees the public anon key.

**1. Register an app with each provider.** The redirect URL is always your project's Supabase callback:

```
https://ljruzruhbqkbxkflrvzi.supabase.co/auth/v1/callback
```

- **Google** — Cloud console → APIs & Services → Credentials → Create OAuth client ID → Web application. Authorised
  redirect URI: the callback above. Fill in the consent screen first or the button returns `access_denied`.
- **Discord** — discord.com/developers/applications → New Application → OAuth2 → Redirects → add the callback.
- **GitHub** — Settings → Developer settings → OAuth Apps → New OAuth App. Authorization callback URL: the callback.

**2. Paste the credentials into Supabase** — Authentication → Providers → choose the provider → enable, paste the client
ID and secret, save.

**3. Allow the return trip** — Authentication → URL Configuration:

- Site URL: the production address, e.g. `https://varden.vercel.app`
- Redirect URLs: the deployed origin and, for local work, `http://localhost:3000`. A wildcard such as
  `https://*.vercel.app/**` covers preview deployments.

Every address the browser can land on after a redirect must be listed here, otherwise the provider refuses with
`redirect_uri_mismatch` — the dialog names that error and points at this setting instead of failing silently.

**4. Providers you do not want** — comment the entry out of `OAUTH_PROVIDERS` in `shared.js`. Leaving a provider listed
while it is disabled in Supabase is harmless: the button appears and the click explains what is missing.

`Confirm email` only affects the email path; OAuth users are verified by their provider and skip it. A first-time OAuth
user needs no extra setup — the first card they publish creates their `shared_cards` row, owned by their new account.

## NSFW tagging and the admin role

Uploads carry an `nsfw` flag, filtered **in the query** rather than after download — a visitor with the filter off never
requests art it is hiding. The Community feed has a **Show NSFW** toggle that remembers itself in localStorage, and both
the publish and edit dialogs can set or clear the flag, so a card can be relabelled without re-uploading.

Run `supabase-nsfw-admin.sql` after the accounts migration (idempotent). It adds:

- `shared_cards.nsfw` plus an index for the filter
- a private `admins` table whose policy lets a signed-in user see **only their own** row, so you can learn that you are an
  admin but not who else is
- `public.is_admin()` — `security definer`, so row policies elsewhere can ask the question without opening the table up
- delete policies: `auth.uid() = user_id or public.is_admin()`, with matching storage policies on **both** buckets,
  because deleting the row while leaving the PNG behind would keep the file downloadable
- `promote_admin(email)`, revoked from the public API so the browser cannot call it

### Making yourself the admin

1. Sign up on the site first — the account has to exist before it can be promoted.
2. In the SQL editor: `select public.promote_admin('you@example.com');`
3. Reload the library page. Cards published by other accounts now show **Remove (admin)**; your own stay under *My cards*.

Revoke with `delete from public.admins where user_id = '<uuid>';`

The role only widens deletion — admins do **not** gain read access to other people's private drafts.

## Phones and tablets

A phone reports the same WebGPU features as a laptop but gets a much smaller memory budget, and when it runs out the
GPU process is torn down instead of raising an allocation error — which surfaces as
`mapAsync … Buffer was unmapped before mapping was resolved`. The picker detects a phone-class device and caps the list
at about 1.7 GB of weights (Qwen2.5 0.5B, Llama 3.2 1B f16/f32, Qwen2.5 1.5B and its f32 twin), moving an oversized
selection down automatically. A lost device drops the engine so the next attempt rebuilds it rather than streaming into a
GPU that is gone.

## Hosted models (separate list, no server of yours)

Under **Hosted models** in the chat panel there is a second model list, kept deliberately separate from the WebGPU
catalog. Those models run on other companies' servers through OpenRouter.

- The visitor creates a key at https://openrouter.ai/keys and pastes it into the panel. It is stored in this browser
  only when "Remember on this device" is ticked, and is sent to OpenRouter and nowhere else.
- There is nothing for the owner to run: no proxy, no serverless function, no secret in the repo, no billing. Varden
  never sees the key.
- The list comes from `GET https://openrouter.ai/api/v1/models` — public and CORS-open (`access-control-allow-origin: *`)
  — so it stays current with no maintenance here. Models are grouped by vendor (OpenAI, Anthropic, Google, Meta,
  DeepSeek, ...) and each shows context size and per-million-token prices.
- Replies stream from the page straight to `POST /chat/completions` (OPTIONS preflight verified: 204, `*`).
- Picking anything in the GPU list switches back to local inference; the header chip shows which route is in use.
- Trade-off, stated in the UI: hosted replies leave the browser, so they are not private the way local inference is.

Regression checks worth knowing: the hosted path must work with WebGPU absent, Stop must abort the request rather than
just stop rendering, and a 401/402/429 must explain itself instead of showing raw JSON.

## Keyless models (third list, nothing to sign up for)

The chat panel has a third model list, styled amber and kept separate from the GPU catalog and the OpenRouter list,
because its promise is different: it works with no key and no account, but it is not private.

- Endpoint: `https://text.pollinations.ai` (`POST /openai`, `GET /models`). It answers with no `Authorization` header,
  sends `access-control-allow-origin: *` and returns 204 on the POST preflight, so a static page can call it directly.
- Replies stream as ordinary SSE `chat.completion.chunk` events, so they reuse the same reader as the hosted path.
- The alias list comes from `GET /models` and falls back to `openai-fast` when that request fails. Aliases are not
  vendors: `openai` and `openai-fast` both resolve to whatever the pool has (observed: `gpt-oss-20b`), and some names
  (e.g. `gpt-4o-mini`) answer `402 Payment Required` — those are not free.
- The UI says plainly that the scene leaves the browser, that there is no billing and no privacy, and that the pool can
  be busy or change without notice. Local GPU remains the default and the only private route.
- The first switch to the pool asks for confirmation in the panel itself (not a browser alert): it names what travels —
  the reply text, the character card, the persona and the author's note — and the answer is stored with the settings, so
  it is asked once per browser. Cancelling leaves the previous route untouched. A remembered keyless route is dropped on
  load unless that confirmation exists, so a stored setting can never start sending scenes unasked.
- Errors: 402 is reported as "that alias wants payment", 429 as "the pool is busy", anything else surfaces its status.

Nothing here is billed to the owner and nothing needs maintaining: no key, no server, no account.

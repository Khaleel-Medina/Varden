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

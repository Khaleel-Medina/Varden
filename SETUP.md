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

Publishing a card now belongs to an account, which is what makes editing and deleting possible later. Signing in also
syncs your own cards and chats between devices; without an account, characters and chats stay in the browser and only the
published PNGs live on the server.

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
6. Run `supabase-library-sync.sql` so a signed-in visitor's cards and chats follow them between devices. One row per
   account (`public.user_library`) holds the same shapes the browser keeps in IndexedDB, readable only by its owner.
   Deletions travel as tombstones for ninety days, so the other device cannot push a deleted card back. The browser stays
   the copy the pages read from: no account, or no network, changes nothing about how the library works.

## Card-art uploads

Studio art goes through `POST /api/blob-upload.js`, a Node function (`@vercel/node`, per `vercel.json`) that needs
`BLOB_READ_WRITE_TOKEN` in the Vercel project. The `.js` is part of the path: legacy `builds` keeps the suffix on the
function output, so a request to `/api/blob-upload` is a 404. Without the token the endpoint answers 503 and the page
keeps the picture inline with the row rather than losing it.

The browser posts the raw image bytes with `x-varden-user` / `x-varden-slug` headers, so the function needs no
multipart parser and `bodyParser` stays off. It must **not** be switched to the edge runtime: `@vercel/blob` pulls in
`node:stream` and undici, and the edge bundler rejects those modules, which fails the whole deployment. By the same
token, a Next-style `export const runtime` + named `POST` is not mounted by Vercel's `/api` builder and the route
just 404s.

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

## Sound, voice and generated art

Three small features that each avoid a service you would have to run or pay for.

- **Chime** — synthesised with Web Audio (two sine notes, no audio file) when a reply finishes, never when a
  transcript is merely rendered. Toggle in the chat panel's **Sound & voice** block, stored as `sound` in
  `varden-chat-settings`. Browsers only allow audio after a gesture, which sending the message provides; if a
  visitor never interacts, nothing plays.
- **Read aloud** — the browser's `speechSynthesis`, so no text leaves the machine and there is no account. Every
  assistant message has a **Read** button that toggles to **Stop**; `speakReplies` adds automatic reading. Markdown
  and stage asterisks are stripped first, speech stops when generation starts, and it is cancelled when the tab is
  hidden or closed. Browsers without speech synthesis say so instead of failing silently.
- **Generated card art** — `image.pollinations.ai`, the same keyless host family as the free text pool, so art costs
  nothing and nothing has to be kept alive. It returns a 512×512 JPEG with `access-control-allow-origin: *`; the
  editor converts that to a data URL so it can be cropped square and embedded into the card PNG like any upload.
  The prompt is built from the character's name, tagline and the optional description field — never from a chat — and
  the service refuses explicit prompts, so it is for likeness, not scenes. **The free tier is one image per 45 seconds
  per IP**, answered as `402 FREE_LIMIT` with a `Retry after Ns` sentence; `explainImageError` shows that sentence
  rather than a status code, and a 5xx queue spike gets one automatic retry. The panel note states the limit so a
  second press is not a surprise.

## Own server (Ollama, LM Studio, llama.cpp, vLLM)

The chat panel has a fourth model route: an OpenAI-compatible server the visitor runs. It is the only remote route
that can run a genuinely uncensored model with no account, because the model is whatever they already pulled.

- **Address** — `http://127.0.0.1:11434` by default. `normalizeLocalBase` accepts `host:port`, a bare origin, a
  `/v1` URL or a pasted `/chat/completions` URL and collapses them to one shape, adding `/v1` when the path is empty.
  Changing the address while it is active drops the route instead of silently pointing it elsewhere.
- **Model** — typed, or filled from `GET {base}/models` by **Find models**. Listing is a convenience: CORS often blocks
  it while chat still works, so a typed name always wins.
- **Key** — optional, kept in `state.local.key` and never written to `localStorage`. This route is meant to need none.
- **Streaming** — `POST {base}/chat/completions` with `stream: true`, read by the same `sseChunks` reader as the other
  two remote routes, and abortable with Stop through the shared `state.hostedAbort`.
- **Running one, for the record:** `ollama serve` (with `OLLAMA_ORIGINS` including the page origin) then
  `ollama pull dolphin-mistral`; or LM Studio's server tab with CORS enabled. Ollama exposes the OpenAI shape under
  `/v1`; LM Studio listens on `http://127.0.0.1:1234`. `dolphin-mistral`, `hermes3:8b` and `dolphin3` are the usual
  uncensored picks.
- **Browser limits that will bite before the code does:** the server must answer `OPTIONS` with CORS headers for this
  origin, and Chrome's Local Network Access prompt (and, from an https page, mixed-content rules) decide whether the
  request leaves the tab at all. Errors are reported as the route's own words: a failed fetch names CORS and the
  local-network prompt rather than claiming the model failed.
- **Verified against real Ollama 0.40.14** (CPU, `qwen2.5:0.5b`) on 2026-11-03: with
  `OLLAMA_ORIGINS=http://127.0.0.1:3000`, `GET /v1/models` returned the list with
  `Access-Control-Allow-Origin: http://127.0.0.1:3000`, the page listed the model, activated it, and streamed a
  complete reply in 3.0s with no console errors. Ollama answered both `/v1/models` and `/v1/chat/completions` with
  200.
- **Still unverified:** LM Studio and llama.cpp/vLLM, a GPU-speed server, and Chrome's Local Network Access prompt
  from the public https origin. Those are browser-permission questions rather than protocol ones: if the model list
  is empty but typing the name works, CORS is the cause; if nothing leaves the tab at all, it is the permission
  prompt.

## Devices (optional hardware, off by default)

The **Devices** section in the chat panel can drive a toy while a reply streams. It is collapsed, off, and changes
nothing about a chat that never opens it. The privacy promise is the point: only intensity numbers leave the page —
the reply text, the character card and the persona are never sent to a device or to a toy vendor. That also means it
works on the local GPU route, where no network is used at all.

The reaction is arithmetic over the stream, not another model call (`Reaction` in `devices.js`): characters per second
sets the base, punctuation and asterisked asides add heat, attack 0.45 / release 0.16 smooths it, and the panel's
intensity cap (default 60%) clips the top. No extra tokens are spent, and a card cannot talk the toy into more.

Three transports, because they are genuinely different deals:

- **Lovense Game Mode** — the visitor's phone or PC runs Lovense Remote with Game Mode on, which exposes a local
  server. There is no key, no account and no cloud. Commands go to
  `https://{ip-with-dashes}.lovense.club:30010/command`: the wildcard cert for that domain is what makes a local
  device reachable from an HTTPS page without mixed-content blocking. `GetToys` discovers the toy, then `Function`
  with `Vibrate:0-20`. Note Chrome's Local Network Access permission (Chrome 142+) prompts once before a public site
  may reach the LAN; declining it is a normal outcome, not a bug.
- **Intiface Central (desktop)** — any buttplug.io-compatible toy, connected in Intiface, over
  `ws://127.0.0.1:12345`. Nothing leaves the machine and the localhost exception means no mixed-content problem. Costs
  the visitor a desktop install.
- **The Handy** — the vendor's cloud, with the visitor's connection key (and an Application ID on firmware 4). The
  two credentials are different things and the panel says so: the **Application ID** is built for web pages, the
  **Application Key** is server-side and the cloud refuses it from a page. Two API
  generations exist and the hardware decides which one answers: **firmware 4** (Handy 2, 2 Pro) only speaks v3 at
  `https://www.handyfeeling.com/api/handy-rest/v3/` and requires an Application ID from `user.handyfeeling.com`; **firmware 3**
  (the original Handy) only speaks v2 at `https://www.handyfeeling.com/api/handy/v2/` and needs no Application ID. The
  panel's
  *Cloud API* selector defaults to **Detect**, which tries v3 when a key is present, falls back to v2, and reports what
  it reached (model, firmware, hardware, API) in the connected label. Verified against the live service: both bases
  answer this site's origin on preflight with `x-connection-key`, `x-api-key` and `content-type`; v3 answers
  `401 Unauthenticated` without a valid key; both generations can answer `200` with an error envelope, so the code
  reads `error` before trusting the status. The cloud allows about 240 requests a minute, which is why scene-synced
  strokes stop shortening at 300 ms half-strokes. It is the only device with a choice of two modes, and the panel
  explains the difference next to the selector:
  - *Steady speed* (HAMP, `mode: 0`) sends one velocity 0-100 per tick. Smooth, predictable, a handful of requests per
    minute.
  - *Scene-synced* (HDSP, `mode: 2`) sends alternating positions (`hdsp/xpt`, 0% and 100% of the stroke zone) with a
    duration of 650 ms down to 240 ms per half-stroke, so faster prose really strokes faster. Below ten percent
    intensity the strokes stop rather than slow to a crawl. It costs roughly two requests a second, which is the
    reason it is not the default and the reason a slow connection can make it feel mechanical.

  Unlike the two above this needs no local anything, but commands travel over the internet and the stroker keeps
  running if the tab dies — the panel says so, and Stop is the documented exit. Stopping switches the device back to
  HAMP first, which also cancels any stroke still in flight, then stops it there.

Safety rules the code enforces: never an indefinite hold (Lovense gets `timeSec: 2`, refreshed every 1.5 s, so a
closed tab stops moving within two seconds), Stop / tab hidden / `pagehide` / end of reply / disconnect all send a
stop, and three failed commands in a row stop the device and say so.

Unverified in this environment: neither a toy nor a LAN is available here, so the Lovense path has never been executed
against real hardware, and whether Game Mode answers CORS for a foreign origin is unconfirmed. The client copes with
the likely cases — `text/plain` is tried before `application/json` so a local server that cannot answer an `OPTIONS`
preflight still works, and the plain HTTP port is used only from a page served over HTTP. If a real toy still cannot be
reached, the next step is a tiny local relay rather than a hosted proxy, which would mean upkeep.

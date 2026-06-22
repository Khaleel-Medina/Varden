# Varden — Setup Guide

## Architecture
- **Supabase** — Auth (sign in/sign up), character database, row-level security
- **Vercel Blob** — Image storage for character art
- **IndexedDB** — Client-side cache for instant loads
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

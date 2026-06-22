# Varden Setup Guide

## What's done
- ✅ Supabase client wired up (`lib/supabase.js`)
- ✅ Auth (sign in/sign up) in the frontend
- ✅ Character CRUD via Supabase client
- ✅ Image upload to Supabase storage
- ✅ API route updated

## You need to do (5 minutes)

### 1. Run the schema
- Go to your Supabase dashboard: https://ljruzruhbqkbxkflrvzi.supabase.co
- Click **SQL Editor** (left sidebar)
- Click **New Query**
- Copy and paste the contents of `supabase-schema.sql`
- Click **Run**

### 2. Create storage bucket
- Go to **Storage** (left sidebar)
- Click **New bucket**
- Name: `characters`
- Public bucket: ✅ **enable**
- File size limit: `10MB`
- Allowed MIME types: `image/*`
- Click **Create**

### 3. Deploy to Vercel
```bash
vercel deploy
```

That's it. The app will now use Supabase for storage, auth, and persistence.

## Testing
1. Open the site locally: `npx serve .`
2. Click "Sign in" → create an account
3. Click "New character" → create a character
4. Verify it appears in the grid and persists on refresh

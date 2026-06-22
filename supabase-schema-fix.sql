-- Varden Supabase Schema Fix
-- Run in SQL Editor. This reconciles the remote branch schema with the new fields.

-- 1. Drop and recreate profiles with correct schema
drop policy if exists "users update own profile" on profiles;
drop policy if exists "users insert own profile" on profiles;
drop policy if exists "profiles visible to all" on profiles;
drop policy if exists "characters readable by all" on characters;
drop policy if exists "owners full access to characters" on characters;
drop policy if exists "uploads readable by all" on uploads;
drop policy if exists "users manage own uploads" on uploads;

drop table if exists profiles;

create table profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table profiles enable row level security;

create policy "profiles visible to all" on profiles for select using (true);
create policy "users update own profile" on profiles for update using (auth.uid() = id);
create policy "users insert own profile" on profiles for insert with check (auth.uid() = id);

-- 2. Add missing columns to characters table (idempotent)
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name='characters' and column_name='source') then
    alter table characters add column source text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='characters' and column_name='creator') then
    alter table characters add column creator text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='characters' and column_name='visibility') then
    alter table characters add column visibility text default 'private';
  end if;
  if not exists (select 1 from information_schema.columns where table_name='characters' and column_name='tagline') then
    alter table characters add column tagline text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='characters' and column_name='greeting') then
    alter table characters add column greeting text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='characters' and column_name='personality') then
    alter table characters add column personality text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='characters' and column_name='art_url') then
    alter table characters add column art_url text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='characters' and column_name='rating') then
    alter table characters add column rating text default '0.0';
  end if;
end $$;

-- 3. Fix RLS on characters
drop policy if exists "characters readable by all" on characters;
drop policy if exists "owners full access to characters" on characters;

create policy "characters readable by all" on characters for select using (true);
create policy "owners full access to characters" on characters for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 4. Fix RLS on uploads
drop policy if exists "uploads readable by all" on uploads;
drop policy if exists "users manage own uploads" on uploads;

create policy "uploads readable by all" on uploads for select using (true);
create policy "users manage own uploads" on uploads for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 5. Trigger for updated_at on profiles
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_profiles_updated_at on profiles;
create trigger update_profiles_updated_at before update on profiles
  for each row execute function update_updated_at_column();

drop trigger if exists update_characters_updated_at on characters;
create trigger update_characters_updated_at before update on characters
  for each row execute function update_updated_at_column();

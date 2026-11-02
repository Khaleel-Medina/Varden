-- Varden — shared character cards.
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query).
-- Safe to run more than once.

-- Metadata for each published card. The PNG itself lives in storage below.
create table if not exists shared_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  creator text,
  tagline text,
  tags text[] default '{}',
  card_path text not null,
  card_url text,
  size bigint,
  created_at timestamptz default now()
);

create index if not exists idx_shared_cards_created_at on shared_cards(created_at desc);
create index if not exists idx_shared_cards_user_id on shared_cards(user_id);

alter table shared_cards enable row level security;

drop policy if exists "shared cards are viewable by everyone" on shared_cards;
drop policy if exists "signed-in users publish shared cards" on shared_cards;
drop policy if exists "owners delete their shared cards" on shared_cards;

-- Anyone, signed in or not, can browse what has been published.
create policy "shared cards are viewable by everyone"
  on shared_cards for select using (true);

-- Publishing requires a real session, and the row must belong to that session.
create policy "signed-in users publish shared cards"
  on shared_cards for insert with check (auth.uid() = user_id);

create policy "owners delete their shared cards"
  on shared_cards for delete using (auth.uid() = user_id);

-- Storage: a public bucket so download needs no account, with uploads limited to
-- the uploader's own folder (first path segment is their user id).
insert into storage.buckets (id, name, public)
values ('cards', 'cards', true)
on conflict (id) do nothing;

drop policy if exists "card files are readable by everyone" on storage.objects;
drop policy if exists "signed-in users upload card files" on storage.objects;
drop policy if exists "owners delete their card files" on storage.objects;

create policy "card files are readable by everyone"
  on storage.objects for select using (bucket_id = 'cards');

create policy "signed-in users upload card files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'cards' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "owners delete their card files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'cards' and auth.uid()::text = (storage.foldername(name))[1]);

-- Varden — accounts, editable cards, public/private visibility.
-- Run this in the Supabase SQL editor after supabase-shared-cards.sql.
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table shared_cards add column if not exists visibility text not null default 'public';
alter table shared_cards add column if not exists bucket text not null default 'cards';
alter table shared_cards add column if not exists updated_at timestamptz not null default now();

do $$
begin
  alter table shared_cards
    add constraint shared_cards_visibility_check check (visibility in ('public', 'private'));
exception
  when duplicate_object then null;
end $$;

create index if not exists idx_shared_cards_visibility on shared_cards(visibility);
create index if not exists idx_shared_cards_user_updated on shared_cards(user_id, updated_at desc);

-- Bump updated_at whenever a row changes so "My cards" can sort by recency.
create or replace function shared_cards_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists shared_cards_touch on shared_cards;
create trigger shared_cards_touch
  before update on shared_cards
  for each row execute function shared_cards_touch();

-- ---------------------------------------------------------------------------
-- Row policies
--
-- Public cards are readable by anyone. Private cards are readable only by the
-- account that published them, which is why the select policy is conditional on
-- auth.uid() and every write is pinned to the owner.
-- ---------------------------------------------------------------------------

drop policy if exists "shared cards are viewable by everyone" on shared_cards;
drop policy if exists "public cards are viewable by everyone" on shared_cards;
drop policy if exists "signed-in users publish shared cards" on shared_cards;
drop policy if exists "owners update their shared cards" on shared_cards;
drop policy if exists "owners delete their shared cards" on shared_cards;

create policy "public cards are viewable by everyone"
  on shared_cards for select
  using (visibility = 'public' or auth.uid() = user_id);

create policy "signed-in users publish shared cards"
  on shared_cards for insert
  with check (auth.uid() = user_id);

create policy "owners update their shared cards"
  on shared_cards for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "owners delete their shared cards"
  on shared_cards for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Storage: two buckets, one public and one private
--
-- A private card's bytes must not be fetchable by URL guessing, so it lives in a
-- private bucket and the owner reads it through a signed URL. Making a card
-- public moves the file into the public bucket (the client copies then removes).
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('cards', 'cards', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('cards-private', 'cards-private', false)
on conflict (id) do nothing;

-- 8 MB cap and PNG only, matching the import limits on the site.
update storage.buckets
set file_size_limit = 8388608,
    allowed_mime_types = array['image/png']
where id in ('cards', 'cards-private');

drop policy if exists "card files are readable by everyone" on storage.objects;
drop policy if exists "signed-in users upload card files" on storage.objects;
drop policy if exists "owners delete their card files" on storage.objects;
drop policy if exists "owners read their private card files" on storage.objects;
drop policy if exists "owners upload private card files" on storage.objects;
drop policy if exists "owners update private card files" on storage.objects;
drop policy if exists "owners delete private card files" on storage.objects;

-- Public bucket: reading needs no account, writing stays inside your own folder.
create policy "card files are readable by everyone"
  on storage.objects for select
  using (bucket_id = 'cards');

create policy "signed-in users upload card files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'cards' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "owners delete their card files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'cards' and auth.uid()::text = (storage.foldername(name))[1]);

-- Private bucket: owner only, for every verb.
create policy "owners read their private card files"
  on storage.objects for select to authenticated
  using (bucket_id = 'cards-private' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "owners upload private card files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'cards-private' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "owners update private card files"
  on storage.objects for update to authenticated
  using (bucket_id = 'cards-private' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "owners delete private card files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'cards-private' and auth.uid()::text = (storage.foldername(name))[1]);

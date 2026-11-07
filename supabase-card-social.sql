-- Varden — likes and comments on published cards.
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query).
-- Safe to run more than once.
--
-- Both tables hang off shared_cards, so removing a card removes its likes and
-- comments with it. Reads are open to everyone because the community feed is
-- public; writes require a session and must be attributed to that session.

create table if not exists card_likes (
  card_id uuid references shared_cards(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  created_at timestamptz default now(),
  -- One like per person per card, enforced by the key rather than by the app.
  primary key (card_id, user_id)
);

create index if not exists idx_card_likes_card on card_likes(card_id);

create table if not exists card_comments (
  id uuid primary key default gen_random_uuid(),
  card_id uuid references shared_cards(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  author text,
  body text not null,
  created_at timestamptz default now(),
  constraint card_comments_body_length check (char_length(body) between 1 and 800)
);

create index if not exists idx_card_comments_card on card_comments(card_id, created_at);

alter table card_likes enable row level security;
alter table card_comments enable row level security;

drop policy if exists "card likes are readable by everyone" on card_likes;
drop policy if exists "signed-in visitors like as themselves" on card_likes;
drop policy if exists "visitors remove their own like" on card_likes;

create policy "card likes are readable by everyone"
  on card_likes for select using (true);

create policy "signed-in visitors like as themselves"
  on card_likes for insert to authenticated
  with check (auth.uid() = user_id);

create policy "visitors remove their own like"
  on card_likes for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists "card comments are readable by everyone" on card_comments;
drop policy if exists "signed-in visitors comment as themselves" on card_comments;
drop policy if exists "authors delete their own comments" on card_comments;

create policy "card comments are readable by everyone"
  on card_comments for select using (true);

create policy "signed-in visitors comment as themselves"
  on card_comments for insert to authenticated
  with check (auth.uid() = user_id);

create policy "authors delete their own comments"
  on card_comments for delete to authenticated
  using (auth.uid() = user_id);

-- Table privileges: reading is public, writing needs a session. Row policies above
-- still decide which rows those statements may touch.
grant select on card_likes to anon, authenticated;
grant insert, delete on card_likes to authenticated;
grant select on card_comments to anon, authenticated;
grant insert, delete on card_comments to authenticated;

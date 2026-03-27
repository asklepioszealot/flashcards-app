-- Core public schema for flashcards-app recovery.
-- This file captures the application-owned table that stores flashcard sets.
-- Study-state sync can run in a dedicated table, but that is optional and is
-- documented separately in `docs/SUPABASE_SYNC_SETUP.sql`.

create table if not exists public.flashcard_sets (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  slug text not null,
  set_name text not null,
  file_name text not null,
  source_format text not null check (source_format in ('json', 'markdown', 'system')),
  raw_source text not null default '',
  cards_json jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists flashcard_sets_user_updated_idx
  on public.flashcard_sets (user_id, updated_at desc);

create index if not exists flashcard_sets_user_slug_idx
  on public.flashcard_sets (user_id, slug);

alter table public.flashcard_sets enable row level security;

drop policy if exists "flashcard_sets_select_own" on public.flashcard_sets;
create policy "flashcard_sets_select_own"
on public.flashcard_sets
for select
using (auth.uid() = user_id);

drop policy if exists "flashcard_sets_insert_own" on public.flashcard_sets;
create policy "flashcard_sets_insert_own"
on public.flashcard_sets
for insert
with check (auth.uid() = user_id);

drop policy if exists "flashcard_sets_update_own" on public.flashcard_sets;
create policy "flashcard_sets_update_own"
on public.flashcard_sets
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "flashcard_sets_delete_own" on public.flashcard_sets;
create policy "flashcard_sets_delete_own"
on public.flashcard_sets
for delete
using (auth.uid() = user_id);

-- Optional setup:
-- The app can now fall back to a hidden sync record inside `flashcard_sets`
-- when this table is missing. Run this only if you want a dedicated table
-- for user study-state snapshots.

create table if not exists public.flashcard_user_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.flashcard_user_state enable row level security;

drop policy if exists "flashcard_user_state_select_own" on public.flashcard_user_state;
create policy "flashcard_user_state_select_own"
on public.flashcard_user_state
for select
using (auth.uid() = user_id);

drop policy if exists "flashcard_user_state_upsert_own" on public.flashcard_user_state;
create policy "flashcard_user_state_upsert_own"
on public.flashcard_user_state
for insert
with check (auth.uid() = user_id);

drop policy if exists "flashcard_user_state_update_own" on public.flashcard_user_state;
create policy "flashcard_user_state_update_own"
on public.flashcard_user_state
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "flashcard_user_state_delete_own" on public.flashcard_user_state;
create policy "flashcard_user_state_delete_own"
on public.flashcard_user_state
for delete
using (auth.uid() = user_id);

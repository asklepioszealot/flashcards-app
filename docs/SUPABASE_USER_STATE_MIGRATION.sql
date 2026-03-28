begin;

create table if not exists public.flashcard_user_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.flashcard_user_state (user_id, state_json, updated_at)
select
  legacy.user_id,
  jsonb_build_object(
    'selectedSetIds', coalesce(legacy.payload -> 'selectedSetIds', '[]'::jsonb),
    'assessments', coalesce(legacy.payload -> 'assessments', '{}'::jsonb),
    'session', coalesce(legacy.payload -> 'session', 'null'::jsonb),
    'autoAdvanceEnabled', coalesce(to_jsonb((legacy.payload ->> 'autoAdvanceEnabled')::boolean), 'true'::jsonb),
    'updatedAt', to_jsonb(coalesce(legacy.payload ->> 'updatedAt', legacy.updated_at::text))
  ),
  legacy.updated_at
from (
  select
    fs.user_id,
    fs.updated_at,
    case
      when jsonb_typeof(fs.cards_json) = 'array' then coalesce(fs.cards_json -> 0 -> 'payload', '{}'::jsonb)
      else '{}'::jsonb
    end as payload
  from public.flashcard_sets fs
  where fs.id like 'fc_v2::system::study-state::%'
     or fs.slug = '__system-study-state__'
     or fs.set_name = '__system_study_state__'
) legacy
on conflict (user_id) do update
set
  state_json = case
    when excluded.updated_at >= public.flashcard_user_state.updated_at then excluded.state_json
    else public.flashcard_user_state.state_json
  end,
  updated_at = greatest(public.flashcard_user_state.updated_at, excluded.updated_at);

delete from public.flashcard_sets
where id like 'fc_v2::system::study-state::%'
   or slug = '__system-study-state__'
   or set_name = '__system_study_state__';

commit;

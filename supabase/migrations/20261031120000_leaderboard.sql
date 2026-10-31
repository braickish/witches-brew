-- The leaderboard. Anyone can read visible scores; only the server functions can write anything.

-- A game the server has handed out. Deleted after a day.
create table public.runs (
  id uuid primary key default gen_random_uuid(),
  seed integer not null,
  ip_hash text,
  attempts integer not null default 0,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index runs_created_at on public.runs (created_at);
create index runs_ip_hash on public.runs (ip_hash, created_at);

create table public.scores (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique,
  name text not null check (char_length(name) between 2 and 12),
  score integer not null check (score > 0),
  game_ms integer not null,
  events jsonb not null,                 -- kept so a suspicious score can be looked at later
  hidden boolean not null default false, -- tick this in the dashboard to take an entry off the board
  created_at timestamptz not null default now()
);
create index scores_top on public.scores (score desc, created_at) where not hidden;

alter table public.runs enable row level security;
alter table public.scores enable row level security;

revoke all on public.runs from public, anon, authenticated;
revoke all on public.scores from public, anon, authenticated;
grant all on public.runs, public.scores to service_role;

grant select (id, name, score, created_at) on public.scores to anon, authenticated;
create policy "Anyone can read visible scores" on public.scores
  for select to anon, authenticated using (not hidden);

create function public.issue_run(p_seed integer, p_ip_hash text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  new_id uuid;
begin
  delete from public.runs where created_at < now() - interval '1 day';
  if p_ip_hash is not null and (
    select count(*) from public.runs
    where ip_hash = p_ip_hash and created_at > now() - interval '1 minute'
  ) >= 30 then
    raise exception 'too_many_runs';
  end if;
  insert into public.runs (seed, ip_hash) values (p_seed, p_ip_hash) returning id into new_id;
  return new_id;
end;
$$;

-- Counts an attempt at submitting. A game gets 5, which is plenty for a real one retrying a bad connection.
create function public.claim_run(p_run_id uuid)
returns table (seed integer, created_at timestamptz)
language sql
set search_path = ''
as $$
  update public.runs r
  set attempts = r.attempts + 1
  where r.id = p_run_id
    and r.used_at is null
    and r.attempts < 5
    and r.created_at > now() - interval '1 day'
  returning r.seed, r.created_at;
$$;

create function public.record_score(p_run_id uuid, p_name text, p_score integer, p_game_ms integer, p_events jsonb)
returns table (entry_id uuid, entry_rank bigint)
language plpgsql
set search_path = ''
as $$
declare
  hundredth integer;
  new_id uuid;
begin
  select s.score into hundredth from public.scores s
  where not s.hidden order by s.score desc, s.created_at offset 99 limit 1;
  if hundredth is not null and p_score <= hundredth then
    raise exception 'not_top';
  end if;

  update public.runs r set used_at = now() where r.id = p_run_id and r.used_at is null;
  if not found then
    raise exception 'run_used';
  end if;

  insert into public.scores (run_id, name, score, game_ms, events)
  values (p_run_id, p_name, p_score, p_game_ms, p_events)
  returning id into new_id;

  return query
  select new_id, count(*) + 1 from public.scores s
  where not s.hidden and s.score > p_score;
end;
$$;

revoke all on function public.issue_run(integer, text) from public, anon, authenticated;
revoke all on function public.claim_run(uuid) from public, anon, authenticated;
revoke all on function public.record_score(uuid, text, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.issue_run(integer, text) to service_role;
grant execute on function public.claim_run(uuid) to service_role;
grant execute on function public.record_score(uuid, text, integer, integer, jsonb) to service_role;

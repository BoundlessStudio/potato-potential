-- Transactional outbox. Vercel delivers jobs; Postgres retains ownership and repair state.
create table public.application_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  kind text not null check (kind in ('provision','cleanup','reconcile')),
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  worker_token uuid, locked_until timestamptz,
  dispatch_token uuid, dispatch_after timestamptz not null default now(),
  run_id text, failures integer not null default 0,
  error_code text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index one_active_customer_job on public.application_jobs(owner_id,kind) where status in ('queued','running');
alter table public.application_jobs enable row level security;
revoke all on public.application_jobs from anon,authenticated;
grant all on public.application_jobs to service_role;

create function public.enqueue_application_job(p_owner_id uuid,p_kind text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job public.application_jobs;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text||':'||p_kind,0));
  select * into job from public.application_jobs where owner_id=p_owner_id and kind=p_kind and status in ('queued','running');
  if not found then
    insert into public.application_jobs(owner_id,kind) values(p_owner_id,p_kind) returning * into job;
  end if;
  return to_jsonb(job);
end;
$$;

create function public.claim_job_dispatch(p_id uuid,p_token uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.application_jobs set dispatch_token=p_token,dispatch_after=now()+interval '10 minutes',updated_at=now()
    where id=p_id and status in ('queued','running') and dispatch_after<=now() and (locked_until is null or locked_until<now());
  return found;
end;
$$;

create function public.claim_application_job(p_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job public.application_jobs;
begin
  update public.application_jobs set worker_token=p_token,locked_until=now()+interval '6 minutes',status='running',updated_at=now()
    where id=p_id and status in ('queued','running') and (worker_token=p_token or locked_until is null or locked_until<now())
    returning * into job;
  if not found then return null; end if;
  return to_jsonb(job);
end;
$$;

create function public.finish_application_job(p_id uuid,p_token uuid,p_outcome text,p_error text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_outcome not in ('continue','completed','retry','failed') then raise exception 'invalid outcome'; end if;
  update public.application_jobs set
    status=case when p_outcome='continue' then 'running' when p_outcome='retry' and failures<4 then 'queued' when p_outcome='retry' then 'failed' else p_outcome end,
    failures=failures+case when p_outcome in ('retry','failed') then 1 else 0 end,
    error_code=p_error,
    locked_until=case when p_outcome='continue' then now()+interval '6 minutes' else null end,
    worker_token=case when p_outcome='continue' then p_token else null end,
    updated_at=now()
    where id=p_id and worker_token=p_token and status='running';
end;
$$;

revoke all on function public.enqueue_application_job(uuid,text),public.claim_job_dispatch(uuid,uuid),public.claim_application_job(uuid,uuid),public.finish_application_job(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.enqueue_application_job(uuid,text),public.claim_job_dispatch(uuid,uuid),public.claim_application_job(uuid,uuid),public.finish_application_job(uuid,uuid,text,text) to service_role;

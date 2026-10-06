create table public.customers (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  profile jsonb not null,
  created_at timestamptz not null default now()
);
create table public.agents (
  owner_id uuid primary key references public.customers(id) on delete cascade,
  instance_id text unique,
  inkbox_handle text unique,
  state jsonb not null,
  updated_at timestamptz not null default now(),
  constraint instance_shape check (instance_id is null or instance_id ~ '^[a-z0-9]{10}$')
);
create table public.invitations (
  id uuid primary key default gen_random_uuid(), email text not null,
  token_hash text unique not null, expires_at timestamptz not null,
  used_by uuid, created_at timestamptz not null default now()
);
create table public.workspace_items (
  id uuid primary key, owner_id uuid not null references public.customers(id) on delete cascade,
  kind text not null check (kind in ('task','wiki','suggestion','responsibility')),
  item jsonb not null, updated_at timestamptz not null default now()
);
create index workspace_owner on public.workspace_items(owner_id,kind);
create function public.protect_item_owner() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.owner_id <> old.owner_id then raise exception 'item ownership cannot change'; end if;
  return new;
end;
$$;
create trigger immutable_item_owner before update on public.workspace_items for each row execute function public.protect_item_owner();
create table public.notifications (
  id uuid primary key, owner_id uuid not null references public.customers(id) on delete cascade,
  note jsonb not null, created_at timestamptz not null default now()
);
create index notifications_owner on public.notifications(owner_id,created_at);
create table public.conversations (
  owner_id uuid not null references public.customers(id) on delete cascade,
  session_id text not null, conversation jsonb not null,
  created_at timestamptz not null default now(), primary key(owner_id,session_id)
);
create table public.cron_archive (
  owner_id uuid not null references public.customers(id) on delete cascade,
  run_key text not null, run jsonb not null, primary key(owner_id,run_key)
);
create table public.customer_leases (
  owner_id uuid primary key, token uuid not null, expires_at timestamptz not null
);

alter table public.customers enable row level security;
alter table public.agents enable row level security;
alter table public.invitations enable row level security;
alter table public.workspace_items enable row level security;
alter table public.notifications enable row level security;
alter table public.conversations enable row level security;
alter table public.cron_archive enable row level security;
alter table public.customer_leases enable row level security;
-- Secret-bearing agent state, invitations and leases have no client policies.
-- Writes go through the authenticated control plane, never through the browser.
create policy own_customer on public.customers for select to authenticated using ((select auth.uid()) = id);
create policy own_items on public.workspace_items for select to authenticated using ((select auth.uid()) = owner_id);
create policy own_notifications on public.notifications for select to authenticated using ((select auth.uid()) = owner_id);
create policy own_conversations on public.conversations for select to authenticated using ((select auth.uid()) = owner_id);
create policy own_archive on public.cron_archive for select to authenticated using ((select auth.uid()) = owner_id);
revoke all on public.agents,public.invitations,public.customer_leases from anon,authenticated;
grant all on public.agents,public.invitations,public.customer_leases to service_role;
grant select on public.customers,public.workspace_items,public.notifications,public.conversations,public.cron_archive to authenticated;
grant all on public.customers,public.workspace_items,public.notifications,public.conversations,public.cron_archive to service_role;

create function public.claim_invitation(p_owner_id uuid,p_email text,p_hash text) returns void
language plpgsql security definer set search_path = '' as $$
declare invitation public.invitations;
begin
  select * into invitation from public.invitations where token_hash = p_hash for update;
  if not found or invitation.email <> lower(p_email) or invitation.expires_at < now()
     or (invitation.used_by is not null and invitation.used_by <> p_owner_id) then
    raise exception 'invalid invitation';
  end if;
  update public.invitations set used_by = p_owner_id where id = invitation.id;
end;
$$;
create function public.claim_customer_lease(p_owner_id uuid,p_token uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.customer_leases(owner_id,token,expires_at) values(p_owner_id,p_token,now()+interval '3 minutes')
  on conflict(owner_id) do update set token=excluded.token,expires_at=excluded.expires_at
  where public.customer_leases.expires_at < now();
  return found;
end;
$$;
create function public.renew_customer_lease(p_owner_id uuid,p_token uuid) returns void
language sql security definer set search_path = '' as $$
  update public.customer_leases set expires_at=now()+interval '3 minutes' where owner_id=p_owner_id and token=p_token;
$$;
create function public.release_customer_lease(p_owner_id uuid,p_token uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.customer_leases where owner_id=p_owner_id and token=p_token;
$$;
revoke all on function public.claim_invitation(uuid,text,text),public.claim_customer_lease(uuid,uuid),public.renew_customer_lease(uuid,uuid),public.release_customer_lease(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_invitation(uuid,text,text),public.claim_customer_lease(uuid,uuid),public.renew_customer_lease(uuid,uuid),public.release_customer_lease(uuid,uuid) to service_role;

-- Supabase realtime sends only rows admitted by each subscriber's SELECT policy.
alter publication supabase_realtime add table public.workspace_items,public.notifications;

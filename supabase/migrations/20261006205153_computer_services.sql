alter table public.agents add constraint agents_owner_instance unique (owner_id,instance_id);

create table public.computer_services (
  owner_id uuid not null references public.customers(id) on delete cascade,
  instance_id text not null,
  port integer not null check (port between 1 and 65535),
  service jsonb not null,
  primary key (owner_id,port),
  foreign key (owner_id,instance_id) references public.agents(owner_id,instance_id) on delete cascade,
  check ((service->>'ownerId' = owner_id::text and service->>'instanceId' = instance_id and (service->>'port')::integer = port) is true)
);
create table public.computer_link_requests (
  id uuid primary key,
  owner_id uuid not null references public.customers(id) on delete cascade,
  instance_id text not null,
  port integer not null,
  kind text not null check (kind in ('signed','public')),
  status text not null check (status in ('pending','publishing','approved','rejected','failed','revoked')),
  request jsonb not null,
  created_at timestamptz not null,
  foreign key (owner_id,instance_id) references public.agents(owner_id,instance_id) on delete cascade,
  foreign key (owner_id,port) references public.computer_services(owner_id,port) on delete cascade,
  check ((request->>'id' = id::text and request->>'ownerId' = owner_id::text and request->>'instanceId' = instance_id and (request->>'port')::integer = port and request->>'kind' = kind and request->>'status' = status) is true)
);
create unique index computer_one_pending_port on public.computer_link_requests(owner_id,instance_id,port,kind) where status in ('pending','publishing');
create index computer_requests_owner on public.computer_link_requests(owner_id,created_at);
create function public.protect_computer_binding() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.owner_id <> old.owner_id or new.instance_id <> old.instance_id or new.port <> old.port then
    raise exception 'computer ownership cannot change';
  end if;
  if tg_table_name = 'computer_link_requests' then
    if new.id <> old.id or new.kind <> old.kind then raise exception 'request identity cannot change'; end if;
  end if;
  return new;
end;
$$;
create trigger immutable_computer_service before update on public.computer_services for each row execute function public.protect_computer_binding();
create trigger immutable_computer_request before update on public.computer_link_requests for each row execute function public.protect_computer_binding();
alter table public.computer_services enable row level security;
alter table public.computer_link_requests enable row level security;
revoke all on public.computer_services,public.computer_link_requests from anon,authenticated;
grant all on public.computer_services,public.computer_link_requests to service_role;

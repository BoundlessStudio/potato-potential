create table public.file_uploads (
  id uuid primary key,
  owner_id uuid not null references public.customers(id) on delete cascade,
  instance_id text not null,
  state text not null check (state in ('uploading','finalizing','completed','cancelled','expired')),
  expires_at timestamptz not null,
  upload jsonb not null,
  foreign key (owner_id,instance_id) references public.agents(owner_id,instance_id) on delete cascade,
  check ((upload->>'id'=id::text and upload->>'ownerId'=owner_id::text and upload->>'instanceId'=instance_id and upload->>'state'=state) is true)
);
create index file_uploads_owner on public.file_uploads(owner_id,expires_at);
create function public.protect_file_upload() returns trigger language plpgsql set search_path='' as $$
begin
  if new.id<>old.id or new.owner_id<>old.owner_id or new.instance_id<>old.instance_id
    or new.upload->>'directory' is distinct from old.upload->>'directory'
    or new.upload->>'name' is distinct from old.upload->>'name'
    or new.upload->>'size' is distinct from old.upload->>'size'
    or new.upload->>'sha256' is distinct from old.upload->>'sha256' then
    raise exception 'upload identity cannot change';
  end if;
  return new;
end;
$$;
create trigger immutable_file_upload before update on public.file_uploads for each row execute function public.protect_file_upload();
alter table public.file_uploads enable row level security;
revoke all on public.file_uploads from anon,authenticated;
grant all on public.file_uploads to service_role;

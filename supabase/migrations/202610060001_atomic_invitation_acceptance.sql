-- Enroll and consume the invitation in one transaction, preserving consumed
-- tokens after account deletion. Only the verified server auth path may call this.
create function public.accept_invitation(
  p_owner_id uuid, p_email text, p_hash text, p_profile jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  invitation public.invitations;
begin
  select * into invitation from public.invitations where token_hash=p_hash for update;
  if not found or invitation.email <> lower(p_email)
    or (invitation.used_by is not null and invitation.used_by <> p_owner_id)
    or (invitation.expires_at <= now() and not coalesce((
      invitation.used_by = p_owner_id and exists(select 1 from public.customers where id=p_owner_id)
    ), false))
    or p_profile->>'id' is distinct from p_owner_id::text
    or lower(p_profile->>'email') is distinct from lower(p_email)
  then raise exception 'invalid invitation'; end if;

  insert into public.customers(id,email,profile)
    values(p_owner_id,lower(p_email),p_profile) on conflict(id) do nothing;
  update public.invitations set used_by=p_owner_id where id=invitation.id;
end;
$$;
revoke all on function public.accept_invitation(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.accept_invitation(uuid,text,text,jsonb) to service_role;

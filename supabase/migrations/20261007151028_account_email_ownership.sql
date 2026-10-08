-- Historical email addresses can belong to another account after an email
-- change. Erase only this owner's invitations and unshared beta approvals.
create or replace function public.erase_account_links() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  account_emails text[];
begin
  if exists (
    select 1 from public.agents where owner_id = old.id
      and (state->'deletion'->>'instance' is distinct from 'true'
        or state->'deletion'->>'identity' is distinct from 'true')
  ) then
    raise exception 'provider cleanup must complete before account deletion';
  end if;

  select array_agg(distinct address.email) into account_emails
  from (
    select lower(btrim(old.email)) as email
    union select lower(btrim(email)) from public.customers where id = old.id
    union select lower(btrim(email)) from public.invitations where used_by = old.id
  ) as address
  where address.email is not null
    and not exists (
      select 1 from auth.users as other
      where other.id <> old.id and lower(btrim(other.email)) = address.email
    )
    and not exists (
      select 1 from public.customers as other
      where other.id <> old.id and lower(btrim(other.email)) = address.email
    )
    and not exists (
      select 1 from public.invitations as invitation
      join auth.users as other on other.id = invitation.used_by
      where other.id <> old.id and lower(btrim(invitation.email)) = address.email
    );

  delete from public.beta_requests where email = any(account_emails);
  delete from public.invitations
    where used_by = old.id
      or (used_by is null and lower(btrim(email)) = any(account_emails));
  delete from public.customer_leases where owner_id = old.id;
  return old;
end;
$$;
revoke all on function public.erase_account_links() from public, anon, authenticated, service_role;

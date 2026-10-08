-- Account closure also removes the customer's beta request. Keep this cleanup
-- in the Auth deletion transaction, after provider cleanup has completed.
create or replace function public.erase_account_links() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  customer_email text;
  account_emails text[];
begin
  if exists (
    select 1 from public.agents where owner_id = old.id
      and (state->'deletion'->>'instance' is distinct from 'true'
        or state->'deletion'->>'identity' is distinct from 'true')
  ) then
    raise exception 'provider cleanup must complete before account deletion';
  end if;

  select email into customer_email from public.customers where id = old.id;
  account_emails := array[lower(btrim(customer_email)), lower(btrim(old.email))];
  delete from public.beta_requests
    where email = any(account_emails)
      or email in (
        select lower(btrim(email)) from public.invitations where used_by = old.id
      );
  delete from public.invitations
    where used_by = old.id or lower(email) = any(account_emails);
  -- Email-scoped invitation locks can also exist without an Auth owner.
  delete from public.customer_leases where owner_id = old.id;
  return old;
end;
$$;
revoke all on function public.erase_account_links() from public, anon, authenticated, service_role;

-- Beta requests belong to an email address, independently of Auth accounts.
alter table public.beta_requests drop column approved_by;

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
  account_emails := array[lower(customer_email), lower(old.email)];
  delete from public.invitations
    where used_by = old.id or lower(email) = any(account_emails);
  -- Email-scoped invitation locks can also exist without an Auth owner.
  delete from public.customer_leases where owner_id = old.id;
  return old;
end;
$$;
revoke all on function public.erase_account_links() from public, anon, authenticated, service_role;

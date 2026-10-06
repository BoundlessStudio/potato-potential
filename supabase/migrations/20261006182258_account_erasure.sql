-- Keep provider ownership until remote cleanup succeeds. The Auth deletion then
-- erases ancillary records in the same transaction as the existing cascades.
-- The foreign key prevents delayed requests from recreating orphan jobs.
delete from public.application_jobs j
  where not exists (select 1 from auth.users u where u.id = j.owner_id);
alter table public.application_jobs add constraint application_jobs_owner_fkey
  foreign key (owner_id) references auth.users(id) on delete cascade;

create function public.erase_account_links() returns trigger
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
  delete from public.beta_requests where email = any(account_emails);
  -- Closing an operator account must not erase other people's beta requests.
  update public.beta_requests set approved_by = null where approved_by = old.id;
  -- This table also holds email-scoped invitation locks without an Auth owner.
  delete from public.customer_leases where owner_id = old.id;
  return old;
end;
$$;
revoke all on function public.erase_account_links() from public, anon, authenticated, service_role;
create trigger erase_account_links before delete on auth.users
  for each row execute function public.erase_account_links();

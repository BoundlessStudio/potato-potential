-- Public signup is mediated by the application. Neither applicants nor customers
-- can read the review queue, approve themselves, or obtain invitation credentials.
create table public.beta_requests (
  email text primary key check (email = lower(btrim(email)) and length(email) <= 254),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid,
  sent_at timestamptz,
  invitation_box text,
  expires_at timestamptz
);
alter table public.beta_requests enable row level security;
revoke all on public.beta_requests from anon, authenticated;
grant all on public.beta_requests to service_role;

-- Keep previously invited people in the operator's beta list.
insert into public.beta_requests(email,created_at,approved_at,sent_at)
select lower(btrim(email)), min(created_at), min(created_at), max(created_at)
from public.invitations group by lower(btrim(email))
on conflict (email) do nothing;

alter table public.application_jobs drop constraint application_jobs_kind_check;
alter table public.application_jobs add constraint application_jobs_kind_check
  check (kind in ('provision','cleanup','reconcile','maintenance'));

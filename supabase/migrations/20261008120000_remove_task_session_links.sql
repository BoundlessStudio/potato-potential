-- Tasks and responsibilities retain their own details independently of sessions.
update public.workspace_items
set item = item - 'sessionLinks'
where kind in ('task', 'responsibility') and item ? 'sessionLinks';

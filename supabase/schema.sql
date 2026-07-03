create table if not exists public.saved_trips (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  destination text not null,
  date_range text not null,
  plan jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.saved_trips enable row level security;

drop policy if exists "Users can read their own saved trips" on public.saved_trips;
create policy "Users can read their own saved trips"
  on public.saved_trips for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own saved trips" on public.saved_trips;
create policy "Users can insert their own saved trips"
  on public.saved_trips for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own saved trips" on public.saved_trips;
create policy "Users can update their own saved trips"
  on public.saved_trips for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own saved trips" on public.saved_trips;
create policy "Users can delete their own saved trips"
  on public.saved_trips for delete
  using (auth.uid() = user_id);

create table if not exists public.search_usage (
  visitor_id text primary key,
  search_count integer not null default 0,
  first_search_at timestamptz not null default now(),
  last_search_at timestamptz not null default now()
);

alter table public.search_usage enable row level security;

-- No public policies are needed. Cloudflare Pages Functions use the service role key
-- to update anonymous search usage before paid AI calls are made.

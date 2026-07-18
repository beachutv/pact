-- ============================================================
-- Pact V1 — Initial Schema
-- Run this in Supabase SQL Editor (dashboard.supabase.com)
-- ============================================================

create extension if not exists "pgcrypto";

-- ==================== USERS ====================
create table public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  name          text not null,
  email         text not null unique,
  color         text not null default '#7c5cff',
  home_area     text not null default '',
  home_x        real not null default 0,
  home_y        real not null default 0,
  birthday      text,
  avatar_url    text,
  phone         text,
  address       text,
  share_phone   text not null default 'nobody' check (share_phone in ('nobody', 'circles')),
  share_address text not null default 'nobody' check (share_address in ('nobody', 'circles')),
  theme         text not null default 'system' check (theme in ('light','dark','system')),
  precise_loc   boolean not null default false,
  live_lat      real,
  live_lng      real,
  live_area     text,
  live_updated_at timestamptz,
  created_at    timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ==================== CIRCLES ====================
create table public.circles (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  emoji         text not null default '🍻',
  created_by    uuid not null references public.users(id),
  invite_code   text unique default encode(gen_random_bytes(6), 'hex'),
  created_at    timestamptz not null default now()
);

create table public.circle_members (
  circle_id     uuid not null references public.circles(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  role          text not null default 'member' check (role in ('admin','member')),
  joined_at     timestamptz not null default now(),
  primary key (circle_id, user_id)
);

-- ==================== CALENDAR CONNECTIONS ====================
create table public.calendar_connections (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  provider      text not null check (provider in ('google','apple','manual')),
  access_token  text,
  refresh_token text,
  token_expiry  timestamptz,
  calendar_id   text,
  selected_calendars text[] default array['primary'],
  connected_at  timestamptz not null default now(),
  unique(user_id, provider)
);

-- ==================== PACTS (must exist before busy_blocks references it) ====================
create table public.pacts (
  id            uuid primary key default gen_random_uuid(),
  date          date not null,
  win_start     smallint not null,
  win_end       smallint not null,
  spot_name     text not null,
  spot_emoji    text not null default '📍',
  spot_area     text not null,
  circle_id     uuid references public.circles(id),
  occasion      text,
  created_by    uuid references public.users(id),
  from_message  uuid,
  created_at    timestamptz not null default now()
);

create table public.pact_members (
  pact_id       uuid not null references public.pacts(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  primary key (pact_id, user_id)
);

-- ==================== BUSY BLOCKS ====================
create table public.busy_blocks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  date          date not null,
  start_hour    smallint not null check (start_hour between 0 and 23),
  end_hour      smallint not null check (end_hour between 1 and 24),
  source        text not null default 'google' check (source in ('google','apple','manual','pact')),
  pact_id       uuid references public.pacts(id) on delete cascade,
  created_at    timestamptz not null default now(),
  constraint valid_range check (end_hour > start_hour)
);

create index idx_busy_user_date on public.busy_blocks(user_id, date);

-- ==================== CHAT ====================
create table public.threads (
  id            uuid primary key default gen_random_uuid(),
  name          text,
  circle_id     uuid references public.circles(id),
  created_at    timestamptz not null default now()
);

create table public.thread_members (
  thread_id     uuid not null references public.threads(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  primary key (thread_id, user_id)
);

create table public.messages (
  id            uuid primary key default gen_random_uuid(),
  thread_id     uuid not null references public.threads(id) on delete cascade,
  from_user     uuid not null references public.users(id),
  text          text,
  date_card     date,
  win_start     smallint,
  win_end       smallint,
  spot_name     text,
  spot_emoji    text,
  spot_area     text,
  spot_avg_travel smallint,
  with_user_ids uuid[],
  group_n       smallint,
  free_n        smallint,
  confirmed     boolean not null default false,
  created_at    timestamptz not null default now()
);

create index idx_messages_thread on public.messages(thread_id, created_at);

-- Add foreign key for pacts.from_message now that messages exists
alter table public.pacts add constraint fk_pacts_from_message
  foreign key (from_message) references public.messages(id);

create table public.rsvps (
  message_id    uuid not null references public.messages(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  response      text not null default 'in' check (response in ('in','out')),
  responded_at  timestamptz not null default now(),
  primary key (message_id, user_id)
);

-- ==================== OCCASIONS ====================
create table public.occasions (
  id            uuid primary key default gen_random_uuid(),
  circle_id     uuid not null references public.circles(id) on delete cascade,
  date          date not null,
  emoji         text not null,
  label         text not null,
  pact_id       uuid references public.pacts(id),
  created_by    uuid not null references public.users(id),
  created_at    timestamptz not null default now()
);

-- ==================== FAVORITE SPOTS ====================
create table public.favorite_spots (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  circle_id     uuid references public.circles(id),
  name          text not null,
  emoji         text not null default '📍',
  area          text not null,
  x             real not null,
  y             real not null,
  type          text not null default 'food',
  created_at    timestamptz not null default now()
);

-- ==================== RLS HELPER FUNCTIONS ====================
-- SECURITY DEFINER functions bypass RLS, breaking circular policy dependencies

create or replace function public.get_my_circle_ids()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select circle_id from public.circle_members where user_id = auth.uid()
$$;

create or replace function public.get_my_circle_mate_ids()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select distinct cm2.user_id
  from public.circle_members cm1
  join public.circle_members cm2 on cm1.circle_id = cm2.circle_id
  where cm1.user_id = auth.uid()
$$;

-- ==================== ROW LEVEL SECURITY ====================
alter table public.users enable row level security;
alter table public.circles enable row level security;
alter table public.circle_members enable row level security;
alter table public.busy_blocks enable row level security;
alter table public.threads enable row level security;
alter table public.thread_members enable row level security;
alter table public.messages enable row level security;
alter table public.rsvps enable row level security;
alter table public.pacts enable row level security;
alter table public.pact_members enable row level security;
alter table public.occasions enable row level security;
alter table public.favorite_spots enable row level security;
alter table public.calendar_connections enable row level security;

-- Users
create policy "users_read_circle_mates" on public.users for select using (
  id = auth.uid() or id in (select public.get_my_circle_mate_ids())
);
create policy "users_update_own" on public.users for update using (id = auth.uid());

-- Circles
create policy "circles_member_read" on public.circles for select using (
  created_by = auth.uid() or id in (select public.get_my_circle_ids()) or invite_code is not null
);
create policy "circles_create" on public.circles for insert with check (created_by = auth.uid());
create policy "circles_delete" on public.circles for delete using (created_by = auth.uid());
create policy "circles_update" on public.circles for update using (
  id in (
    select circle_id from public.circle_members
    where user_id = auth.uid() and role = 'admin'
  )
);

-- Circle members
create policy "cm_read" on public.circle_members for select using (
  circle_id in (select public.get_my_circle_ids())
);
create policy "cm_insert" on public.circle_members for insert with check (user_id = auth.uid());
create policy "cm_delete" on public.circle_members for delete using (
  user_id = auth.uid() or circle_id in (
    select circle_id from public.circle_members
    where user_id = auth.uid() and role = 'admin'
  )
);
create policy "cm_update_admin" on public.circle_members for update using (
  circle_id in (
    select circle_id from public.circle_members
    where user_id = auth.uid() and role = 'admin'
  )
);

-- Busy blocks
create policy "busy_read" on public.busy_blocks for select using (
  user_id = auth.uid() or user_id in (select public.get_my_circle_mate_ids())
);
create policy "busy_own_write" on public.busy_blocks for insert with check (user_id = auth.uid());
create policy "busy_own_update" on public.busy_blocks for update using (user_id = auth.uid());
create policy "busy_own_delete" on public.busy_blocks for delete using (user_id = auth.uid());

-- Threads
create policy "threads_member" on public.threads for select using (
  id in (select thread_id from public.thread_members where user_id = auth.uid())
);
create policy "threads_create" on public.threads for insert with check (true);

-- Thread members
create policy "tm_read" on public.thread_members for select using (
  thread_id in (select thread_id from public.thread_members where user_id = auth.uid())
);
create policy "tm_insert" on public.thread_members for insert with check (true);

-- Messages
create policy "msg_read" on public.messages for select using (
  thread_id in (select thread_id from public.thread_members where user_id = auth.uid())
);
create policy "msg_send" on public.messages for insert with check (
  from_user = auth.uid() and
  thread_id in (select thread_id from public.thread_members where user_id = auth.uid())
);

-- RSVPs
create policy "rsvp_read" on public.rsvps for select using (
  message_id in (
    select m.id from public.messages m
    join public.thread_members tm on m.thread_id = tm.thread_id
    where tm.user_id = auth.uid()
  )
);
create policy "rsvp_write" on public.rsvps for insert with check (user_id = auth.uid());
create policy "rsvp_update" on public.rsvps for update using (user_id = auth.uid());

-- Pacts — all circle members can see pacts in their circles
create policy "pacts_read" on public.pacts for select using (
  circle_id in (select public.get_my_circle_ids())
);
create policy "pacts_create" on public.pacts for insert with check (true);
create policy "pacts_update" on public.pacts for update using (
  created_by = auth.uid() or circle_id in (
    select circle_id from public.circle_members
    where user_id = auth.uid() and role = 'admin'
  )
);
create policy "pacts_delete" on public.pacts for delete using (
  created_by = auth.uid() or circle_id in (
    select circle_id from public.circle_members
    where user_id = auth.uid() and role = 'admin'
  )
);

create policy "pm_read" on public.pact_members for select using (
  pact_id in (
    select id from public.pacts where circle_id in (select public.get_my_circle_ids())
  )
);
create policy "pm_insert" on public.pact_members for insert with check (true);
create policy "pm_delete" on public.pact_members for delete using (user_id = auth.uid());

-- Occasions
create policy "occ_read" on public.occasions for select using (
  circle_id in (select public.get_my_circle_ids())
);
create policy "occ_create" on public.occasions for insert with check (created_by = auth.uid());

-- Favorite spots
create policy "fav_read" on public.favorite_spots for select using (
  user_id = auth.uid() or circle_id in (select public.get_my_circle_ids())
);
create policy "fav_create" on public.favorite_spots for insert with check (user_id = auth.uid());
create policy "fav_delete" on public.favorite_spots for delete using (user_id = auth.uid());

-- Calendar connections
create policy "cal_own" on public.calendar_connections for select using (user_id = auth.uid());
create policy "cal_create" on public.calendar_connections for insert with check (user_id = auth.uid());
create policy "cal_update" on public.calendar_connections for update using (user_id = auth.uid());
create policy "cal_delete" on public.calendar_connections for delete using (user_id = auth.uid());

-- ==================== REALTIME ====================
-- Enable realtime on tables that need live updates
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.rsvps;
alter publication supabase_realtime add table public.pacts;
alter publication supabase_realtime add table public.pact_members;

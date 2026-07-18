-- Add busy_blocks to realtime publication for live calendar sync
alter publication supabase_realtime add table public.busy_blocks;

-- Add threads and thread_members for chat notifications
alter publication supabase_realtime add table public.threads;
alter publication supabase_realtime add table public.thread_members;

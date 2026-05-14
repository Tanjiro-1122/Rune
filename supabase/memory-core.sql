-- Jarvis Memory Core v1
-- Run in Supabase SQL Editor after the main Jarvis schema.

create extension if not exists pgcrypto;

create table if not exists agent_memories (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('identity', 'owner', 'project', 'rule', 'workflow', 'decision', 'safety', 'note')),
  title text not null,
  content text not null,
  project_key text not null default 'global',
  tags text[] not null default '{}',
  priority integer not null default 5 check (priority between 1 and 10),
  is_active boolean not null default true,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (title, project_key)
);

create table if not exists agent_memory_events (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid references agent_memories(id) on delete set null,
  event_type text not null,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists agent_memories_active_priority_idx
  on agent_memories(is_active, priority desc, updated_at desc);

create index if not exists agent_memories_project_key_idx
  on agent_memories(project_key, is_active, priority desc);

create index if not exists agent_memories_tags_idx
  on agent_memories using gin(tags);

create index if not exists agent_memory_events_created_at_idx
  on agent_memory_events(created_at desc);

alter table agent_memories
  alter column project_key set default 'global';

update agent_memories
set project_key = 'global'
where project_key is null;

alter table agent_memories
  alter column project_key set not null;

select 'Jarvis Memory Core schema installed' as status, now() as finished_at;

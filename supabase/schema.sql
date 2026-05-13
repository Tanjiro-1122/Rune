create extension if not exists pgcrypto;

create table if not exists conversations (
  id         uuid primary key default gen_random_uuid(),
  session_id text not null,
  created_at timestamptz default now()
);

create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  created_at      timestamptz default now()
);

create index if not exists conversations_session_id_created_at_idx
  on conversations(session_id, created_at desc);
create index if not exists messages_conversation_id_created_at_idx
  on messages(conversation_id, created_at);

create table if not exists workspaces (
  id          uuid primary key default gen_random_uuid(),
  session_id  text not null,
  name        text not null,
  description text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table if not exists conversation_workspaces (
  conversation_id uuid primary key references conversations(id) on delete cascade,
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  title           text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create table if not exists workspace_documents (
  id            uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  name          text not null,
  content_type  text not null,
  source_kind   text not null check (source_kind in ('upload', 'artifact', 'note')),
  summary       text,
  content_text  text not null,
  created_at    timestamptz default now()
);

create table if not exists workspace_chunks (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  document_id  uuid not null references workspace_documents(id) on delete cascade,
  source_kind  text not null,
  source_label text not null,
  chunk_index  integer not null,
  content      text not null,
  created_at   timestamptz default now()
);

create table if not exists workspace_artifacts (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  name          text not null,
  mime_type     text not null,
  content       text not null,
  bytes         integer not null,
  created_at    timestamptz default now()
);

create index if not exists workspaces_session_id_updated_at_idx
  on workspaces(session_id, updated_at desc);
create index if not exists conversation_workspaces_workspace_id_updated_at_idx
  on conversation_workspaces(workspace_id, updated_at desc);
create index if not exists workspace_documents_workspace_id_created_at_idx
  on workspace_documents(workspace_id, created_at desc);
create index if not exists workspace_chunks_workspace_id_created_at_idx
  on workspace_chunks(workspace_id, created_at desc);
create index if not exists workspace_artifacts_workspace_id_created_at_idx
  on workspace_artifacts(workspace_id, created_at desc);

insert into workspaces (session_id, name, description)
select distinct c.session_id, 'General workspace', 'Imported workspace for legacy Jarvis chat history.'
from conversations c
where not exists (
  select 1
  from workspaces w
  where w.session_id = c.session_id
)
on conflict do nothing;

insert into conversation_workspaces (conversation_id, workspace_id, title)
select c.id, w.id, 'Imported chat'
from conversations c
join lateral (
  select id
  from workspaces
  where session_id = c.session_id
  order by
    case when name = 'General workspace' then 0 else 1 end,
    created_at asc
  limit 1
) w on true
left join conversation_workspaces cw on cw.conversation_id = c.id
where cw.conversation_id is null
on conflict (conversation_id) do nothing;

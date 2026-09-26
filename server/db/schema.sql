-- ============================================================
-- Схема базы SkyDental RAG. Идемпотентна: можно применять повторно
-- (npm run db:migrate). Работает и в Neon, и во встроенном PGlite.
-- ============================================================

create extension if not exists vector;

-- Документы базы знаний. Источник правды — эта таблица;
-- content/rag/*.md — только начальные данные (npm run seed).
create table if not exists documents (
  id          serial primary key,
  locale      text not null check (locale in ('ru', 'uz')),
  slug        text not null,
  title       text not null,
  body_md     text not null,
  is_price    boolean not null default false,
  version     int not null default 1,
  updated_at  timestamptz not null default now(),
  unique (locale, slug)
);

-- История версий: каждое сохранение в админке — новая строка.
create table if not exists document_versions (
  document_id int not null references documents(id) on delete cascade,
  version     int not null,
  body_md     text not null,
  note        text,
  created_at  timestamptz not null default now(),
  primary key (document_id, version)
);

-- Куски документов с векторами. search_stems — основы слов
-- (shared/text.ts) для ключевого плеча гибридного поиска.
create table if not exists chunks (
  id            serial primary key,
  document_id   int not null references documents(id) on delete cascade,
  ord           int not null,
  locale        text not null,
  heading       text not null default '',
  source_label  text not null,
  text          text not null,
  search_stems  text not null,
  tsv           tsvector generated always as (to_tsvector('simple', search_stems)) stored,
  embedding     vector(768),
  embed_model   text,
  content_hash  text not null,
  unique (document_id, ord)
);
create index if not exists chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops);
create index if not exists chunks_tsv_idx on chunks using gin (tsv);

-- Трасса каждого ответа: вопрос, что нашёл поиск, какая модель
-- ответила и с какой попытки. По ней админка объясняет каждый 👎.
create table if not exists chat_traces (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  locale              text not null,
  mode                text not null default 'rag',
  question            text not null,
  condensed_question  text,
  retrieval           jsonb,
  answer              text not null default '',
  found               boolean not null,
  refusal             jsonb,
  provider            text,
  model               text,
  attempts            jsonb not null default '[]',
  timings             jsonb not null default '{}',
  usage               jsonb,
  ip_hash             text
);
create index if not exists chat_traces_created_idx on chat_traces (created_at desc);

-- Вид ответа: kb | general | missing | offtopic | smalltalk (см. AnswerKind).
alter table chat_traces add column if not exists answer_kind text;

-- Ремонт: ранние трассы на postgres.js записали JSON дважды
-- закодированным — строкой вместо объекта. Разворачиваем обратно.
update chat_traces set retrieval = (retrieval #>> '{}')::jsonb where jsonb_typeof(retrieval) = 'string';
update chat_traces set refusal = (refusal #>> '{}')::jsonb where jsonb_typeof(refusal) = 'string';
update chat_traces set attempts = (attempts #>> '{}')::jsonb where jsonb_typeof(attempts) = 'string';
update chat_traces set timings = (timings #>> '{}')::jsonb where jsonb_typeof(timings) = 'string';
update chat_traces set usage = (usage #>> '{}')::jsonb where jsonb_typeof(usage) = 'string';

-- Отзыв на ответ. Один на трассу: повторный клик меняет оценку.
create table if not exists feedback (
  trace_id    uuid primary key references chat_traces(id) on delete cascade,
  rating      text not null check (rating in ('up', 'down')),
  comment     text,
  created_at  timestamptz not null default now()
);

-- Ограничение частоты запросов: счётчик в окне на хеш IP.
create table if not exists rate_limits (
  key           text primary key,
  window_start  timestamptz not null,
  count         int not null
);

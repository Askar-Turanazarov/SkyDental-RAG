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

-- ============================================================
-- Google Drive как источник документов (server/rag/sync.ts).
-- source: 'local' — документ из seed/админки, 'drive' — из папки
-- Drive; такие правятся только в Drive, админка их лишь показывает.
-- drive_modified_at — modifiedTime файла как его отдал Drive (текст,
-- сравнивается один в один): совпал — файл не скачиваем.
-- ============================================================
alter table documents add column if not exists source text not null default 'local';
alter table documents add column if not exists drive_file_id text;
alter table documents add column if not exists drive_modified_at text;
alter table documents add column if not exists drive_url text;

-- Одна строка: когда Drive проверяли последний раз. Условный update
-- по ней — «замок» между serverless-инстансами: за интервал Drive
-- проверяет только один запрос.
create table if not exists sync_state (
  id          int primary key check (id = 1),
  checked_at  timestamptz not null
);
insert into sync_state (id, checked_at) values (1, 'epoch') on conflict do nothing;

-- Журнал синхронизации: только реальные изменения и ошибки.
create table if not exists sync_log (
  id               serial primary key,
  created_at       timestamptz not null default now(),
  trigger          text not null,
  locale           text,
  slug             text,
  file_name        text,
  action           text not null check (action in ('linked', 'added', 'updated', 'removed', 'error')),
  version          int,
  lines_added      int,
  lines_removed    int,
  chunks_embedded  int,
  chunks_total     int,
  message          text
);
create index if not exists sync_log_created_idx on sync_log (created_at desc);

-- ============================================================
-- Запись на приём (server/booking/).
-- Врачи и их график приходят из doctors.xlsx в корне папки Drive.
-- Врач, пропавший из таблицы, не удаляется (на него могут быть
-- записи), а помечается active = false.
-- hours: {"1": [["09:00", "14:00"]], …} — день недели ISO → смены.
-- ============================================================
create table if not exists doctors (
  id            text primary key,
  sort          int not null default 0,
  name_ru       text not null,
  name_uz       text not null,
  specialty_ru  text not null,
  specialty_uz  text not null,
  service       text not null,
  hours         jsonb not null default '{}',
  bio_ru        text not null default '',
  bio_uz        text not null default '',
  active        boolean not null default true,
  updated_at    timestamptz not null default now()
);

-- Записи пациентов. Первичный приём: ends_at = starts_at + 1 час.
-- Отменённая запись остаётся в таблице (status = 'cancelled') и
-- освобождает окно.
create table if not exists appointments (
  id             serial primary key,
  code           text not null unique,
  doctor_id      text not null references doctors(id),
  service        text not null,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  patient_name   text not null,
  patient_phone  text not null,
  comment        text,
  locale         text not null,
  source         text not null default 'site' check (source in ('site', 'chat')),
  status         text not null default 'booked' check (status in ('booked', 'cancelled')),
  created_at     timestamptz not null default now(),
  cancelled_at   timestamptz,
  ip_hash        text
);

-- Отправка в Google Таблицу: «замок», чтобы две функции не дописали
-- одну запись дважды, и итог последней попытки для админки.
create table if not exists sheet_state (
  id            int primary key check (id = 1),
  locked_until  timestamptz not null,
  last_ok_at    timestamptz,
  last_error    text
);
insert into sheet_state (id, locked_until) values (1, 'epoch') on conflict do nothing;
-- Защита от двойной записи: у врача на одно время — одна активная
-- запись. Держит сама база, даже при одновременных запросах.
create unique index if not exists appointments_slot_uniq on appointments (doctor_id, starts_at) where status = 'booked';
create index if not exists appointments_starts_idx on appointments (starts_at);

-- Копия в Google Таблице: запись ждёт отправки, пока sheet_synced_at
-- пуст или раньше changed_at (запись создали или отменили после неё).
alter table appointments add column if not exists changed_at timestamptz not null default now();
alter table appointments add column if not exists sheet_synced_at timestamptz;

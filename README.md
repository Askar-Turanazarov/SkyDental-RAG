# SkyDental — a RAG support assistant for a dental clinic

**English** · [Oʻzbekcha](README.uz.md) · [Русский](README.ru.md)

A course project about **Retrieval-Augmented Generation (RAG)**. It is the landing page of a dental
clinic in Tashkent (Russian and Uzbek), with a chat assistant that answers **only from the clinic's
knowledge base**. The chat shows every step of how it found an answer: which fragments it
retrieved and with what scores, which of them went into the prompt, which model answered, and
whether it had to fall back to another model.

| Layer | What is used |
| --- | --- |
| Frontend | Vite 7, React 19 and TypeScript; RU and UZ; light and dark themes; no external images or web fonts |
| Backend | Node and TypeScript on [Hono](https://hono.dev), deployed as one Vercel function (`/api/*`) |
| Database | Postgres with pgvector: [Neon](https://neon.tech) in production, embedded [PGlite](https://pglite.dev) locally (no Docker or cloud needed) |
| LLM | A provider layer with an automatic fallback chain. Gemini by default, **light models only** (Flash-Lite and Flash with minimal reasoning). OpenAI, OpenRouter, Groq, DeepSeek, Anthropic and Ollama each need one env variable |
| Admin panel | Feedback and traces, knowledge gaps, stats, a knowledge-base editor with versions and export, model status, a retrieval sandbox, bookings |
| Online booking | A form with free slots, double-booking protection in the database, a copy in Google Sheets, and slot suggestions from the assistant |
| Eval | 35 golden questions; hit@k, MRR and refusal accuracy; threshold tuning; an optional LLM judge |

## Contents

- [What RAG looks like in the chat](#what-rag-looks-like-in-the-chat)
- [How the pipeline works](#how-the-pipeline-works)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [LLM providers and fallback](#llm-providers-and-fallback)
- [Admin panel](#admin-panel)
- [Eval](#eval)
- [Deploying to Vercel and Neon](#deploying-to-vercel-and-neon)
- [Project structure](#project-structure)
- [Knowledge base](#knowledge-base)
- [Online booking](#online-booking)
- [Clinic data](#clinic-data)
- [Design and motion](#design-and-motion)

## What RAG looks like in the chat

Ask *"How much is a dental implant?"*. The answer arrives token by token with numbered citations
`[1]`, `[2]`. Clicking a citation shows the quoted fragment and its source.

Every answer has a **"How I found the answer"** panel:

| What you see | What it means |
| --- | --- |
| The original and the rewritten question | Follow-ups like *"and how much is it?"* are rewritten into standalone questions before the search |
| Top-k fragments with vector, text and RRF scores, plus an "in prompt" mark | Hybrid search by meaning and by keywords, merged with Reciprocal Rank Fusion |
| Similarity threshold and best match | Below the threshold no fragment reaches the prompt, so the model cannot quote a price it did not find |
| Model, fallback attempts, timings, tokens | Which model answered, and what happened before it did |

**Student mode** (the toggle in the chat header) opens the full trace and adds a button: *"Ask
the same model without the knowledge base"*. The second answer appears under the first so you can
compare them. Without RAG, the model usually makes up prices.

Refusals come with the reason, for example: *"Best match 0.41 is below the threshold 0.60: there
is no suitable fragment in the base."*

👍 and 👎 feedback, with an optional comment after 👎, is saved to the database. It appears in the
admin panel next to the full trace of that answer.

## How the pipeline works

```mermaid
flowchart LR
  Q([Question + history]) --> C[Condense:<br/>follow-up → standalone]
  C --> E[Embed the question]
  E --> V[(pgvector:<br/>cosine, top 20)]
  C --> K[(Full-text search:<br/>top 20)]
  V --> R[RRF merge → top K]
  K --> R
  R --> T{Best score ≥<br/>RAG_MIN_SCORE?}
  T -- no --> X[Prompt without<br/>fragments]
  T -- yes --> P[Prompt with<br/>numbered fragments]
  X --> L
  P --> L[LLM chain<br/>with fallback]
  L --> S([SSE: retrieval → token… → done])
```

1. **Indexing** (`server/rag/ingest.ts`). `shared/chunker.ts` cuts markdown documents into
   chunks. One `## section` becomes one chunk, and so does one table row, so that each price line
   can be found on its own. Each chunk gets a hash of *embedding model + text*. When a document is
   saved, only chunks with a new hash are re-embedded. Fix one price and one vector is
   recalculated, not the whole price list. Embeddings come from `gemini-embedding-001`, 768
   dimensions.
2. **Condensing** (`server/rag/answer.ts`). When there is a chat history, a light model rewrites a
   follow-up into a standalone question. The search and the prompt use the rewritten question, and
   the trace shows both versions.
3. **Hybrid retrieval** (`server/rag/retrieve.ts`). One SQL query covers both languages. It runs a
   vector search (cosine, top 20) and a Postgres full-text search on word stems (top 20), then
   merges them with RRF (k = 60). RRF adds up ranks rather than raw scores, because the two
   searches use different scales. A question in Uzbek can find a Russian fragment. Two small
   bonuses break ties: fragments in the question's language, and price documents when the question
   is about prices.
4. **Threshold.** Fragments go into the prompt only if the best cosine similarity reaches
   `RAG_MIN_SCORE`. Below it the model still answers, but without fragments, so it can greet,
   steer back to dentistry or say that the clinic's materials have no exact data. The offline
   `local` model has nothing to answer with, so it refuses and names both numbers.
5. **Prompt** (`server/rag/prompt.ts`). One system prompt in the user's language: a polite dental
   consultant. Clinic facts (prices, terms, schedule, address) come only from the numbered
   fragments with `[n]` citations. Typical dental questions may get a short general answer; symptoms
   get no diagnosis, just a referral to a doctor. Fragments, history and the question are wrapped
   in `<context>` / `<question>` and treated as data, not instructions. The last 4 turns of the
   dialog go along. The first line of the reply is a kind tag, `[[kb]]`, `[[general]]`,
   `[[missing]]`, `[[offtopic]]` or `[[smalltalk]]`. The server strips it, shows a badge in the chat
   and stores the kind in the trace.
6. **Generation** goes through the model chain (`server/llm/chain.ts`) and is streamed.
7. **Protocol** (`shared/protocol.ts`). The chat receives Server-Sent Events: `retrieval`, then
   `token` events, then `done`, which carries the trace id, sources, model, attempts, timings and
   token usage. An `error` event replaces `done` on failure.
8. **Traces.** Every question is stored in `chat_traces` and every rating in `feedback`. IP
   addresses are never stored. The rate limiter keeps only a salted hash.

## Quick start

You need Node.js 22 or newer.

```bash
npm install
cp .env.example .env
```

There are three ways to run the project.

### A. Demo in the browser, no server

Set `VITE_RAG_ENDPOINT=` (empty) in `.env` and run `npm run dev:web`. The chat answers in the
browser from the same markdown files, using simple word matching. It emits the same events and
shows the same trace, with a "Demo mode" badge.

### B. Full stack, offline, no keys

Put this in `.env`:

```ini
LLM_CHAIN=local:extractive
EMBED_PROVIDER=local
EMBED_MODEL=hash-768
RAG_MIN_SCORE=0.15
ADMIN_PASSWORD=admin
```

Then index the knowledge base and start the site and the API:

```bash
npm run seed
npm run dev
```

The site runs at http://localhost:5173, the API at http://localhost:8787 (Vite proxies `/api`
there), and the admin panel at http://localhost:5173/admin.html. The `local` provider answers with
the best-matching fragment, and `hash-768` is a toy embedding. This mode is good for working on the
interface, but not for judging answer quality.

### C. With Gemini

Get a key in [Google AI Studio](https://aistudio.google.com/apikey) and set `GEMINI_API_KEY` in
`.env`. Keep the default `LLM_CHAIN` and `EMBED_*`, then:

```bash
npm run seed
npm run dev
```

> **PGlite runs in a single process.** Stop `npm run dev` before running `npm run seed` or
> `npm run eval` against the local database. Neon has no such limit.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite and the API together (`dev:web` and `dev:api` run them separately) |
| `npm run build` | Type-checks the frontend and the server, then builds into `dist/` |
| `npm run db:migrate` | Applies `server/db/schema.sql` to the database in `DATABASE_URL` |
| `npm run seed` | Loads `content/drive/{ru,uz}/*.docx` and `schedule.xlsx` into the database and indexes them. Documents already in the database are left alone. When Google Drive is connected, it then syncs the database with the folder |
| `npm run export:office` | Exports the current database documents to `content/drive/` (Word and Excel) and checks that they read back without loss |
| `npm run seed -- --force` | Overwrites documents with the markdown files. Each overwrite becomes a new version, and the old ones stay in the history |
| `npm run seed -- --reindex` | Rebuilds the index of all documents, for example after changing `EMBED_MODEL` |
| `npm run eval` | Retrieval metrics on the golden set. See [Eval](#eval) |

## Environment variables

Everything is described in [`.env.example`](.env.example). The main variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_RAG_ENDPOINT` | `/api/chat` | Where the chat sends questions. Empty means demo mode in the browser. Read at **build** time |
| `DATABASE_URL` | empty | Neon connection string (pooled). Empty means PGlite in `.data/`, which works only locally |
| `GEMINI_API_KEY` and other `*_API_KEY` | empty | A provider is connected only when its key is set |
| `OLLAMA_BASE_URL` | empty | A local Ollama server, e.g. `http://localhost:11434/v1` |
| `LLM_CHAIN` | Gemini Flash-Lite → Flash-Lite → Flash | The model chain in priority order, `provider:model,provider:model` |
| `GEMINI_THINKING_LEVEL` | `minimal` | Reasoning level for Gemini 3: `minimal`, `low` or `off` |
| `EMBED_PROVIDER`, `EMBED_MODEL` | `gemini`, `gemini-embedding-001` | Embeddings. Changing them requires a reindex |
| `RAG_TOP_K` | `5` | How many fragments go into the prompt |
| `RAG_MIN_SCORE` | `0.6` | Similarity threshold for putting fragments into the prompt. Tune it with `npm run eval` or the admin sandbox |
| `ADMIN_PASSWORD` | empty | Admin password. Empty disables the admin panel |
| `ADMIN_SECRET` | derived | Secret for signing the admin cookie. Generate one: `openssl rand -hex 32` |
| `IP_SALT` | dev value | Salt for hashing IP addresses. Set your own in production |
| `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SEC` | `20`, `600` | Chat questions allowed per IP per window |
| `GOOGLE_DRIVE_FOLDER_ID` | empty | Knowledge base folder in Google Drive. Empty disables sync |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | empty | Google service account JSON key, raw or base64 |
| `DRIVE_SYNC_INTERVAL_SEC` | `20` | The server checks Drive for changed files at most once per this many seconds |
| `GOOGLE_BOOKINGS_SHEET_ID` | empty | Google Sheet for a copy of the bookings: its id or full link. The service account needs **Editor** access |

## LLM providers and fallback

`LLM_CHAIN` lists models in priority order. A request goes to the first available model and moves
down the chain when a model fails:

| What happened | What the chain does |
| --- | --- |
| 429, 5xx, "overloaded", timeout (15 s to the first token) | Tries the next model. The failed one is paused for 60 s, or for as long as `Retry-After` says |
| 401 or 403 | Pauses the whole provider for 10 minutes |
| The provider does not have this model | Pauses the model for an hour. At start-up the chain also checks the provider's model list, cached for an hour |
| 400 or another request error | Returns the error without fallback, because the next model would fail the same way |

Fallback is only possible **before the first token**. If a model starts answering and then breaks
off, the chat gets an error, because gluing one answer together from two models would be wrong.
The pauses are kept in the function's memory. Every attempt goes into the trace (`attempts`), and
the admin panel shows the state of each model and has a **Ping** button.

A chain can mix providers, for example when the Gemini free quota runs out:

```ini
LLM_CHAIN=gemini:gemini-3.5-flash-lite,gemini:gemini-3.5-flash,groq:llama-3.1-8b-instant
```

Model names change often. Check them in the provider's list, and use **Ping** in the admin panel to
test each one.

To see fallback without any keys, use `LLM_CHAIN=local:fail-429,local:extractive`. The first model
always reports overload, the second one answers, and the trace shows both attempts.

To add another OpenAI-compatible provider, add one entry to `server/llm/registry.ts` with the API
address and the variable that holds the key.

## Admin panel

The admin panel is at `/admin.html` locally and at `/admin` on Vercel. It is a separate Vite entry,
so it does not add weight to the landing page. The password comes from `ADMIN_PASSWORD`. The
session is an httpOnly cookie signed with HMAC and valid for 7 days.

| Section | What is there |
| --- | --- |
| Dialogs and feedback | All questions with filters: rated, 👎, 👍, with a comment, unanswered; RAG or no-RAG mode. Click one to open its full trace |
| Knowledge gaps | Questions the bot could not answer, grouped by shared word stems, with an "Add to the base" button |
| Stats | Share of 👍, share of refusals, answers per model, fallbacks, p50 and p95 latency |
| Knowledge base | Documents by language with a live preview of the chunking and version history with diff. Documents from Google Drive are read-only and have an "Open in Google Drive" button. Without Drive, documents are edited right here: saving creates a new version and reindexes only the changed chunks. Export to `.md` or `.zip` |
| Sync | Whether the Drive folder is connected, when it was last checked, a "Check now" button, and the change log: which file, what happened, lines added and removed, chunks re-embedded |
| Models | The chain, each model's state and pause, Ping, embedding state and "Reindex all" |
| Sandbox | Ask a question and see the retrieval and the finished prompt without generating an answer. Handy in class |
| Bookings | Upcoming, past and cancelled bookings with search, cancelling, and the Google Sheet status with a "Send to sheet" button |

## Eval

`eval/golden.json` holds 35 questions: in Russian, in Uzbek, across languages (a question in one
language whose answer is in the other), follow-ups with a history, and questions that are
deliberately outside the knowledge base. Each question lists the expected sources or
`expectRefusal`.

```bash
npm run eval                                      # retrieval only, no answers generated
npm run eval -- --judge                           # also generates answers and has an LLM judge them
npm run eval -- --judge=gemini:gemini-3.5-flash   # the judge is a specific model
```

The report goes to the console and to `eval/report.md`:

- **hit@k**: the share of questions where the expected fragment is among the first k;
- **MRR**: the mean of 1 / rank of the first expected fragment;
- **refusal accuracy**: out-of-base questions refused, in-base questions answered;
- **threshold sweep**: accuracy for every `RAG_MIN_SCORE` from 0 to 1, with a recommended value;
- **judge**: whether the answer follows the fragments (*faithful*) and whether it answers the
  question (*relevant*).

Eval uses the same database and embedding model as the server, so run `npm run seed` first. With
offline `hash-768` embeddings the numbers are only a smoke test. Measure real quality with Gemini.

## Deploying to Vercel and Neon

1. **Neon.** Create a project at [neon.tech](https://neon.tech) and copy the **pooled** connection
   string. The pgvector extension is created by the schema itself.
2. **Schema and data.** Run these once from your machine:

   ```bash
   DATABASE_URL="postgres://…" npm run db:migrate
   DATABASE_URL="postgres://…" GEMINI_API_KEY=… npm run seed
   ```

   Or put the same values in `.env` and run `npm run db:migrate` and `npm run seed`.
3. **Vercel.** Import the repository. `vercel.json` already sets the Vite build, the output folder
   and the rewrite of `/api/*` into one function (`api/index.ts`, up to 60 s).
4. **Environment variables** go in *Project Settings → Environment Variables*: `DATABASE_URL`,
   `GEMINI_API_KEY`, `VITE_RAG_ENDPOINT=/api/chat`, `ADMIN_PASSWORD`, `ADMIN_SECRET` and
   `IP_SALT`, plus `LLM_CHAIN` and `RAG_MIN_SCORE` if you changed them. `VITE_RAG_ENDPOINT` is
   baked in at build time, so redeploy after changing it.
5. **Check** `https://<project>.vercel.app/api/health`. It shows the database, the number of chunks,
   whether a reindex is needed, the connected providers and the chain state. Then open the chat
   and the admin panel at `/admin`.

On Vercel the schema is not applied automatically. Run `npm run db:migrate` whenever
`schema.sql` changes.

## Project structure

```
api/index.ts            Vercel entry: every /api/* request goes to Hono
server/
├── app.ts              /api/chat (SSE), /api/feedback, /api/health, /api/admin/*
├── dev.ts, env.ts      local API server; env validation (zod)
├── db/                 schema.sql and the client: postgres.js (Neon) or PGlite
├── llm/                providers (gemini, openaiCompat, anthropic, local), registry, fallback chain
├── rag/                ingest, retrieve, prompt, answer: the RAG pipeline
├── admin/              admin routes, auth, zip export
├── drive/              Google Drive: service account sign-in, file listing, Word/Excel → markdown
├── booking/            online booking: doctors, free slots, bookings, Google Sheet copy, slots for the assistant
└── rateLimit.ts
shared/                 code shared by the frontend and the server
├── chunker.ts          markdown → chunks (demo bot, server and admin preview)
├── protocol.ts         request, SSE event and trace types
├── booking.ts          services, doctors, slots, Tashkent time, phone check
└── sse.ts, text.ts     SSE parsing; word stems for keyword search
scripts/                migrate, seed, export-office, eval
eval/golden.json        eval questions
content/drive/{ru,uz}/  knowledge base in Word and Excel: copy of the Drive folder, seed
content/rag/{ru,uz}/    markdown for the in-browser demo bot (no server)
src/
├── components/chat/    ChatWidget, useChat, ragClient, RetrievalTrace, AnswerText, demo bot
├── admin/              admin panel (separate entry admin.html)
├── i18n/               ru.ts, uz.ts: every text on the site
├── styles/, graphics/  tokens, sections, glass; girih pattern, crown, icons
├── theme/              light, dark and auto
└── config.ts           Telegram and map links
```

## Knowledge base

### Source: a Google Drive folder

The documents the bot answers from live in Google Drive. The FAQ, price list, services and
"about" pages are Word files, and the schedule is an Excel sheet:

```
<Drive folder>/
├── doctors.xlsx     doctors and their hours for online booking
├── ru/  prices.docx  faq.docx  services.docx  about.docx  schedule.xlsx
└── uz/  …the same
```

The file name without the extension becomes the document id. Both uploaded `.docx`/`.xlsx` files and
native Google Docs and Sheets work: the server exports the latter to the right format itself.

**How the bot learns about changes.** Before answering, the server checks the folder, but no more
often than once per `DRIVE_SYNC_INTERVAL_SEC` (20 s by default). One Drive request returns every
file's modified time. Only changed files are downloaded, and only chunks whose text actually changed
are re-embedded. An edit in Drive reaches the very next answer. Every change is written to the admin
log (the Sync section). If Drive is unavailable, the bot answers from what is already in the
database, and the error goes to the log too.

### Setup

1. [Google Cloud Console](https://console.cloud.google.com/) → create or pick a project →
   **APIs & Services → Library → Google Drive API → Enable**.
2. **IAM & Admin → Service Accounts → Create service account**. No roles are needed. Then
   **Keys → Add key → JSON** downloads the key file.
3. Create a Drive folder with `ru` and `uz` subfolders and upload the files from `content/drive/`.
4. Share the folder with the service account e-mail (`…@….iam.gserviceaccount.com`) as **Viewer**.
5. In `.env` and in Vercel → Settings → Environment Variables set:
   - `GOOGLE_DRIVE_FOLDER_ID`: the last part of `drive.google.com/drive/folders/<id>`;
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: the JSON key contents on one line (or base64).
6. Run `npm run db:migrate` if the schema is not updated yet, then admin → Sync → Check now.

The service account key is a secret: keep it only in `.env` and in the Vercel settings.

### File format

Word: **Heading 1** is the document title, **Heading 2** is a section (one section, one chunk),
followed by ordinary paragraphs, lists and tables. Each table row becomes a separate chunk, with the
first column in the source label. This matters for the price list: otherwise every position would
stick together into one chunk.

Excel (schedule): the first sheet, and the **sheet name** is the document title. Columns:

| Раздел (section) | Пункт (item) | Значение (value) |
| --- | --- | --- |
| Часы работы и приёма | Понедельник | 09:00–20:00 |
| Часы работы и приёма | | Последняя запись — за час до закрытия… |
| Мессенджеры и соцсети | Telegram | @skydental_uz — запись, вопросы по ценам |

Rows with the same section become one chunk, so all weekdays answer "when are you open" together.
A row with an empty item becomes a plain paragraph.

### Without Drive

If `GOOGLE_DRIVE_FOLDER_ID` is not set, everything works as before: `npm run seed` loads the files
from `content/drive/`, and documents are edited in the admin panel. `npm run export:office` exports
the current database back to Word and Excel, for example to fill the Drive folder the first time.
`content/rag/*.md` are only used by the demo bot that runs in the browser without a server.

The phone, house number and floor in the schedule are the same `__` placeholders as on the site, so
the bot never gives a number that isn't on the page.

## Online booking

A patient picks a service, a doctor, a day and a free hour in the form in the Contacts section, then
leaves a name and a phone number. A first visit lasts one hour. Booking is open 14 days ahead, and
the earliest slot starts at least an hour from now (Tashkent time, UTC+5).

| Part | How it works |
| --- | --- |
| Doctors and hours | The `doctors.xlsx` table in the root of the Drive folder: code, name and specialty in both languages, service, bio and hours for each weekday (`09:00–14:00`; several shifts separated by commas; empty or `выходной` for a day off). It syncs like the other documents, and the bot also learns about the doctors from it. A doctor removed from the table stops taking bookings, but their existing bookings stay |
| No double booking | The database guarantees it with a unique index on doctor and time for active bookings. If two patients press the button at the same moment, one gets the booking and the other sees "this time was just taken", and the form reloads the free slots |
| Abuse limits | 5 bookings per hour from one IP, at most 3 upcoming bookings per phone number, and a hidden honeypot field |
| Google Sheet | Every booking and cancellation is copied to the «Записи» tab of a Google Sheet for the administrator. The database stays the source of truth. If Google does not respond, the row is sent with the next booking or with the button in the admin panel. Rows are found by booking number and updated in place, so retries never create duplicates |
| The assistant | When a question is about booking or free time, the server adds the free slots of the relevant doctors to the prompt: only doctors and times, never patient data. The assistant suggests 2–3 slots, and buttons appear under the answer. One click closes the chat and opens the form with the doctor and the time already chosen. The assistant never books by itself and never asks for a name or phone number in the chat. A slot the model makes up never becomes a button, because the server checks every one against the real free slots |
| Admin panel | The Bookings section: upcoming, past and cancelled bookings, search by number, name or phone, cancelling (the slot becomes free again) and the Google Sheet status |

**Connecting the Google Sheet**

1. In the same Google Cloud project: **APIs & Services → Library → Google Sheets API → Enable**.
2. Create an empty Google Sheet anywhere (for example, next to the knowledge base) and share it with
   the service account e-mail as **Editor**. The «Записи» tab and its header are created
   automatically.
3. Put the link or the id of the sheet into `GOOGLE_BOOKINGS_SHEET_ID` (in `.env` and in Vercel),
   run `npm run db:migrate` and redeploy.
4. Admin panel → Bookings shows whether the sheet is connected and how many rows are waiting.

Without the sheet, booking still works: bookings are stored in the database and shown in the admin
panel. Without a backend (the demo mode) the form shows a link to the clinic's Telegram instead.

## Clinic data

Texts, prices, the phone number and the address live in `src/i18n/ru.ts` and `src/i18n/uz.ts`.
Change both files. If a key is added to one dictionary and forgotten in the other, `npm run build`
fails, so an untranslated text never reaches the site.

| What | Where |
| --- | --- |
| Telegram link, map link | `src/config.ts` |
| SEO: address, phone, hours | the JSON-LD block and meta tags in `index.html` |
| Answers of the chat bot | the knowledge base folder in Google Drive (without Drive, the admin panel) |

> All numbers are currently **placeholders**: prices, the opening year and the rating. Replace them
> with real ones before publishing.

Three fields are deliberately left without plausible-looking values, so nobody mistakes them for
real ones. On the site they have a dashed underline and a "demo data" hint:

| Field | Dictionary key | What to do |
| --- | --- | --- |
| End of the address | `contacts.address` | put the house and floor instead of `__` |
| Phone | `contacts.phone` and `contacts.phoneHref` | the visible number and the digits for `tel:` |
| License number | `footer.license` | the number instead of `__-____` |

While `phoneHref` is empty, `components/PhoneLink.tsx` shows the phone as **text, not a link**,
because `tel:` would lead nowhere. Once the digits are there, all four places turn into links by
themselves.

**Booking form.** How booking works and how to connect the Google Sheet is described in
[Online booking](#online-booking).

## Design and motion

The design follows the Apple Human Interface Guidelines, translated to the web
([apple-design](https://github.com/dickwu/apple-design-skill) skill):

- **Palette.** Cobalt and turquoise from Uzbek glazed majolica. A tile glaze and dental porcelain
  are essentially the same material. Contrast is calculated to WCAG from the actual hex values: body
  text 17.4:1, secondary text and accent 5.9:1. Turquoise (3.1:1) is used only in graphics.
- **Glass** only on the functional layer: the header and the chat panel. Content cards are
  solid.
- **Theme.** Auto (follows the system), light or dark. The choice is saved in `localStorage` and
  applied before the first paint, so there is no flash.
- **Girih pattern** under the whole page. It is at full strength under the hero and becomes a light
  texture further down. The tiles move at 0.15 of the scroll speed, which gives a far parallax
  plane (scroll-driven animations).
- **Motion.** Segmented controls have a sliding thumb on a spring (`linear()`). A new theme opens
  as a circle from the button (View Transitions). FAQ answers open and close by height
  (`interpolate-size`). The header settles during the first 96 px of scrolling. Hero lines and
  section cards appear one after another. The chat grows out of its button on a spring.
- **Accessibility.** The site respects reduce motion, reduce transparency and increase contrast.
  Tap targets are at least 44 px, keyboard focus is visible, and the chat is a modal with a focus
  trap that closes on `Esc`.

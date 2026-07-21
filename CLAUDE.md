# RP2 — Ross Projective

RP2 is the backend + web platform for the online arm of the Ross Mathematics
Program. The name plays on "projective Ross" being "on line" — the real
projective plane ℝℙ² is built from lines through the origin, so "on line" is
literally what its points are.

Authoritative program context lives in `planning/*.txt` (converted from the source
PDFs). Read those before making product decisions — they describe the pilot's
scope, timeline, courses, staffing model, and the application questions verbatim.

## Program shape (short version)

- **Pilot term:** ten weeks, Sep 28 – Dec 11, 2026, one-week Thanksgiving break.
- **Format:** one 90-min live Zoom session + one 60-min office hour per week per
  course. Ross-style problem sets outside class.
- **Courses (candidates):** point-set topology, geometric group theory,
  combinatorial game theory, quadratic forms; plus alternates on the application
  form (Lean, voting theory, graph theory, cryptography, Galois theory).
- **Staffing:** graduate-student mentors lead sections; course assistants grade
  and monitor breakouts. Blaze manages staff. Jim handles the server.
- **Community:** moderated Discord server; Gradescope for submissions.
- **Tuition:** ~$1,500 working figure. Need-blind, need-based aid up to full
  scholarship.

Students are minors, so youth-safety, parent/guardian contact, and clean removal
workflows are first-class concerns, not afterthoughts.

## Current focus

**The application portal is priority #1.** Everything else (payments, Zoom
provisioning, Discord role sync, Gradescope wiring, attendance) is downstream and
should not be built until the application flow works end-to-end for applicants
and admin reviewers.

Concretely, "done" for the first milestone means:

1. An applicant can create an account, fill out the application in
   `planning/Student Application.txt` across multiple sessions (draft save),
   upload a transcript and optional financial-aid documents, and submit.
2. Admin can log in, see a sortable/filterable table of applications, open an
   individual application, view all responses and uploaded files, and record
   review notes + a decision (accept / waitlist / reject / hold).
3. Applicant sees a status page after submission.

Sending offer letters, collecting payment, and enrollment flows come *after* this
lands. Do not scaffold Stripe/Zoom/Discord integrations until the review flow is
usable.

## Architecture

Single-server deployment, single SQLite database, S3 for blobs. This is the right
scale for a pilot with (at most) low-thousands of applicants. Do not introduce
Postgres, Redis, queues, or Kubernetes without a concrete reason.

```
┌────────────────────┐        ┌──────────────────────────────┐
│  React SPA (Vite)  │  ─────▶│  Backend service (Node/TS)   │
│  served as static  │  HTTPS │  Fastify + better-sqlite3    │
│  assets by backend │        │  Sessions in signed cookies  │
└────────────────────┘        └──────┬───────────────┬───────┘
                                     │               │
                              SQLite (WAL)      S3 (transcripts,
                              on EBS volume     aid docs, backups
                              + Litestream ──▶  via Litestream)
                                     │
                     ┌───────────────┴────────────┐
                     │ External integrations       │
                     │  - Stripe (payments)        │
                     │  - Zoom API (meetings)      │
                     │  - Discord bot (roles)      │
                     │  - SES / Postmark (email)   │
                     └────────────────────────────┘
```

Reverse proxy: Caddy in front of the backend for automatic TLS. The Node process
never sees port 80/443 directly.

### Proposed stack

Pick these unless there's a reason not to; document any deviation.

- **Backend:** Node.js 20+, TypeScript strict mode, Fastify (or Hono).
- **DB:** SQLite via `better-sqlite3` (synchronous, simple).
- **Query layer + migrations:** Drizzle ORM with `drizzle-kit` for migration
  generation. Schema lives in `backend/src/db/schema.ts`; generated migrations
  in `backend/migrations/`. Avoid raw SQL sprinkled across handlers — use the
  Drizzle query builder or a typed query in `backend/src/db/queries/`.
- **Auth:** passwordless magic-link email (works for minors without OAuth).
  Signed session cookies (`@fastify/secure-session` or equivalent).
- **Validation:** Zod at every trust boundary (HTTP handlers, webhooks, form
  submissions). Share Zod schemas between frontend and backend.
- **Frontend:** React 18+, Vite, TanStack Router or React Router, TanStack Query
  for server state. No global Redux-style store — server state belongs in the
  query cache.
- **Forms:** React Hook Form + Zod resolver.
- **File uploads:** presigned S3 PUT URLs; browser uploads directly to S3, then
  posts the object key back.
- **Email:** SES or Postmark; templated with MJML or plain HTML strings — avoid
  a full templating framework for the pilot.
- **Testing:** Vitest for unit; Playwright for the applicant+admin flows.

## Repo layout

Monorepo, pnpm workspaces. Shared Zod schemas live in `shared/` so both sides
type-check against the same source of truth.

```
rp1/
├── backend/
│   ├── src/
│   │   ├── routes/           # HTTP handlers, thin
│   │   ├── services/         # Business logic
│   │   ├── db/               # schema.ts, queries, migrations runner
│   │   ├── integrations/     # stripe/, zoom/, discord/, s3/, email/
│   │   ├── auth/             # session, magic-link
│   │   └── server.ts
│   ├── migrations/
│   └── test/
├── frontend/
│   ├── src/
│   │   ├── routes/
│   │   ├── features/         # applicant/, admin/, staff/
│   │   ├── components/       # shared UI primitives
│   │   └── api/              # generated or hand-written client
│   └── index.html
├── shared/
│   └── src/                  # Zod schemas, shared types, constants
├── planning/                 # Source-of-truth product docs
├── ops/
│   ├── caddy/
│   ├── systemd/
│   └── litestream/
└── CLAUDE.md
```

## Domain model

### Actors

Every human has a single `user` record with an email. Roles are additive — a
person can be both an admin and a mentor, or a parent linked to a student.

- **applicant** — submitted (or is drafting) an application; not yet decided.
- **participant** (student) — accepted, enrolled, minor.
- **guardian** — parent/guardian tied to a participant; receives billing and
  program comms.
- **mentor** — grad-student staff leading a section.
- **assistant** — course assistant (grading, breakout monitoring).
- **admin** — ops (Jim, and anyone he delegates to).

Model roles as rows in a `user_role` join table, not columns on `user`.

### Core entities (application-portal slice)

The first migration only needs to cover these:

- `user` — id, email, created_at, last_login_at.
- `user_role` — user_id, role, granted_at.
- `magic_link_token` — token, user_id, expires_at, used_at.
- `session` — id, user_id, created_at, expires_at, user_agent, ip.
- `applicant_profile` — user_id, legal_name, preferred_name, dob, grade_level,
  school, city/state/country, timezone.
- `guardian_contact` — applicant_user_id, name, email, phone, relationship.
  (Not a `user` yet — becomes one at enrollment if we need portal access.)
- `application` — id, applicant_user_id, status (`draft` | `submitted` |
  `under_review` | `accepted` | `waitlisted` | `rejected` | `withdrawn`),
  submitted_at, decision_at, decision_by, decision_notes.
- `application_response` — application_id, question_key, value (JSON).
  Store each answer keyed by a stable identifier (e.g. `math_stuck_story`,
  `participation_style`) so the question set can evolve without schema churn.
- `application_availability` — application_id, weekday, start_min, end_min
  (in the applicant's stated timezone; normalize on read).
- `application_course_preference` — application_id, course_key, rank.
- `application_file` — application_id, kind (`transcript` | `aid_doc` | other),
  s3_key, filename, content_type, size, uploaded_at.
- `application_review` — application_id, reviewer_user_id, notes, score,
  reviewed_at. Multiple reviews per application are allowed.

Later entities (do not build yet, but keep the shape in mind so we don't paint
ourselves into corners):

- `course`, `section` (a course offered at a specific weekly time), `cohort`
  (breakout group within a section), `enrollment` (student ↔ section, with
  status: `offered` / `confirmed` / `withdrawn`).
- `offer` — the actual acceptance letter payload sent to a family.
- `financial_aid_decision` — tied to `application`.
- `payment` — Stripe payment intent, amount, status.
- `zoom_meeting` — section_id, zoom_meeting_id, join_url, host_key.
- `discord_link` — user_id, discord_user_id, verified_at.
- `attendance` — enrollment_id, session_date, present.

### Application questions

The exact question set is in `planning/Student Application.txt`. Model them as a
declarative array (in `shared/`) with `{ key, section, prompt, type, options?,
required }` so the applicant UI and the admin review UI render from the same
definition and answers persist under stable keys.

Sections in the current draft:
1. Student information (name, DOB, grade, school, location, timezone,
   availability grid, prior Ross history, "tell us about yourself").
2. Parent/guardian information.
3. Mathematical background and course preferences (ranked).
4. Mathematical reflections (four free-response prompts + participation style).
5. Financial aid (level + optional documentation upload).
6. Signatures (student + guardian).

Any change to the question set is a product decision — flag it, don't silently
add/remove.

## External integrations

Every integration goes in `backend/src/integrations/<name>/` behind a
narrow interface. Handlers never talk to Stripe/Zoom/Discord SDKs directly.

### Stripe
- Payment Intents for tuition. Financial aid = discount coupon or reduced-price
  intent; the family always transacts through Stripe so the audit trail is
  uniform.
- Webhook endpoint verifies signature, records the event, then applies state
  changes idempotently keyed on the event id.
- Never mutate enrollment state from the client's "success" callback — trust
  only the webhook.

### Zoom
- Server-to-server OAuth app. One recurring meeting per `section`. Store the
  meeting id; regenerate join URLs only when necessary.
- Consider Zoom's "waiting room" + registration for the minor-safety story.

### Discord
- One server for the program. Bot with OAuth2 for account linking.
- On enrollment confirmation: assign the course/section role. On withdrawal or
  removal: strip roles (and optionally kick).
- Store the Discord user id on `discord_link` once verified.

### S3
- Buckets: `rp2-uploads-<env>` (applicant files), `rp2-backups-<env>`
  (Litestream target). Private, no public ACLs.
- Uploads use presigned PUTs so binary data never touches the app server.
- Downloads for admin review use short-lived presigned GETs.

### Email
- Transactional only in the pilot: magic links, application receipts, offer
  letters, payment receipts, class reminders. No marketing.
- SES with a verified sender domain; SPF/DKIM/DMARC set up before launch.

## Auth model

- Passwordless magic link is the default for everyone.
- Sessions are HTTP-only, `Secure`, `SameSite=Lax` signed cookies. Rotate
  session id on login.
- Authorization is role-based at the route level; admins can impersonate for
  support (log the impersonation).
- Guardians receive their own magic-link path for signing / payment steps even
  before they have a full account.

## Deployment

- Single EC2 instance (t3/t4g medium is plenty for the pilot).
- SQLite database file on an EBS volume, WAL mode, `synchronous = NORMAL`.
- **Litestream** replicating the SQLite file to S3 continuously. Test restore
  before we open applications.
- Caddy handles TLS via Let's Encrypt. Backend listens on 127.0.0.1:xxxx.
- systemd unit supervises the Node process, restart on failure.
- Static frontend built by Vite and served by the backend (or Caddy directly).
- Config via env vars, loaded through a Zod-validated `env.ts`. No config file
  checked in with real secrets.

## Conventions

- **TypeScript strict everywhere.** No `any` without a comment explaining why.
- **Zod at every trust boundary.** Parse, don't validate — the parsed value is
  the type you use downstream.
- **Thin handlers, fat services.** Route handlers do auth + input parsing +
  calling a service + serializing the response. Business logic lives in
  `services/`.
- **Migrations are additive and versioned.** Never edit an existing migration
  after it's been applied to any environment.
- **All timestamps are stored as UTC ISO-8601 strings** (or unix seconds for
  short-lived tokens). Timezone conversion happens at the edges.
- **All money is integer cents** in a single currency (USD) for the pilot.
- **PII lives in the DB, not in logs.** Structured logs; scrub emails / names.
- **Youth-safety first.** Any feature that puts minors in contact with adults
  needs an explicit review checklist (recording, moderation, reporting path).

## Testing & verification

- Unit-test services and pure logic in Vitest.
- The application submission flow and the admin review flow each get a
  Playwright test — those are the two flows we cannot afford to break.
- Integration boundaries (Stripe webhook, Zoom API, Discord bot) get thin
  fakes in tests; run against sandbox/test-mode credentials in a staging
  environment, not from local dev.

## Out of scope (for now)

Do not build any of the following until the application portal ships:

- Payment collection / Stripe integration
- Zoom meeting provisioning
- Discord role sync
- Gradescope integration
- Attendance tracking
- Course pages / student dashboard
- Mentor-facing tooling
- Public marketing site (a separate concern from this app)

If a task seems to require one of these, stop and confirm scope before writing
code.

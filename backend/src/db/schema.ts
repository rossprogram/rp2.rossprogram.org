import {
  sqliteTable,
  text,
  integer,
  index,
  primaryKey,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const nowSql = sql`(CAST(strftime('%s', 'now') AS INTEGER))`;

export const user = sqliteTable(
  'user',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    dob: text('dob'),
    createdAt: integer('created_at').notNull().default(nowSql),
    lastLoginAt: integer('last_login_at'),
  },
  (t) => ({
    emailIdx: index('user_email_idx').on(t.email),
  }),
);

export const userRole = sqliteTable(
  'user_role',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role', {
      enum: ['applicant', 'admin', 'mentor', 'assistant', 'guardian', 'participant'],
    }).notNull(),
    grantedAt: integer('granted_at').notNull().default(nowSql),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.role] }),
  }),
);

export const magicLinkToken = sqliteTable(
  'magic_link_token',
  {
    token: text('token').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // What this link is meant to do when consumed. Guardians skip the DOB
    // interstitial; on first consume of a `guardian_invite` we also flip the
    // matching guardian_link's accepted_at.
    purpose: text('purpose', {
      enum: ['applicant_signin', 'guardian_invite', 'guardian_signin'],
    })
      .notNull()
      .default('applicant_signin'),
    createdAt: integer('created_at').notNull().default(nowSql),
    expiresAt: integer('expires_at').notNull(),
    usedAt: integer('used_at'),
    requestIp: text('request_ip'),
  },
  (t) => ({
    userIdx: index('magic_link_user_idx').on(t.userId),
  }),
);

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull().default(nowSql),
    expiresAt: integer('expires_at').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
  },
  (t) => ({
    userIdx: index('session_user_idx').on(t.userId),
    expiresIdx: index('session_expires_idx').on(t.expiresAt),
  }),
);

export const applicantProfile = sqliteTable('applicant_profile', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  legalName: text('legal_name'),
  preferredName: text('preferred_name'),
  gradeLevel: text('grade_level'),
  school: text('school'),
  location: text('location'),
  timezone: text('timezone'),
  updatedAt: integer('updated_at').notNull().default(nowSql),
});

export const application = sqliteTable(
  'application',
  {
    id: text('id').primaryKey(),
    applicantUserId: text('applicant_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    status: text('status', {
      enum: [
        'draft',
        'awaiting_guardian',
        'submitted',
        'under_review',
        'accepted',
        'awaiting_payment',
        'enrolled',
        'declined',
        'waitlisted',
        'rejected',
        'withdrawn',
      ],
    })
      .notNull()
      .default('draft'),
    createdAt: integer('created_at').notNull().default(nowSql),
    updatedAt: integer('updated_at').notNull().default(nowSql),
    submittedAt: integer('submitted_at'),
    guardianSubmittedAt: integer('guardian_submitted_at'),
    decisionAt: integer('decision_at'),
    decisionBy: text('decision_by').references(() => user.id, { onDelete: 'set null' }),
    decisionNotes: text('decision_notes'),
  },
  (t) => ({
    // One draft/active application per applicant. Prevents concurrent-tab races.
    applicantUnique: uniqueIndex('application_applicant_idx').on(t.applicantUserId),
    statusIdx: index('application_status_idx').on(t.status),
  }),
);

export const applicationResponse = sqliteTable(
  'application_response',
  {
    applicationId: text('application_id')
      .notNull()
      .references(() => application.id, { onDelete: 'cascade' }),
    questionKey: text('question_key').notNull(),
    value: text('value').notNull(),
    updatedAt: integer('updated_at').notNull().default(nowSql),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.applicationId, t.questionKey] }),
  }),
);

// Denormalized availability rows for admin scheduling queries. Refreshed on
// every save of the `availability` response.
export const applicationAvailability = sqliteTable(
  'application_availability',
  {
    applicationId: text('application_id')
      .notNull()
      .references(() => application.id, { onDelete: 'cascade' }),
    weekday: integer('weekday').notNull(), // 0 = Sunday
    startMin: integer('start_min').notNull(), // minutes since local midnight
    endMin: integer('end_min').notNull(),
  },
  (t) => ({
    appIdx: index('availability_app_idx').on(t.applicationId),
    weekdayIdx: index('availability_weekday_idx').on(t.weekday),
  }),
);

// Denormalized course preferences for admin sort/filter. Refreshed on every
// save of the `course_preferences` response.
export const applicationCoursePreference = sqliteTable(
  'application_course_preference',
  {
    applicationId: text('application_id')
      .notNull()
      .references(() => application.id, { onDelete: 'cascade' }),
    courseKey: text('course_key').notNull(),
    rank: integer('rank').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.applicationId, t.courseKey] }),
    rankIdx: index('course_pref_rank_idx').on(t.applicationId, t.rank),
  }),
);

export const applicationFile = sqliteTable(
  'application_file',
  {
    id: text('id').primaryKey(),
    applicationId: text('application_id')
      .notNull()
      .references(() => application.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['transcript', 'aid_doc'] }).notNull(),
    storageKey: text('storage_key').notNull(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    // Which user uploaded this file — applicant for transcripts, guardian for
    // aid docs. Nullable for rows created before this column existed.
    uploadedByUserId: text('uploaded_by_user_id').references(() => user.id, {
      onDelete: 'restrict',
    }),
    uploadedAt: integer('uploaded_at').notNull().default(nowSql),
  },
  (t) => ({
    appKindIdx: index('file_app_kind_idx').on(t.applicationId, t.kind),
  }),
);

// One-to-one for the pilot: at most one guardian per applicant. Sibling case
// is handled by two applicant rows sharing the same guardian_user_id.
export const guardianLink = sqliteTable(
  'guardian_link',
  {
    id: text('id').primaryKey(),
    applicantUserId: text('applicant_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    guardianUserId: text('guardian_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    relationship: text('relationship', {
      enum: ['parent', 'guardian', 'other'],
    }).notNull(),
    createdAt: integer('created_at').notNull().default(nowSql),
    invitedAt: integer('invited_at'),
    acceptedAt: integer('accepted_at'),
  },
  (t) => ({
    applicantUnique: uniqueIndex('guardian_link_applicant_idx').on(t.applicantUserId),
    guardianIdx: index('guardian_link_guardian_idx').on(t.guardianUserId),
  }),
);

/*
 * The offer letter for a family.
 *
 * This deliberately merges what CLAUDE.md sketches as three separate entities
 * (`offer`, `financial_aid_decision`, `enrollment`). At pilot scale one row per
 * application is the whole story, and 1:1:1 tables would only add joins. Split
 * them if a student can ever hold two offers at once.
 *
 * `response` + `payment` are authoritative; `application.status` is a
 * denormalization derived from them by deriveStatus() in services/offers.ts.
 */
export const offer = sqliteTable(
  'offer',
  {
    id: text('id').primaryKey(),
    applicationId: text('application_id')
      .notNull()
      .references(() => application.id, { onDelete: 'cascade' }),
    courseKey: text('course_key'),
    // Free text, e.g. 'TOPOLOGY-2'. Not a foreign key: at pilot scale the
    // section list lives in a spreadsheet, not a table.
    section: text('section'),
    // Breakout group within a section — CLAUDE.md's `cohort`. Free text so a
    // group can be '5' or 'B' without a migration.
    cohort: text('cohort'),
    // The two weekly meetings, held separately because they are separately
    // scheduled: one 90-min problem session and one 90-min office hour.
    // Stored as the admin typed them, in the STUDENT's local time.
    problemSession: text('problem_session'),
    officeHours: text('office_hours'),
    aidAmountCents: integer('aid_amount_cents').notNull().default(0),
    amountDueCents: integer('amount_due_cents').notNull().default(0),
    // A calendar date in PROGRAM_TIMEZONE, stored 'YYYY-MM-DD'. Deliberately
    // not a unix timestamp: a deadline is a day, not an instant, and string
    // comparison against today-in-New-York is exact and dependency-free.
    enrollmentDeadline: text('enrollment_deadline'),
    // Family-visible. Internal review notes go on application.decision_notes.
    notes: text('notes'),
    response: text('response', { enum: ['accepted', 'declined'] }),
    respondedAt: integer('responded_at'),
    respondedByUserId: text('responded_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    notifiedAt: integer('notified_at'),
    lastImportId: text('last_import_id'),
    createdAt: integer('created_at').notNull().default(nowSql),
    updatedAt: integer('updated_at').notNull().default(nowSql),
  },
  (t) => ({
    applicationUnique: uniqueIndex('offer_application_idx').on(t.applicationId),
  }),
);

export const payment = sqliteTable(
  'payment',
  {
    id: text('id').primaryKey(),
    // restrict, not cascade: never let an application delete a money record.
    applicationId: text('application_id')
      .notNull()
      .references(() => application.id, { onDelete: 'restrict' }),
    stripeCheckoutSessionId: text('stripe_checkout_session_id').notNull().unique(),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    // The amount QUOTED at session creation, not the offer's current
    // amount_due. If admin re-imports a new price while a session is open,
    // this is what the family actually agreed to pay.
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('usd'),
    status: text('status', {
      enum: ['created', 'paid', 'failed', 'expired', 'refunded'],
    })
      .notNull()
      .default('created'),
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at').notNull().default(nowSql),
    paidAt: integer('paid_at'),
  },
  (t) => ({
    appIdx: index('payment_app_idx').on(t.applicationId),
  }),
);

// Webhook idempotency ledger. The PK is Stripe's own event id, so a duplicate
// delivery loses the insert race and the handler returns early.
export const stripeEvent = sqliteTable('stripe_event', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  payload: text('payload').notNull(),
  receivedAt: integer('received_at').notNull().default(nowSql),
  handledAt: integer('handled_at'),
  handlerResult: text('handler_result'),
});

// One row per publish. The id is a client-supplied idempotency key, so a
// double-clicked Publish is a no-op rather than a second batch.
export const offerImport = sqliteTable('offer_import', {
  id: text('id').primaryKey(),
  importedByUserId: text('imported_by_user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'restrict' }),
  filename: text('filename').notNull(),
  fileHash: text('file_hash').notNull(),
  rowCount: integer('row_count').notNull(),
  changedCount: integer('changed_count').notNull(),
  changedAppIds: text('changed_app_ids').notNull(), // JSON string[]
  diffJson: text('diff_json').notNull(), // the applied diff, for audit
  createdAt: integer('created_at').notNull().default(nowSql),
  notifiedAt: integer('notified_at'),
  notifiedCount: integer('notified_count'),
});

/*
 * ==================== agreements and Discord ====================
 */

/*
 * One row per (application, document, signer). Four rows is a complete family:
 * the code of conduct and the participation agreement, each acknowledged by
 * the student and by the guardian.
 *
 * Deliberately NOT an application_response row like the application's own
 * signature questions. Those store a client-supplied timestamp (or, for the
 * guardian, no timestamp at all) against an unversioned page, which cannot
 * answer "what exactly did they agree to, and when". A consent record that
 * cannot answer that is not worth keeping.
 */
export const agreementSignature = sqliteTable(
  'agreement_signature',
  {
    id: text('id').primaryKey(),
    applicationId: text('application_id')
      .notNull()
      .references(() => application.id, { onDelete: 'cascade' }),
    document: text('document', {
      enum: ['code_of_conduct', 'participation_agreement'],
    }).notNull(),
    signerKind: text('signer_kind', { enum: ['student', 'guardian'] }).notNull(),
    // Who actually clicked — not who was supposed to. A guardian signing from
    // their own portal and a student signing from theirs are different rows
    // with different user ids, and that is the point.
    signerUserId: text('signer_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    typedName: text('typed_name').notNull(),
    // What was on the screen: the declared version, plus a hash of the text
    // itself, so an edit without a version bump is still detectable later.
    documentVersion: text('document_version').notNull(),
    documentHash: text('document_hash').notNull(),
    // Server clock. Never the browser's.
    signedAt: integer('signed_at').notNull().default(nowSql),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => ({
    // Re-signing is an idempotent no-op, not a second row.
    oneEach: uniqueIndex('agreement_signature_unique_idx').on(
      t.applicationId,
      t.document,
      t.signerKind,
    ),
    applicationIdx: index('agreement_signature_application_idx').on(t.applicationId),
  }),
);

/*
 * The contact block inside the participation agreement.
 *
 * Separate from the signature because it is live operational data, not
 * evidence: staff need to reach this guardian during the term, and the
 * guardian may update a phone number without re-signing anything.
 *
 * This is the ONLY place a guardian phone number is ever collected — the
 * application form has never asked for one.
 */
export const guardianContact = sqliteTable('guardian_contact', {
  applicationId: text('application_id')
    .primaryKey()
    .references(() => application.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  phone: text('phone').notNull(),
  altPhone: text('alt_phone'),
  updatedAt: integer('updated_at').notNull().default(nowSql),
});

/*
 * A verified Discord account belonging to a portal user.
 *
 * Keyed on user_id rather than application_id because a guardian could in
 * principle link one too; only students are synced today.
 */
export const discordLink = sqliteTable(
  'discord_link',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    // One Discord account cannot stand in for two students — the uniqueness
    // is declared once, as an index below.
    discordUserId: text('discord_user_id').notNull(),
    discordUsername: text('discord_username'),
    linkedAt: integer('linked_at').notNull().default(nowSql),
    joinedGuildAt: integer('joined_guild_at'),
    lastSyncAt: integer('last_sync_at'),
    // Last failure, kept so the admin screen can show why someone is stuck
    // rather than silently showing nothing.
    lastSyncError: text('last_sync_error'),
  },
  (t) => ({
    discordIdx: uniqueIndex('discord_link_discord_idx').on(t.discordUserId),
  }),
);

/*
 * Section and group roles the bot created in the guild, so it never has to
 * match roles by name at runtime. Names are display; ids are identity.
 */
export const discordRole = sqliteTable(
  'discord_role',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: ['section', 'group'] }).notNull(),
    // 'QUADRATIC-2' for a section, 'QUADRATIC-2/3' for a group.
    key: text('key').notNull(),
    roleId: text('role_id').notNull(),
    name: text('name').notNull(),
    createdAt: integer('created_at').notNull().default(nowSql),
  },
  (t) => ({
    kindKeyUnique: uniqueIndex('discord_role_kind_key_idx').on(t.kind, t.key),
  }),
);

/*
 * ==================== sections and the sessions they hold ====================
 */

/*
 * A course offered at a specific weekly time — CLAUDE.md's long-deferred
 * `section`, finally a row because Zoom meetings and attendance need
 * something to belong to.
 *
 * Meeting times are WALL CLOCK in PROGRAM_TIMEZONE: a weekday and a
 * minute-of-day, never a UTC instant or offset. US daylight saving ends
 * mid-term on Nov 1, and families were promised "US daylight-saving changes
 * do not affect your times", so 09:00 stays 09:00 in New York while the UTC
 * instant moves. Each occurrence resolves its own instant from these.
 *
 * `offer.section` stays as the family-facing display string. This table does
 * not replace it — the spreadsheet import still writes that text, and
 * roundtrip.test.ts still guards it.
 */
export const section = sqliteTable(
  'section',
  {
    id: text('id').primaryKey(),
    // The first term key the system has ever had. Everything else still
    // assumes a single term exists.
    term: text('term').notNull(),
    courseKey: text('course_key').notNull(),
    number: integer('number').notNull(),
    // 'QUADRATIC-2' — matches offer.section, and discord_role.key.
    label: text('label').notNull(),
    // Weekday 0 = Sunday. Null until someone resolves the time.
    problemWeekday: integer('problem_weekday'),
    problemMinute: integer('problem_minute'),
    officeWeekday: integer('office_weekday'),
    officeMinute: integer('office_minute'),
    createdAt: integer('created_at').notNull().default(nowSql),
    updatedAt: integer('updated_at').notNull().default(nowSql),
  },
  (t) => ({
    termLabel: uniqueIndex('section_term_label_idx').on(t.term, t.label),
  }),
);

/*
 * One row per meeting that is actually supposed to happen.
 *
 * Materialised rather than computed from a recurrence rule, because a rule
 * cannot express the Thanksgiving skip, a cancelled week, or a one-off
 * reschedule — and because Zoom attendance needs a concrete row to attach to.
 * Eight sections x two kinds x ten weeks is 160 rows for the whole term.
 */
export const sessionOccurrence = sqliteTable(
  'session_occurrence',
  {
    id: text('id').primaryKey(),
    sectionId: text('section_id')
      .notNull()
      .references(() => section.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['problem_session', 'office_hours'] }).notNull(),
    // Calendar date in PROGRAM_TIMEZONE, 'YYYY-MM-DD'.
    date: text('date').notNull(),
    // Resolved instant. Recomputed if the section's wall-clock time changes.
    startsAt: integer('starts_at').notNull(),
    status: text('status', { enum: ['scheduled', 'cancelled'] })
      .notNull()
      .default('scheduled'),
    // The specific Zoom occurrence, filled in once it is known. Zoom reports
    // attendance per occurrence UUID, not per recurring meeting id.
    zoomMeetingUuid: text('zoom_meeting_uuid'),
    attendancePulledAt: integer('attendance_pulled_at'),
    createdAt: integer('created_at').notNull().default(nowSql),
  },
  (t) => ({
    once: uniqueIndex('occurrence_unique_idx').on(t.sectionId, t.kind, t.date),
    byDate: index('occurrence_date_idx').on(t.date),
  }),
);

/*
 * Who teaches what.
 *
 * `user_role` says someone is a mentor; this says which sections. Both are
 * needed: the role gates the mentor portal at all, and these rows decide
 * which students a given mentor may see. One mentor can hold two sections
 * (Blaze holds GGT-2 and TOPOLOGY-2), and a section can have a mentor plus
 * course assistants, so this is a join table rather than a column.
 */
export const sectionStaff = sqliteTable(
  'section_staff',
  {
    sectionId: text('section_id')
      .notNull()
      .references(() => section.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // Mirrors user_role's vocabulary: the mentor leads the section, an
    // assistant grades and monitors breakout rooms.
    role: text('role', { enum: ['mentor', 'assistant'] }).notNull(),
    assignedAt: integer('assigned_at').notNull().default(nowSql),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.sectionId, t.userId] }),
    byUser: index('section_staff_user_idx').on(t.userId),
  }),
);

/*
 * A staff member's Zoom account.
 *
 * Their portal address and their Zoom address are not the same thing and
 * there is no rule that makes them so: Blaze signs into the portal as a gmail
 * address and into Zoom as okonogi@rossprogram.org. Meeting provisioning
 * resolves a section's host by Zoom address, so guessing it from the portal
 * address would fail to find the host — and surface as an empty meeting on a
 * Sunday morning rather than as an error.
 *
 * Same shape as discord_link: keyed on the portal user, unique on the
 * external identity.
 */
export const zoomAccount = sqliteTable(
  'zoom_account',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    zoomEmail: text('zoom_email').notNull(),
    // Zoom's own id, filled in once we have looked them up.
    zoomUserId: text('zoom_user_id'),
    linkedAt: integer('linked_at').notNull().default(nowSql),
    lastSyncAt: integer('last_sync_at'),
    lastSyncError: text('last_sync_error'),
  },
  (t) => ({
    emailIdx: uniqueIndex('zoom_account_email_idx').on(t.zoomEmail),
  }),
);

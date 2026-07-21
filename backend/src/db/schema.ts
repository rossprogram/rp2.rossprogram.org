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

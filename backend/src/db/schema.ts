import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const nowSql = sql`(CAST(strftime('%s', 'now') AS INTEGER))`;

export const user = sqliteTable(
  'user',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
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

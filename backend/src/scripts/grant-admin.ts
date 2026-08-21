/*
 * grant-admin: grants the 'admin' role to a user, creating the user row if it
 * doesn't exist yet.
 *
 * Usage:
 *   pnpm --filter @rp2/backend grant-admin -- <email>
 *   pnpm --filter @rp2/backend grant-admin -- --revoke <email>
 */

import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/client.js';
import { user, userRole } from '../db/schema.js';

function usage(): never {
  console.error('usage: grant-admin [--revoke] <email>');
  process.exit(2);
}

function main(): void {
  const args = process.argv.slice(2);
  let revoke = false;
  let email: string | undefined;
  for (const arg of args) {
    if (arg === '--revoke') revoke = true;
    else if (arg.startsWith('-')) usage();
    else email = arg;
  }
  if (!email) usage();

  const normalized = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    console.error(`not a valid email: ${email}`);
    process.exit(2);
  }

  let row = db.select().from(user).where(eq(user.email, normalized)).get();
  if (!row) {
    if (revoke) {
      console.error(`no user with email ${normalized}`);
      process.exit(1);
    }
    const id = nanoid();
    db.insert(user).values({ id, email: normalized }).run();
    row = db.select().from(user).where(eq(user.id, id)).get()!;
    console.log(`created user ${normalized} (${id})`);
  }

  if (revoke) {
    const deleted = db
      .delete(userRole)
      .where(and(eq(userRole.userId, row.id), eq(userRole.role, 'admin')))
      .run();
    if (deleted.changes === 0) {
      console.log(`${normalized} was not an admin`);
    } else {
      console.log(`revoked admin from ${normalized}`);
    }
    return;
  }

  const existing = db
    .select()
    .from(userRole)
    .where(and(eq(userRole.userId, row.id), eq(userRole.role, 'admin')))
    .get();
  if (existing) {
    console.log(`${normalized} is already an admin`);
    return;
  }
  db.insert(userRole).values({ userId: row.id, role: 'admin' }).run();
  console.log(`granted admin to ${normalized}`);
}

main();

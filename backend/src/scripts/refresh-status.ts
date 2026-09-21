/*
 * refresh-status: re-derive application.status from the authoritative pair
 * (offer.response, sum of paid payments) for the given applications.
 *
 * This exists because an import that changes an accepted offer's money —
 * granting a full scholarship, say — writes the offer row without touching
 * application.status, which leaves the family stranded in awaiting_payment
 * with nothing to pay. Until applyRow() re-derives on its own, this is the
 * repair tool. It never invents a status; it only recomputes the same
 * deriveStatus() the rest of the app uses.
 *
 * Usage:
 *   pnpm --filter @rp2/backend refresh-status -- --dry-run <app_id>...
 *   pnpm --filter @rp2/backend refresh-status -- <app_id>...
 */

import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { application, offer } from '../db/schema.js';
import { deriveStatus, paidCentsFor, refreshStatus } from '../services/offers.js';

function usage(): never {
  console.error('usage: refresh-status [--dry-run] <app_id>...');
  process.exit(2);
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const ids = args.filter((a) => !a.startsWith('-'));
  if (ids.length === 0) usage();

  let changed = 0;
  for (const id of ids) {
    const app = db.select().from(application).where(eq(application.id, id)).get();
    if (!app) {
      console.error(`${id}: no such application`);
      process.exitCode = 1;
      continue;
    }
    const o = db.select().from(offer).where(eq(offer.applicationId, id)).get();
    if (!o) {
      console.error(`${id}: no offer; nothing to derive from`);
      process.exitCode = 1;
      continue;
    }

    const paid = paidCentsFor(id);
    const next = deriveStatus(o, paid);
    const line =
      `${id}: response=${o.response ?? 'none'} due=${o.amountDueCents} paid=${paid} ` +
      `status ${app.status} -> ${next}`;

    if (next === app.status) {
      console.log(`${line} (no change)`);
      continue;
    }
    if (dryRun) {
      console.log(`${line} (dry run, not written)`);
      changed += 1;
      continue;
    }
    const written = refreshStatus(id);
    console.log(`${line} (written: ${written})`);
    changed += 1;
  }

  console.log(dryRun ? `${changed} would change` : `${changed} changed`);
}

main();

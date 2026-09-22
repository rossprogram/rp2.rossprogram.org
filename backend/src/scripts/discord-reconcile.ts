/*
 * discord-reconcile: bring the guild in line with the portal.
 *
 * Creates any missing section and group roles, then walks every cleared
 * student and applies the difference between what their offer says and what
 * Discord currently shows. Safe to re-run — it is a diff, not a script of
 * commands.
 *
 * Defaults to a DRY RUN. The live form can add people to and remove people
 * from a server full of minors, so making that an explicit flag is the point.
 *
 * Usage:
 *   pnpm --filter @rp2/backend discord-reconcile              # dry run
 *   pnpm --filter @rp2/backend discord-reconcile -- --apply   # for real
 */

import { discordEnabled } from '../integrations/discord/index.js';
import { reconcileAll } from '../services/discord-sync.js';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  if (!discordEnabled()) {
    console.error('DISCORD_ENABLED is false — nothing to do.');
    process.exit(2);
  }

  const report = await reconcileAll({ dryRun: !apply });

  console.log(apply ? 'Applied:' : 'Dry run (pass --apply to write):');
  console.log(`  cleared students: ${report.cleared}`);
  console.log(`  with Discord linked: ${report.linked}`);
  console.log(`  roles to create: ${report.rolesCreated.length}`);
  for (const name of report.rolesCreated) console.log(`    + ${name}`);
  if (report.rolesAdopted.length > 0) {
    console.log(`  existing roles adopted: ${report.rolesAdopted.length}`);
    for (const name of report.rolesAdopted) console.log(`    = ${name}`);
  }

  const byOutcome = new Map<string, number>();
  for (const r of report.results) {
    const key =
      r.outcome.status === 'skipped' ? `skipped: ${r.outcome.reason}` : r.outcome.status;
    byOutcome.set(key, (byOutcome.get(key) ?? 0) + 1);
  }
  console.log('  members:');
  for (const [key, count] of [...byOutcome].sort()) {
    console.log(`    ${key}: ${count}`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

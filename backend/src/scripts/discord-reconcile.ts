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
 * It ADOPTS roles that already exist by name and never creates one unless
 * asked. A role in a configured server carries channel permissions; a fresh
 * one with the same name carries none, and the two are hard to tell apart in
 * the member list. So a name we cannot find is reported as a mismatch to be
 * fixed by a human, not papered over.
 *
 * Usage:
 *   pnpm --filter @rp2/backend discord-reconcile                     # dry run
 *   pnpm --filter @rp2/backend discord-reconcile -- --apply          # for real
 *   pnpm --filter @rp2/backend discord-reconcile -- --create-missing # also create absent roles
 */

import { discordEnabled } from '../integrations/discord/index.js';
import { reconcileAll } from '../services/discord-sync.js';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const allowCreate = process.argv.includes('--create-missing');

  if (!discordEnabled()) {
    console.error('DISCORD_ENABLED is false — nothing to do.');
    process.exit(2);
  }

  const report = await reconcileAll({ dryRun: !apply, allowCreate });

  console.log(apply ? 'Applied:' : 'Dry run (pass --apply to write):');
  console.log(`  cleared students: ${report.cleared}`);
  console.log(`  with Discord linked: ${report.linked}`);

  if (report.rolesAdopted.length > 0) {
    console.log(`  existing roles matched: ${report.rolesAdopted.length}`);
    for (const name of report.rolesAdopted.sort()) console.log(`    = ${name}`);
  }
  if (report.rolesCreated.length > 0) {
    console.log(`  roles created: ${report.rolesCreated.length}`);
    for (const name of report.rolesCreated.sort()) console.log(`    + ${name}`);
  }
  if (report.rolesMissing.length > 0) {
    console.log('');
    console.log(`  !! ${report.rolesMissing.length} role(s) do not exist in the guild:`);
    for (const name of report.rolesMissing.sort()) console.log(`    ? ${name}`);
    console.log('');
    console.log('  These names come from COURSES in shared/src/offers.ts.');
    console.log('  Either the roles are named differently in Discord (fix the');
    console.log('  constants), or they genuinely need creating (--create-missing).');
    console.log('  Nothing was created.');
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

  /*
   * "not_a_member" means linked but absent from the guild, and no amount of
   * reconciling fixes it: adding somebody needs their OAuth token, which only
   * exists while they are clicking. Spell that out rather than leaving a bare
   * count that reads like a minor skip.
   */
  const stranded = report.results.filter(
    (r) => r.outcome.status === 'skipped' && r.outcome.reason === 'not_a_member',
  );
  if (stranded.length > 0) {
    console.log('');
    console.log(`  !! ${stranded.length} student(s) are linked but NOT in the guild.`);
    console.log('     They have to click "Finish joining the server" in the portal;');
    console.log('     re-running this cannot add them.');
  }

  // A mismatch means some students cannot be placed at all, so fail loudly
  // enough that a deploy script or a human notices.
  if (report.rolesMissing.length > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

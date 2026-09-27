/*
 * discord-country-roles: create a flag role for every country represented.
 *
 * Reads each application's free-text location (falling back to its time
 * zone), works out the country, and makes sure "🇨🇳 China" and friends exist
 * in the guild so students can take one with /role. Roles that already exist
 * under the same name are adopted, not duplicated. Safe to re-run — new
 * countries get roles, existing ones are left alone.
 *
 * Defaults to a DRY RUN, and prints what it could not place so a human can
 * look: the student can always pick their own country with /role, but a
 * country nobody resolved to gets no role to pick.
 *
 * Usage:
 *   pnpm --filter @rp2/backend discord-country-roles                            # dry run, enrolled students
 *   pnpm --filter @rp2/backend discord-country-roles -- --apply                 # for real
 *   pnpm --filter @rp2/backend discord-country-roles -- --all-applicants        # everyone who applied
 */

import { countryName } from '@rp2/shared';
import { discordEnabled } from '../integrations/discord/index.js';
import { ensureCountryRoles } from '../services/discord-country.js';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const scope = process.argv.includes('--all-applicants') ? 'applicants' : 'enrolled';

  if (!discordEnabled()) {
    console.error('DISCORD_ENABLED is false — nothing to do.');
    process.exit(2);
  }

  const plan = await ensureCountryRoles({ dryRun: !apply, scope });

  console.log(apply ? 'Applied:' : 'Dry run (pass --apply to write):');
  console.log(`  ${scope === 'enrolled' ? 'enrolled students' : 'applications'}: ${plan.considered}`);
  console.log(`  countries: ${plan.tally.size}`);
  for (const [code, n] of [...plan.tally].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${code}  ${countryName(code)}`);
  }

  if (plan.existing.length > 0) console.log(`  roles already recorded: ${plan.existing.length}`);
  if (plan.adopted.length > 0) {
    console.log(`  existing roles matched: ${plan.adopted.length}`);
    for (const name of plan.adopted) console.log(`    = ${name}`);
  }
  if (plan.created.length > 0) {
    console.log(`  roles ${apply ? 'created' : 'to create'}: ${plan.created.length}`);
    for (const name of plan.created) console.log(`    + ${name}`);
  }

  // Application ids, not names: this output ends up in terminals and pastes.
  if (plan.unresolved.length > 0) {
    console.log('');
    console.log(`  ?? ${plan.unresolved.length} application(s) name no country we recognise:`);
    for (const p of plan.unresolved) {
      console.log(`    ${p.applicationId}  ${JSON.stringify(p.location)}  ${p.timezone ?? ''}`);
    }
  }
  if (plan.byTimezone.length > 0) {
    console.log('');
    console.log(`  ~  ${plan.byTimezone.length} placed by time zone alone (location named no country):`);
    for (const p of plan.byTimezone) {
      console.log(`    ${p.applicationId}  ${p.code}  ${JSON.stringify(p.location)}  ${p.timezone ?? ''}`);
    }
  }
  if (plan.conflicts.length > 0) {
    console.log('');
    console.log(`  !  ${plan.conflicts.length} where location and time zone disagree (location wins):`);
    for (const p of plan.conflicts) {
      console.log(
        `    ${p.applicationId}  ${p.code} vs ${p.zoneCode}  ${JSON.stringify(p.location)}  ${p.timezone ?? ''}`,
      );
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

/*
 * discord-register-commands: tell Discord that /whois exists.
 *
 * Slash commands are registered once per guild, out of band — the running
 * server never does this, because re-registering on every boot is how you
 * get rate-limited for no reason. Re-run it only when the command's shape
 * changes.
 *
 * Registers to the GUILD rather than globally: guild commands appear
 * immediately, while global ones take up to an hour to propagate, and this
 * bot serves exactly one server.
 *
 * Usage:
 *   pnpm --filter @rp2/backend discord-register-commands
 */

import { env } from '../env.js';

const COMMANDS = [
  {
    name: 'whois',
    description: 'Look up a member of the program',
    options: [
      {
        // Type 6 is USER: Discord renders a member picker and hands us the
        // account id, so nobody has to type a name correctly.
        type: 6,
        name: 'member',
        description: 'The member to look up',
        required: true,
      },
    ],
  },
];

async function main(): Promise<void> {
  const { DISCORD_ENABLED, DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = env;
  if (!DISCORD_ENABLED || !DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID || !DISCORD_GUILD_ID) {
    console.error('Discord is not configured (DISCORD_ENABLED=true plus token, client id, guild).');
    process.exit(2);
  }

  const res = await fetch(
    `https://discord.com/api/v10/applications/${DISCORD_CLIENT_ID}/guilds/${DISCORD_GUILD_ID}/commands`,
    {
      method: 'PUT',
      headers: {
        authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(COMMANDS),
    },
  );

  if (!res.ok) {
    console.error(`Discord returned ${res.status}: ${await res.text()}`);
    process.exit(1);
  }

  const registered = (await res.json()) as { name: string }[];
  console.log(`Registered ${registered.length} command(s): ${registered.map((c) => c.name).join(', ')}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

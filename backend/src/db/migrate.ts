import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { db } from './client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, '../../migrations');

export function runMigrations(): void {
  migrate(db, { migrationsFolder });
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('migrate.ts');

if (invokedDirectly) {
  runMigrations();
  console.log('migrations complete');
}

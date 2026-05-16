/**
 * Wrapper: конструирует DATABASE_URL из POSTGRES_* и запускает миграции.
 * Запускать отдельно: node migrate.js
 * Render Start Command: node migrate.js && node src/server.js
 */

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const host = process.env.POSTGRES_HOST;
const port = process.env.POSTGRES_PORT || '5432';
const db = process.env.POSTGRES_DB;
const user = process.env.POSTGRES_USER;
const pass = process.env.POSTGRES_PASSWORD;

if (!host || !db || !user || !pass) {
  console.error('Missing POSTGRES_* environment variables');
  process.exit(1);
}

const DATABASE_URL = `postgresql://${user}:${pass}@${host}:${port}/${db}`;
console.log('DATABASE_URL constructed, running migrations...');

execSync('npx node-pg-migrate up', {
  stdio: 'inherit',
  cwd: __dirname,
  env: { ...process.env, DATABASE_URL },
});

console.log('Migrations completed.');

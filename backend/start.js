/**
 * Wrapper: конструирует DATABASE_URL из POSTGRES_* и запускает миграции + сервер.
 * Render не генерирует DATABASE_URL автоматически при fromDatabase.
 */

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, '..');

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

// Запускаем миграции с DATABASE_URL в env, cwd = backend (где лежит migrations/)
execSync(`npx node-pg-migrate --database ${db} --hostname ${host} --port ${port} --username ${user} --password ${pass} --migdir migrations up`, {
  stdio: 'inherit',
  cwd: root,
  env: { ...process.env },
});

console.log('Migrations completed. Starting server...');
execSync('node src/server.js', { stdio: 'inherit', cwd: root });

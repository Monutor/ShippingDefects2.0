/**
 * Запуск init.sql напрямую через pg client.
 * Без node-pg-migrate — один скрипт, idempotent, быстро.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Pool } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: parseInt(process.env.POSTGRES_PORT, 10) || 5432,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
});

pool.on('connect', (client) => {
  client.query("SET client_encoding TO 'UTF8'");
});

async function runMigrations() {
  console.log('Connecting to database...');
  const client = await pool.connect();
  try {
    const sql = readFileSync(join(__dirname, 'migrations', 'init.sql'), 'utf8');
    console.log('Running init.sql...');
    await client.query(sql);
    console.log('Migrations completed.');
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});

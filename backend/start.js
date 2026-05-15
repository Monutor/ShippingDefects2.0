#!/usr/bin/env node
/**
 * Wrapper: создаёт DATABASE_URL из POSTGRES_* переменных и запускает миграции.
 * Render не генерирует DATABASE_URL автоматически при fromDatabase.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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

// Run migrations
execSync(`DATABASE_URL="${DATABASE_URL}" npx node-pg-migrate --config .pg-migrate.json -m migrations up`, {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
});

console.log('Migrations completed. Starting server...');

// Start the server
execSync('node src/server.js', {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
});

/**
 * Запуск сервера.
 * Render Start Command: node migrate.js && node src/server.js
 */

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

console.log('Starting server...');
execSync('node src/server.js', { stdio: 'inherit', cwd: __dirname });

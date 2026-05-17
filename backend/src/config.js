/**
 * Конфигурация бэкенда из переменных окружения.
 */

import dotenv from 'dotenv';
dotenv.config();

const required = [
  'POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB',
  'POSTGRES_USER', 'POSTGRES_PASSWORD',
  'JWT_SECRET'
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

// JWT_SECRET должен быть достаточно длинным для безопасности
if (process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long');
}

export const config = {
  postgres: {
    host: process.env.POSTGRES_HOST,
    port: validatePort(process.env.POSTGRES_PORT, 'POSTGRES_PORT'),
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  },
  server: {
    host: process.env.BACKEND_HOST || '0.0.0.0',
    port: parseInt(process.env.BACKEND_PORT, 10) || 3001,
  },
};

function validatePort(value, name) {
  const port = parseInt(value, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a valid port number (1-65535), got: ${value}`);
  }
  return port;
}

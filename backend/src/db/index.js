/**
 * Подключение к PostgreSQL.
 * Использует пул соединений для эффективной работы с базой данных.
 */

import { Pool } from 'pg';
import { config } from '../config.js'; // PG connection config

export const pool = new Pool({
  host: config.postgres.host,
  port: config.postgres.port,
  database: config.postgres.database,
  user: config.postgres.user,
  password: config.postgres.password,
});

// Гарантируем UTF-8 кодировку на каждом новом соединении
pool.on('connect', (client) => {
  client.query("SET client_encoding TO 'UTF8'");
});

/**
 * Выполняет SQL-запрос с параметрами.
 * Возвращает массив объектов-строк.
 */
export async function query(text, params) {
  const client = await pool.connect();
  try {
    // Убеждаемся что кодировка UTF8 (на случай если connect hook не сработал)
    await client.query("SET client_encoding TO 'UTF8'");
    const result = await client.query(text, params);
    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Выполняет запрос и возвращает { rows, rowCount }.
 * Нужен для DELETE/INSERT/UPDATE где важно знать affected rows.
 */
export async function queryRaw(text, params) {
  const client = await pool.connect();
  try {
    await client.query("SET client_encoding TO 'UTF8'");
    const result = await client.query(text, params);
    return { rows: result.rows, rowCount: result.rowCount };
  } finally {
    client.release();
  }
}

/**
 * Выполняет однократный запрос (без пула).
 * Используется для миграций и seed.
 */
export async function singleQuery(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

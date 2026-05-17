/**
 * Seed данных: админ по умолчанию и начальная настройка.
 */

import { singleQuery } from './src/db/index.js';
import dotenv from 'dotenv';
dotenv.config();

async function seed() {
  console.log('🌱 Running seed...');

  // Админ профиль — employee_id из env или 'admin' по умолчанию
  const adminEmployeeId = process.env.ADMIN_EMPLOYEE_ID || 'admin';
  await singleQuery(
    `INSERT INTO collector_profiles (employee_id, full_name, position, is_admin)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (employee_id) DO NOTHING`,
    [adminEmployeeId, 'Администратор', 'Склад']
  );

  // Начальная настройка: maintenance_mode = false
  await singleQuery(
    `INSERT INTO app_settings (key, value)
     VALUES ('maintenance_mode', 'false')
     ON CONFLICT (key) DO NOTHING`,
  );

  console.log('✅ Seed completed');
}

seed().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});

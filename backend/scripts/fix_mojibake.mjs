/**
 * 007_fix_mojibake.mjs
 * Исправление mojibake в collector_profiles.full_name
 * 
 * Mojibake: UTF-8 байты сохранены как WIN1251 клиентом.
 * Например "Тест" → UTF-8 bytes D0 A2 D0 B5 D1 81 → прочитано как WIN1251 → "Р?Р?РёР?"
 */

import { Pool } from 'pg';

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'warehouse_brain',
  user: 'postgres',
  password: 'postgres',
});

function fixMojibake(str) {
  // Преобразуем строку (как WIN1251) обратно в UTF-8
  const buf = Buffer.from(str, 'latin1');
  return buf.toString('utf8');
}

async function main() {
  console.log('🔍 Чтение collector_profiles...');
  
  // Читает все записи с mojibake
  const res = await pool.query(
    "SELECT employee_id, full_name FROM collector_profiles WHERE full_name IS NOT NULL"
  );

  let fixed = 0;
  for (const row of res.rows) {
    const original = row.full_name;
    
    // Проверяем: содержит ли mojibake паттерн
    if (/[\x80-\xFF]/.test(original)) {
      const decoded = fixMojibake(original);
      console.log(`  ${row.employee_id}: "${original}" → "${decoded}"`);
      
      await pool.query(
        "UPDATE collector_profiles SET full_name = $1 WHERE employee_id = $2",
        [decoded, row.employee_id]
      );
      fixed++;
    } else {
      console.log(`  ${row.employee_id}: OK — "${original}"`);
    }
  }

  console.log(`\n✅ Исправлено: ${fixed} записей`);
  
  // Проверяем brain_items и separate_items
  for (const table of ['brain_items', 'separate_items']) {
    const cols = ['name', 'brand', 'model'];
    let totalFixed = 0;
    
    for (const col of cols) {
      const res2 = await pool.query(
        `SELECT id, ${col} FROM ${table} WHERE ${col} IS NOT NULL AND ${col} != LOWER(${col})`
      );
      
      for (const row of res2.rows) {
        if (/[\x80-\xFF]/.test(row[col])) {
          const decoded = fixMojibake(row[col]);
          console.log(`  ${table}.${col}[${row.id}]: "${row[col]}" → "${decoded}"`);
          
          await pool.query(
            `UPDATE ${table} SET ${col} = $1 WHERE id = $2`,
            [decoded, row.id]
          );
          totalFixed++;
        }
      }
    }
    
    if (totalFixed > 0) {
      console.log(`✅ ${table}: исправлено ${totalFixed} полей`);
    } else {
      console.log(`✓ ${table}: mojibake не найден`);
    }
  }

  await pool.end();
}

main().catch(err => {
  console.error('❌ Ошибка:', err.message);
  process.exit(1);
});

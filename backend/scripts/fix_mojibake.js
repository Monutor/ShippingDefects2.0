/**
 * fix_mojibake.js — исправляет повреждённые имена в БД
 * Запуск: node backend/scripts/fix_mojibake.js
 */

const { Client } = require('pg');

// Преобразуем mojibake обратно к оригинальному тексту
// mojibake: UTF-8 байты интерпретированы как Windows-1251 при записи
function fixMojibake(str) {
  if (!str || typeof str !== 'string') return str;
  
  // Проверяем наличие mojibake (символы в диапазоне U+0400-U+04FF)
  if (!/[\x0400-\x04FF]/.test(str)) {
    return null; // Не mojibake
  }

  // Конвертируем: mojibake string → latin1 bytes → windows-1251 string
  const buf = Buffer.from(str, 'latin1');
  
  // Windows-1251 → UTF-8
  let decoded = '';
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    if (byte >= 0x41 && byte <= 0x5A) {
      // A-Z (ASCII) — оставляем как есть
      decoded += String.fromCharCode(byte);
    } else if (byte >= 0x61 && byte <= 0x7A) {
      // a-z (ASCII) — оставляем как есть
      decoded += String.fromCharCode(byte);
    } else if (byte >= 0xC0 && byte <= 0xFF) {
      // Windows-1251 Cyrillic: C0=А, C1=Б, ..., D0=С, ...
      const cp = byte + 0x0400; // Windows-1251 0xC0 → Unicode U+0410 (А)
      decoded += String.fromCharCode(cp);
    } else if (byte >= 0xA0 && byte <= 0xBF) {
      // Lowercase Cyrillic in Win-1251: A0=а, ...
      const cp = byte + 0x03E0; // Windows-1251 0xA0 → Unicode U+0430 (а)
      decoded += String.fromCharCode(cp);
    } else {
      decoded += String.fromCharCode(byte);
    }
  }

  return decoded;
}

async function main() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'warehouse_brain',
    user: 'postgres',
    password: 'postgres',
  });

  try {
    await client.connect();
    console.log('✅ Подключено к warehouse_brain');

    // Читаем corrupted данные
    const profiles = await client.query(
      "SELECT employee_id, full_name FROM collector_profiles WHERE full_name ~ '[\\x0400-\\x04FF]'"
    );
    
    console.log(`\n📋 Найдено ${profiles.rows.length} повреждённых профилей:`);
    for (const p of profiles.rows) {
      const fixed = fixMojibake(p.full_name);
      console.log(`  ${p.employee_id}: "${p.full_name}" → "${fixed || '(не удалось исправить)'}"`);
    }

    // Обновляем профили
    for (const p of profiles.rows) {
      const fixed = fixMojibake(p.full_name);
      if (fixed) {
        await client.query(
          'UPDATE collector_profiles SET full_name = $1 WHERE employee_id = $2',
          [fixed, p.employee_id]
        );
        console.log(`  ✅ Исправлен: ${p.employee_id} → "${fixed}"`);
      }
    }

    // Обновляем короба из исправленных профилей
    const boxes = await client.query(
      "SELECT id, collector_id, collector_full_name FROM boxes WHERE (collector_full_name IS NULL OR collector_full_name ~ '[\\x0400-\\x04FF]') AND collector_id IS NOT NULL"
    );

    console.log(`\n📦 Найдено ${boxes.rows.length} коробов для обновления:`);
    
    for (const box of boxes.rows) {
      if (!box.collector_full_name || /[\x0400-\x04FF]/.test(box.collector_full_name)) {
        const profile = await client.query(
          'SELECT full_name FROM collector_profiles WHERE employee_id = $1',
          [box.collector_id]
        );

        let name = profile.rows[0]?.full_name;
        
        if (!name || !name.trim()) {
          name = `Сборщик ${box.collector_id}`;
        }

        await client.query(
          'UPDATE boxes SET collector_full_name = $1 WHERE id = $2',
          [name, box.id]
        );
        console.log(`  Короб ${box.id.substring(0,8)}: "${name}"`);
      }
    }

    // Для коробов с NULL collector_id — ставим placeholder
    const nullCollectorBoxes = await client.query(
      "SELECT COUNT(*) FROM boxes WHERE (collector_full_name IS NULL OR collector_full_name ~ '[\\x0400-\\x04FF]') AND collector_id IS NULL"
    );
    
    console.log(`\n⚠️ ${nullCollectorBoxes.rows[0].count} коробов с NULL collector_id — требуют ручной настройки`);

    console.log('\n✅ Готово!');
  } catch (err) {
    console.error('❌ Ошибка:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();

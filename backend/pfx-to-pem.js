/**
 * Конвертирует cert.pfx (PFX) → key.pem + cert.pem (PEM)
 * Запуск: node pfx-to-pem.js
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const certsDir = path.join(__dirname, 'certs');

// Читаем PFX файл
const pfxData = fs.readFileSync(path.join(certsDir, 'cert.pfx'));

// Извлекаем key и cert из PFX (пароль: warehouse123)
try {
  const result = crypto.createPrivateKey({
    key: pfxData,
    format: 'pfx',
    passphrase: 'warehouse123',
  });

  // Получаем PEM-форматированный ключ
  const keyPem = result.toPEM('sec').toString('utf8');

  // Для сертификата нужен отдельный метод — PFX содержит только приватный ключ в createPrivateKey
  // Используем альтернативный подход: читаем cert.crt который уже экспортирован ранее
  if (fs.existsSync(path.join(certsDir, 'cert.crt'))) {
    const certPem = fs.readFileSync(path.join(certsDir, 'cert.crt'), 'utf8');

    fs.writeFileSync(path.join(certsDir, 'key.pem'), keyPem);
    fs.writeFileSync(path.join(certsDir, 'cert.pem'), certPem);

    console.log('✅ PEM файлы созданы:');
    console.log('   certs/key.pem  — приватный ключ');
    console.log('   certs/cert.pem — сертификат');
  } else {
    console.error('❌ Нет cert.crt. Сначала экспортируйте сертификат.');
    process.exit(1);
  }
} catch (err) {
  console.error('❌ Ошибка конвертации:', err.message);
  process.exit(1);
}

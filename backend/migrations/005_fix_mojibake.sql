-- 005_fix_mojibake.sql
-- Исправляем mojibake в collector_profiles и boxes
-- mojibake: UTF-8 байты были записаны как Windows-1251 при INSERT

-- Показываем что нужно исправить
SELECT 'collector_profiles' as tbl, employee_id, full_name 
FROM collector_profiles 
WHERE full_name ~ '[\x0400-\x04FF]';

SELECT 'boxes' as tbl, collector_id, collector_full_name
FROM boxes 
WHERE collector_full_name ~ '[\x0400-\x04FF]';

-- ============================================================
-- ВАЖНО: mojibake нельзя исправить в SQL без iconv!
-- Нужно установить node-iconv и запустить fix скрипт:
-- ============================================================
-- npm i iconv-lite
-- node backend/scripts/fix_mojibake.js

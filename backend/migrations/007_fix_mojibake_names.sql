-- 007_fix_mojibake_names.sql
-- Исправление mojibake в full_name collector_profiles и name в brain_items/separate_items/boxes

-- 1. collector_profiles.full_name (UTF-8 байты сохранены как WIN1251)
UPDATE collector_profiles 
SET full_name = CONVERT(full_name FROM win1251 TO utf8)
WHERE full_name IS NOT NULL;

-- 2. brain_items.name, brand, model
UPDATE brain_items SET name = CONVERT(name FROM win1251 TO utf8) WHERE name IS NOT NULL AND name != CONVERT(CONVERT(name FROM win1251 TO utf8) FROM utf8 TO win1251);
UPDATE brain_items SET brand = CONVERT(brand FROM win1251 TO utf8) WHERE brand IS NOT NULL;
UPDATE brain_items SET model = CONVERT(model FROM win1251 TO utf8) WHERE model IS NOT NULL;

-- 3. separate_items.name, brand, model
UPDATE separate_items SET name = CONVERT(name FROM win1251 TO utf8) WHERE name IS NOT NULL AND name != CONVERT(CONVERT(name FROM win1251 TO utf8) FROM utf8 TO win1251);
UPDATE separate_items SET brand = CONVERT(brand FROM win1251 TO utf8) WHERE brand IS NOT NULL;
UPDATE separate_items SET model = CONVERT(model FROM win1251 TO utf8) WHERE model IS NOT NULL;

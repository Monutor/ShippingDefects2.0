-- 007_fix_mojibake_names.sql
-- Исправление mojibake в full_name collector_profiles и name в brain_items/separate_items/boxes
-- PostgreSQL: convert_to(col, 'LATIN1') -> bytes, convert_from(bytes, 'UTF8') -> correct text

-- 1. collector_profiles.full_name
UPDATE collector_profiles
SET full_name = convert_from(convert_to(full_name, 'LATIN1'), 'UTF8')
WHERE full_name IS NOT NULL;

-- 2. brain_items.name, brand, model
UPDATE brain_items SET name = convert_from(convert_to(name, 'LATIN1'), 'UTF8') WHERE name IS NOT NULL AND name != convert_from(convert_to(convert_from(convert_to(name, 'LATIN1'), 'UTF8'), 'LATIN1'), 'UTF8');
UPDATE brain_items SET brand = convert_from(convert_to(brand, 'LATIN1'), 'UTF8') WHERE brand IS NOT NULL;
UPDATE brain_items SET model = convert_from(convert_to(model, 'LATIN1'), 'UTF8') WHERE model IS NOT NULL;

-- 3. separate_items.name, brand, model
UPDATE separate_items SET name = convert_from(convert_to(name, 'LATIN1'), 'UTF8') WHERE name IS NOT NULL AND name != convert_from(convert_to(convert_from(convert_to(name, 'LATIN1'), 'UTF8'), 'LATIN1'), 'UTF8');
UPDATE separate_items SET brand = convert_from(convert_to(brand, 'LATIN1'), 'UTF8') WHERE brand IS NOT NULL;
UPDATE separate_items SET model = convert_from(convert_to(model, 'LATIN1'), 'UTF8') WHERE model IS NOT NULL;

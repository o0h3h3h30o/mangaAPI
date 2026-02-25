-- Migration: Cleanup unused tables and columns
-- Date: 2026-02-25
--
-- BEFORE RUNNING: Backup your database!
--   mysqldump -u root -p manga > manga_backup_$(date +%Y%m%d).sql
--
-- Tables dropped:
--   genres, manga_genres — code uses category/category_manga instead
--
-- Columns dropped from manga:
--   title        — redundant with `name`
--   description  — code uses `summary`
--   cover_image  — code uses `cover`
--   author       — code uses author/author_manga tables
--   artist       — code uses author/author_manga tables
--   status (enum)— code uses `status_id`
--   type (enum)  — never referenced in any query

-- =====================================================
-- 1. Drop unused tables
-- =====================================================
DROP TABLE IF EXISTS manga_genres;
DROP TABLE IF EXISTS genres;

-- =====================================================
-- 2. Drop unused columns from manga table
-- =====================================================
ALTER TABLE manga DROP COLUMN IF EXISTS title;
ALTER TABLE manga DROP COLUMN IF EXISTS description;
ALTER TABLE manga DROP COLUMN IF EXISTS cover_image;
ALTER TABLE manga DROP COLUMN IF EXISTS author;
ALTER TABLE manga DROP COLUMN IF EXISTS artist;
ALTER TABLE manga DROP COLUMN IF EXISTS status;
ALTER TABLE manga DROP COLUMN IF EXISTS type;

-- =====================================================
-- 3. Drop related indexes (if they exist)
-- =====================================================
ALTER TABLE manga DROP INDEX IF EXISTS idx_title;
ALTER TABLE manga DROP INDEX IF EXISTS idx_status;

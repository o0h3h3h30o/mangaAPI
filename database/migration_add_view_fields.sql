-- Migration to add view tracking fields to existing manga table
-- Run this if you already have a manga table without view_day, view_week, view_month fields

USE manga;

-- Add new columns if they don't exist
ALTER TABLE manga 
ADD COLUMN IF NOT EXISTS name VARCHAR(255) NOT NULL AFTER id,
ADD COLUMN IF NOT EXISTS view_day INT DEFAULT 0 AFTER views,
ADD COLUMN IF NOT EXISTS view_week INT DEFAULT 0 AFTER view_day,
ADD COLUMN IF NOT EXISTS view_month INT DEFAULT 0 AFTER view_week;

-- Add indexes for better query performance
ALTER TABLE manga
ADD INDEX IF NOT EXISTS idx_view_day (view_day),
ADD INDEX IF NOT EXISTS idx_view_week (view_week),
ADD INDEX IF NOT EXISTS idx_view_month (view_month);

-- Update existing records to set name = title if name is empty
UPDATE manga SET name = title WHERE name = '' OR name IS NULL;

-- Optional: Update with sample view data
UPDATE manga SET 
  view_day = FLOOR(views * 0.03),
  view_week = FLOOR(views * 0.18),
  view_month = FLOOR(views * 0.65)
WHERE view_day = 0;

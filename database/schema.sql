-- Manga database schema (matches production)
CREATE DATABASE IF NOT EXISTS manga CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE manga;

-- =====================================================
-- Core tables
-- =====================================================

CREATE TABLE IF NOT EXISTS manga (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE,
  new_slug VARCHAR(255),
  summary TEXT,
  otherNames VARCHAR(255),
  cover VARCHAR(500),
  status_id INT DEFAULT 1,                -- 1=ongoing, 2=completed
  is_public TINYINT(1) DEFAULT 1,
  hot TINYINT(1) DEFAULT 0,
  is_new TINYINT(1) DEFAULT 0,
  caution TINYINT(1) DEFAULT 0,
  views INT DEFAULT 0,
  view_day INT DEFAULT 0,
  view_week INT DEFAULT 0,
  view_month INT DEFAULT 0,
  rating DECIMAL(3,2) DEFAULT 0.00,
  chapter_1 VARCHAR(255),                 -- denormalized latest chapter number
  chap_1_slug VARCHAR(255),
  time_chap_1 INT,
  flag_chap_1 TINYINT(1),
  chapter_2 VARCHAR(255),                 -- denormalized 2nd latest chapter
  chap_2_slug VARCHAR(255),
  time_chap_2 INT,
  flag_chap_2 TINYINT(1),
  from_manga18fx TEXT,                    -- source URLs (comma-separated)
  create_at INT,                          -- unix timestamp
  update_at INT,                          -- unix timestamp
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_slug (slug),
  INDEX idx_view_day (view_day),
  INDEX idx_view_week (view_week),
  INDEX idx_view_month (view_month),
  INDEX idx_public_update (is_public, update_at),
  INDEX idx_public_id (is_public, id),
  INDEX idx_public_views (is_public, views),
  INDEX idx_public_viewday (is_public, view_day),
  INDEX idx_public_viewmonth (is_public, view_month),
  FULLTEXT INDEX ft_manga_search (name, otherNames)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chapter (
  id INT PRIMARY KEY AUTO_INCREMENT,
  manga_id INT NOT NULL,
  name VARCHAR(255),
  slug VARCHAR(255),
  number DECIMAL(10,2) NOT NULL DEFAULT 0,
  view INT DEFAULT 0,
  is_show TINYINT(1) DEFAULT 1,
  source_url VARCHAR(500),
  is_crawling TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE,
  INDEX idx_manga_show (manga_id, is_show),
  INDEX idx_manga_slug (manga_id, slug, is_show),
  UNIQUE KEY unique_manga_chapter (manga_id, number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS page (
  id INT PRIMARY KEY AUTO_INCREMENT,
  chapter_id INT NOT NULL,
  slug VARCHAR(255),
  image VARCHAR(500),
  external TINYINT(1) DEFAULT 0,
  image_local VARCHAR(500),
  FOREIGN KEY (chapter_id) REFERENCES chapter(id) ON DELETE CASCADE,
  INDEX idx_chapter (chapter_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- Category (genres)
-- =====================================================

CREATE TABLE IF NOT EXISTS category (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  show_home TINYINT(1) DEFAULT 0,
  jp_name VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS category_manga (
  category_id INT NOT NULL,
  manga_id INT NOT NULL,
  FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES category(id) ON DELETE CASCADE,
  INDEX idx_category (category_id, manga_id),
  INDEX idx_manga (manga_id, category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- Author / Artist
-- =====================================================

CREATE TABLE IF NOT EXISTS author (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS author_manga (
  author_id INT NOT NULL,
  manga_id INT NOT NULL,
  type INT DEFAULT 1,  -- 1=author, 2=artist
  FOREIGN KEY (author_id) REFERENCES author(id) ON DELETE CASCADE,
  FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE,
  INDEX idx_manga (manga_id, author_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- Tags
-- =====================================================

CREATE TABLE IF NOT EXISTS tag (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL UNIQUE,
  slug VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS manga_tag (
  tag_id INT NOT NULL,
  manga_id INT NOT NULL,
  FOREIGN KEY (tag_id) REFERENCES tag(id) ON DELETE CASCADE,
  FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- Users & Auth
-- =====================================================

CREATE TABLE IF NOT EXISTS users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255),
  username VARCHAR(255) UNIQUE,
  email VARCHAR(255) UNIQUE,
  password VARCHAR(255),
  active TINYINT(1) DEFAULT 1,
  last_login TIMESTAMP,
  ip_address VARCHAR(45),
  created_on INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `groups` (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users_groups (
  user_id INT NOT NULL,
  group_id INT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- User features
-- =====================================================

CREATE TABLE IF NOT EXISTS bookmarks (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  manga_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE,
  UNIQUE INDEX idx_user_manga (user_id, manga_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS comments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  comment TEXT,
  post_id INT NOT NULL,
  post_type ENUM('manga', 'chapter'),
  manga_id INT,
  user_id INT,
  parent_comment INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (manga_id) REFERENCES manga(id),
  INDEX idx_manga (manga_id, parent_comment),
  INDEX idx_post (post_id, post_type, parent_comment),
  INDEX idx_parent (parent_comment),
  INDEX idx_user_created (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS item_ratings (
  id INT PRIMARY KEY AUTO_INCREMENT,
  item_id INT NOT NULL,
  score INT,
  ip_address VARCHAR(45),
  added_on TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (item_id) REFERENCES manga(id) ON DELETE CASCADE,
  INDEX idx_item_ip (item_id, ip_address)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- Lookup tables
-- =====================================================

CREATE TABLE IF NOT EXISTS comictype (
  id INT PRIMARY KEY AUTO_INCREMENT,
  label VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- Default data
-- =====================================================

INSERT INTO `groups` (name) VALUES ('admin'), ('members')
ON DUPLICATE KEY UPDATE name=name;

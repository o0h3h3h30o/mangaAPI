-- Create manga database
CREATE DATABASE IF NOT EXISTS manga CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE manga;

-- Create manga table
CREATE TABLE IF NOT EXISTS manga (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE,
  description TEXT,
  cover_image VARCHAR(500),
  author VARCHAR(255),
  artist VARCHAR(255),
  status ENUM('ongoing', 'completed', 'hiatus', 'cancelled') DEFAULT 'ongoing',
  type ENUM('manga', 'manhwa', 'manhua', 'comic') DEFAULT 'manga',
  views INT DEFAULT 0,
  view_day INT DEFAULT 0,
  view_week INT DEFAULT 0,
  view_month INT DEFAULT 0,
  rating DECIMAL(3,2) DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_title (title),
  INDEX idx_status (status),
  INDEX idx_updated_at (updated_at),
  INDEX idx_view_day (view_day),
  INDEX idx_view_week (view_week),
  INDEX idx_view_month (view_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create genres table
CREATE TABLE IF NOT EXISTS genres (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL UNIQUE,
  slug VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create manga_genres junction table
CREATE TABLE IF NOT EXISTS manga_genres (
  manga_id INT NOT NULL,
  genre_id INT NOT NULL,
  PRIMARY KEY (manga_id, genre_id),
  FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE,
  FOREIGN KEY (genre_id) REFERENCES genres(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create chapters table
CREATE TABLE IF NOT EXISTS chapters (
  id INT PRIMARY KEY AUTO_INCREMENT,
  manga_id INT NOT NULL,
  chapter_number DECIMAL(10,2) NOT NULL,
  title VARCHAR(255),
  slug VARCHAR(255),
  views INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE,
  INDEX idx_manga_id (manga_id),
  INDEX idx_chapter_number (chapter_number),
  INDEX idx_updated_at (updated_at),
  UNIQUE KEY unique_manga_chapter (manga_id, chapter_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert sample genres
INSERT INTO genres (name, slug, description) VALUES
('Action', 'action', 'Action-packed stories with intense battles'),
('Adventure', 'adventure', 'Exciting journeys and exploration'),
('Comedy', 'comedy', 'Humorous and funny stories'),
('Drama', 'drama', 'Emotional and dramatic narratives'),
('Fantasy', 'fantasy', 'Magical and fantastical worlds'),
('Romance', 'romance', 'Love stories and relationships'),
('Sci-Fi', 'sci-fi', 'Science fiction and futuristic themes'),
('Slice of Life', 'slice-of-life', 'Everyday life stories'),
('Supernatural', 'supernatural', 'Paranormal and supernatural elements'),
('Thriller', 'thriller', 'Suspenseful and thrilling plots')
ON DUPLICATE KEY UPDATE name=name;

-- Insert sample manga data
INSERT INTO manga (name, title, slug, description, author, artist, status, type, views, view_day, view_week, view_month, rating) VALUES
('One Piece', 'One Piece', 'one-piece', 'The story follows the adventures of Monkey D. Luffy, a boy whose body gained the properties of rubber after unintentionally eating a Devil Fruit.', 'Eiichiro Oda', 'Eiichiro Oda', 'ongoing', 'manga', 1500000, 45000, 280000, 950000, 4.85),
('Naruto', 'Naruto', 'naruto', 'The story follows Naruto Uzumaki, a young ninja who seeks recognition from his peers and dreams of becoming the Hokage.', 'Masashi Kishimoto', 'Masashi Kishimoto', 'completed', 'manga', 1200000, 32000, 210000, 780000, 4.75),
('Attack on Titan', 'Attack on Titan', 'attack-on-titan', 'In a world where humanity lives inside cities surrounded by enormous walls due to the Titans, gigantic humanoid creatures.', 'Hajime Isayama', 'Hajime Isayama', 'completed', 'manga', 980000, 28000, 185000, 650000, 4.80),
('My Hero Academia', 'My Hero Academia', 'my-hero-academia', 'In a world where people with superpowers are the norm, Izuku Midoriya dreams of becoming a hero despite being born without powers.', 'Kohei Horikoshi', 'Kohei Horikoshi', 'ongoing', 'manga', 850000, 38000, 245000, 720000, 4.70),
('Demon Slayer', 'Demon Slayer', 'demon-slayer', 'A family is attacked by demons and only two members survive - Tanjiro and his sister Nezuko, who is turning into a demon.', 'Koyoharu Gotouge', 'Koyoharu Gotouge', 'completed', 'manga', 920000, 41000, 265000, 810000, 4.78)
ON DUPLICATE KEY UPDATE title=title;

-- Link manga with genres
INSERT INTO manga_genres (manga_id, genre_id) VALUES
(1, 1), (1, 2), (1, 3), (1, 5),  -- One Piece: Action, Adventure, Comedy, Fantasy
(2, 1), (2, 2), (2, 4),          -- Naruto: Action, Adventure, Drama
(3, 1), (3, 4), (3, 5),          -- Attack on Titan: Action, Drama, Fantasy
(4, 1), (4, 3), (4, 9),          -- My Hero Academia: Action, Comedy, Supernatural
(5, 1), (5, 4), (5, 9)           -- Demon Slayer: Action, Drama, Supernatural
ON DUPLICATE KEY UPDATE manga_id=manga_id;

-- Insert sample chapters
INSERT INTO chapters (manga_id, chapter_number, title) VALUES
(1, 1, 'Romance Dawn'),
(1, 2, 'They Call Him "Straw Hat Luffy"'),
(1, 3, 'Enter Pirate Hunter Roronoa Zoro'),
(2, 1, 'Uzumaki Naruto!'),
(2, 2, 'Konohamaru!!'),
(3, 1, 'To You, 2,000 Years From Now'),
(3, 2, 'That Day'),
(4, 1, 'Izuku Midoriya: Origin'),
(4, 2, 'Roaring Muscles'),
(5, 1, 'Cruelty'),
(5, 2, 'Stranger')
ON DUPLICATE KEY UPDATE title=title;

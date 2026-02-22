-- ============================================================
-- Performance Indexes for Manga API
-- Run this script on your MySQL database to add missing indexes
-- ============================================================

-- manga table
CREATE INDEX idx_manga_slug ON manga(slug);
CREATE INDEX idx_manga_public_update ON manga(is_public, update_at);
CREATE INDEX idx_manga_public_id ON manga(is_public, id);
CREATE INDEX idx_manga_public_views ON manga(is_public, views);
CREATE INDEX idx_manga_public_viewday ON manga(is_public, view_day);
CREATE INDEX idx_manga_public_viewmonth ON manga(is_public, view_month);

-- chapter table
CREATE INDEX idx_chapter_manga_show ON chapter(manga_id, is_show);
CREATE INDEX idx_chapter_manga_slug ON chapter(manga_id, slug, is_show);

-- junction tables
CREATE INDEX idx_catmanga_category ON category_manga(category_id, manga_id);
CREATE INDEX idx_catmanga_manga ON category_manga(manga_id, category_id);
CREATE INDEX idx_authormanga_manga ON author_manga(manga_id, author_id);

-- category table
CREATE INDEX idx_category_slug ON category(slug);

-- item_ratings table
CREATE INDEX idx_ratings_item_ip ON item_ratings(item_id, ip_address);

-- page table (chapter images)
CREATE INDEX idx_page_chapter ON page(chapter_id);

-- comments table
CREATE INDEX idx_comments_manga ON comments(manga_id, parent_comment);
CREATE INDEX idx_comments_post ON comments(post_id, post_type, parent_comment);
CREATE INDEX idx_comments_parent ON comments(parent_comment);
CREATE INDEX idx_comments_user_created ON comments(user_id, created_at);

-- bookmarks table
CREATE UNIQUE INDEX idx_bookmarks_user_manga ON bookmarks(user_id, manga_id);

-- FULLTEXT index for search (MySQL >= 5.6 InnoDB)
ALTER TABLE manga ADD FULLTEXT INDEX ft_manga_search (name, otherNames);

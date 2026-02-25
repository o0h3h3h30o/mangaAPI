-- mangaraw4u Database Structure + Admin User
-- Generated: 2026-02-25T08:05:31.394Z

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `author`;
CREATE TABLE `author` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `slug` varchar(100) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

DROP TABLE IF EXISTS `author_manga`;
CREATE TABLE `author_manga` (
  `manga_id` int(10) unsigned NOT NULL,
  `author_id` int(10) unsigned NOT NULL,
  `type` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`manga_id`,`author_id`,`type`),
  KEY `author_manga_author_id_foreign` (`author_id`),
  CONSTRAINT `author_manga_author_id_foreign` FOREIGN KEY (`author_id`) REFERENCES `author` (`id`) ON DELETE CASCADE,
  CONSTRAINT `author_manga_manga_id_foreign` FOREIGN KEY (`manga_id`) REFERENCES `manga` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

DROP TABLE IF EXISTS `bookmarks`;
CREATE TABLE `bookmarks` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `manga_id` int(10) unsigned NOT NULL,
  `user_id` int(10) unsigned NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `bookmarks_manga_id_foreign` (`manga_id`),
  KEY `bookmarks_user_id_foreign` (`user_id`),
  CONSTRAINT `bookmarks_manga_id_foreign` FOREIGN KEY (`manga_id`) REFERENCES `manga` (`id`) ON DELETE CASCADE,
  CONSTRAINT `bookmarks_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

DROP TABLE IF EXISTS `category`;
CREATE TABLE `category` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `slug` varchar(255) NOT NULL,
  `name` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `show_home` tinyint(1) NOT NULL DEFAULT 0,
  `jp_name` varchar(256) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `category_slug_unique` (`slug`)
) ENGINE=InnoDB AUTO_INCREMENT=154 DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

DROP TABLE IF EXISTS `category_manga`;
CREATE TABLE `category_manga` (
  `manga_id` int(10) unsigned NOT NULL,
  `category_id` int(10) unsigned NOT NULL,
  PRIMARY KEY (`manga_id`,`category_id`),
  KEY `category_manga_category_id_foreign` (`category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

DROP TABLE IF EXISTS `chapter`;
CREATE TABLE `chapter` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `slug` varchar(255) DEFAULT NULL,
  `name` varchar(255) DEFAULT NULL,
  `number` decimal(10,2) NOT NULL DEFAULT 0.00,
  `manga_id` int(10) unsigned NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `view` int(11) NOT NULL DEFAULT 0,
  `is_show` tinyint(4) NOT NULL DEFAULT 0,
  `is_crawling` tinyint(1) NOT NULL DEFAULT 0,
  `source_url` varchar(500) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `chapter_manga_id_foreign` (`manga_id`),
  CONSTRAINT `chapter_manga_id_foreign` FOREIGN KEY (`manga_id`) REFERENCES `manga` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=273164 DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

DROP TABLE IF EXISTS `comictype`;
CREATE TABLE `comictype` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `label` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

DROP TABLE IF EXISTS `comments`;
CREATE TABLE `comments` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `comment` text DEFAULT NULL,
  `post_id` int(10) unsigned DEFAULT NULL,
  `post_type` varchar(255) DEFAULT NULL,
  `manga_id` int(11) DEFAULT NULL,
  `user_id` int(10) unsigned NOT NULL,
  `parent_comment` int(10) unsigned DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `comments_user_id_foreign` (`user_id`),
  KEY `comments_parent_comment_foreign` (`parent_comment`),
  KEY `idx_manga_comments` (`manga_id`,`parent_comment`,`created_at`),
  CONSTRAINT `comments_parent_comment_foreign` FOREIGN KEY (`parent_comment`) REFERENCES `comments` (`id`) ON DELETE SET NULL,
  CONSTRAINT `comments_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=41 DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

DROP TABLE IF EXISTS `groups`;
CREATE TABLE `groups` (
  `id` mediumint(8) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(20) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

DROP TABLE IF EXISTS `item_ratings`;
CREATE TABLE `item_ratings` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `item_id` int(11) NOT NULL,
  `score` tinyint(4) NOT NULL DEFAULT 1,
  `added_on` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `ip_address` varchar(255) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `item_ratings_item_id_index` (`item_id`),
  KEY `item_ratings_ip_address_index` (`ip_address`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

DROP TABLE IF EXISTS `manga`;
CREATE TABLE `manga` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `slug` varchar(512) DEFAULT NULL,
  `name` varchar(255) DEFAULT NULL,
  `otherNames` varchar(1000) DEFAULT NULL,
  `summary` text DEFAULT NULL,
  `cover` tinyint(1) DEFAULT NULL,
  `hot` tinyint(1) DEFAULT NULL,
  `caution` tinyint(1) DEFAULT 0,
  `views` int(11) DEFAULT 0,
  `status_id` int(10) unsigned DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `is_new` tinyint(2) DEFAULT 0,
  `is_public` tinyint(1) NOT NULL DEFAULT 0,
  `new_slug` varchar(256) DEFAULT NULL,
  `chapter_1` float NOT NULL DEFAULT 0,
  `chap_1_slug` varchar(256) DEFAULT NULL,
  `time_chap_1` int(11) NOT NULL DEFAULT 0,
  `chapter_2` float NOT NULL DEFAULT 0,
  `chap_2_slug` varchar(256) DEFAULT NULL,
  `time_chap_2` int(11) NOT NULL DEFAULT 0,
  `create_at` int(11) NOT NULL DEFAULT 0,
  `update_at` int(11) NOT NULL DEFAULT 0,
  `view_day` int(11) DEFAULT NULL,
  `view_week` int(11) DEFAULT 0,
  `view_month` int(11) DEFAULT NULL,
  `rating` float(8,2) DEFAULT NULL,
  `from_manga18fx` varchar(500) DEFAULT NULL,
  `flag_chap_1` varchar(10) DEFAULT 'spain',
  `flag_chap_2` varchar(10) DEFAULT 'spain',
  PRIMARY KEY (`id`),
  KEY `manga_slug_index` (`slug`),
  KEY `manga_status_id_foreign` (`status_id`)
) ENGINE=InnoDB AUTO_INCREMENT=7399 DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

DROP TABLE IF EXISTS `manga_tag`;
CREATE TABLE `manga_tag` (
  `manga_id` int(10) unsigned NOT NULL,
  `tag_id` int(10) unsigned NOT NULL,
  PRIMARY KEY (`manga_id`,`tag_id`),
  KEY `manga_tag_tag_id_foreign` (`tag_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

DROP TABLE IF EXISTS `page`;
CREATE TABLE `page` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `slug` int(11) NOT NULL,
  `image` varchar(255) DEFAULT NULL,
  `external` tinyint(1) NOT NULL DEFAULT 0,
  `chapter_id` int(10) unsigned NOT NULL,
  `image_local` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `page_chapter_id_foreign` (`chapter_id`)
) ENGINE=InnoDB AUTO_INCREMENT=6324177 DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

DROP TABLE IF EXISTS `tag`;
CREATE TABLE `tag` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(255) DEFAULT NULL,
  `username` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `last_login` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `ip_address` varchar(45) NOT NULL,
  `created_on` int(11) unsigned NOT NULL,
  `active` tinyint(1) unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_username_unique` (`username`),
  UNIQUE KEY `users_email_unique` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=2697 DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

DROP TABLE IF EXISTS `users_groups`;
CREATE TABLE `users_groups` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(11) unsigned NOT NULL,
  `group_id` mediumint(8) unsigned NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uc_users_groups` (`user_id`,`group_id`),
  KEY `fk_users_groups_users1_idx` (`user_id`),
  KEY `fk_users_groups_groups1_idx` (`group_id`),
  CONSTRAINT `fk_users_groups_groups1` FOREIGN KEY (`group_id`) REFERENCES `groups` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT `fk_users_groups_users1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=322 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- Admin user
INSERT INTO `users` (`id`, `name`, `username`, `email`, `password`, `last_login`, `created_at`, `updated_at`, `ip_address`, `created_on`, `active`) VALUES ('1', 'Administrator', 'admin', 'anhnh220892@gmail.com', '$2b$10$67oaYWHE9X/uFdksuX63Ueblx7dZuc4tuZP5VLdcZkexnyg/41.uG', '2026-02-25 07:10:03', '2020-09-04 10:51:51', '2023-05-17 09:06:50', '', '0', '1');

INSERT INTO `groups` (`id`, `name`) VALUES ('1', 'admin');
INSERT INTO `groups` (`id`, `name`) VALUES ('2', 'members');

INSERT INTO `users_groups` (`id`, `user_id`, `group_id`) VALUES ('318', '1', '1');

SET FOREIGN_KEY_CHECKS = 1;

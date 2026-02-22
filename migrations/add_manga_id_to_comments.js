/**
 * Migration: Add manga_id column to comments table
 *
 * This allows querying all comments for a manga (type=all) with a simple
 * WHERE manga_id = ? instead of OR clause across post_type='manga' + all chapter IDs.
 *
 * Usage: node migrations/add_manga_id_to_comments.js
 */

require('dotenv').config();
const db = require('../config/database');

async function migrate() {
    console.log('Starting migration: add manga_id to comments...');

    // 1. Check if column already exists
    const [columns] = await db.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'comments' AND COLUMN_NAME = 'manga_id'`,
        [process.env.DB_NAME]
    );

    if (columns.length > 0) {
        console.log('Column manga_id already exists, skipping ALTER TABLE.');
    } else {
        // 2. Add manga_id column (nullable initially for safe migration)
        await db.query('ALTER TABLE comments ADD COLUMN manga_id INT NULL AFTER post_type');
        console.log('Added manga_id column.');
    }

    // 3. Populate manga_id for manga-level comments (post_type = 'manga', post_id = manga.id)
    const [mangaResult] = await db.query(
        `UPDATE comments c
         INNER JOIN manga m ON m.id = c.post_id
         SET c.manga_id = m.id
         WHERE c.post_type = 'manga' AND c.manga_id IS NULL`
    );
    console.log(`Updated ${mangaResult.affectedRows} manga-level comments.`);

    // 4. Populate manga_id for chapter-level comments (post_type = 'chapter', post_id = chapter.id)
    const [chapterResult] = await db.query(
        `UPDATE comments c
         INNER JOIN chapter ch ON ch.id = c.post_id
         SET c.manga_id = ch.manga_id
         WHERE c.post_type = 'chapter' AND c.manga_id IS NULL`
    );
    console.log(`Updated ${chapterResult.affectedRows} chapter-level comments.`);

    // 5. Add index for fast queries
    const [indexes] = await db.query(
        `SHOW INDEX FROM comments WHERE Key_name = 'idx_manga_comments'`
    );
    if (indexes.length === 0) {
        await db.query(
            'ALTER TABLE comments ADD INDEX idx_manga_comments (manga_id, parent_comment, created_at)'
        );
        console.log('Added composite index idx_manga_comments.');
    } else {
        console.log('Index idx_manga_comments already exists, skipping.');
    }

    // 6. Verify
    const [nullCount] = await db.query(
        'SELECT COUNT(*) as cnt FROM comments WHERE manga_id IS NULL'
    );
    console.log(`Comments with NULL manga_id: ${nullCount[0].cnt}`);

    console.log('Migration complete!');
    process.exit(0);
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});

const db = require('../config/database');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { cacheDelPrefix } = require('../config/cache');

// Upload directories
const PUBLIC_DIR = process.env.UPLOAD_BASE_DIR || path.join(__dirname, '../../public');
const COVER_DIR = process.env.COVER_SAVE_DIR || process.env.COVER_UPLOAD_DIR || path.join(PUBLIC_DIR, 'cover');

const coverStorage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        fs.mkdirSync(COVER_DIR, { recursive: true });
        cb(null, COVER_DIR);
    },
    filename: (req, _file, cb) => {
        // Will be renamed after we know the slug
        cb(null, `tmp_${Date.now()}.jpg`);
    },
});

exports.uploadCover = multer({
    storage: coverStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (_req, file, cb) => {
        if (/^image\/(jpeg|jpg|png|webp)$/.test(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only JPEG, PNG, WebP images are allowed'));
        }
    },
}).single('cover');

// Chapter pages upload config (temp dir, renamed after)
const PAGES_TMP_DIR = path.join(PUBLIC_DIR, 'tmp_pages');

exports.uploadPages = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
            fs.mkdirSync(PAGES_TMP_DIR, { recursive: true });
            cb(null, PAGES_TMP_DIR);
        },
        filename: (_req, _file, cb) => {
            cb(null, `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
        },
    }),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
    fileFilter: (_req, file, cb) => {
        if (/^image\/(jpeg|jpg|png|webp)$/.test(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only JPEG, PNG, WebP images are allowed'));
        }
    },
}).array('pages', 100);

// GET /api/admin/stats
exports.getStats = async (req, res) => {
    try {
        const [[mangaCount], [chapterCount], [userCount], [commentCount]] = await Promise.all([
            db.query('SELECT COUNT(*) as total FROM manga'),
            db.query('SELECT COUNT(*) as total FROM chapter'),
            db.query('SELECT COUNT(*) as total FROM users WHERE active = 1'),
            db.query('SELECT COUNT(*) as total FROM comments'),
        ]);
        res.json({
            success: true,
            data: {
                total_manga: mangaCount[0].total,
                total_chapters: chapterCount[0].total,
                total_users: userCount[0].total,
                total_comments: commentCount[0].total,
            }
        });
    } catch (error) {
        console.error('Admin getStats error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch stats' });
    }
};

// GET /api/admin/manga
exports.listMangas = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.per_page) || 20;
        const q = req.query.q || '';
        const offset = (page - 1) * perPage;

        let whereClause = '';
        const params = [];
        if (q) {
            whereClause = 'WHERE m.name LIKE ?';
            params.push(`%${q}%`);
        }

        const [[{ total }]] = await db.query(
            `SELECT COUNT(*) as total FROM manga m ${whereClause}`,
            params
        );

        const [rows] = await db.query(
            `SELECT m.id, m.name, m.slug, m.status_id as status, m.is_public, m.views, m.hot,
                    m.created_at, m.update_at,
                    (SELECT COUNT(*) FROM chapter c WHERE c.manga_id = m.id) as chapter_count
             FROM manga m ${whereClause}
             ORDER BY m.id DESC LIMIT ? OFFSET ?`,
            [...params, perPage, offset]
        );

        res.json({
            success: true,
            data: rows,
            meta: {
                pagination: {
                    current_page: page,
                    last_page: Math.ceil(total / perPage),
                    per_page: perPage,
                    total,
                }
            }
        });
    } catch (error) {
        console.error('Admin listMangas error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch mangas' });
    }
};

// GET /api/admin/manga/:id (detail for edit)
exports.getManga = async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await db.query(
            `SELECT id, name, slug, new_slug, summary, status_id, is_public,
                    hot, caution, views, rating, otherNames, from_manga18fx
             FROM manga WHERE id = ?`,
            [id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Manga not found' });
        }
        const manga = rows[0];

        const [[catRows], [authorRows]] = await Promise.all([
            db.query(
                `SELECT c.id, c.name, c.slug FROM category c
                 JOIN category_manga cm ON c.id = cm.category_id
                 WHERE cm.manga_id = ?`,
                [id]
            ),
            db.query(
                `SELECT a.id, a.name, a.slug, am.type FROM author a
                 JOIN author_manga am ON a.id = am.author_id
                 WHERE am.manga_id = ?`,
                [id]
            ),
        ]);

        manga.categories = catRows;
        manga.authors = authorRows.filter(a => a.type === 1).map(({ type, ...rest }) => rest);
        manga.artists = authorRows.filter(a => a.type === 2).map(({ type, ...rest }) => rest);

        res.json({ success: true, data: manga });
    } catch (error) {
        console.error('Admin getManga error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch manga' });
    }
};

// GET /api/admin/authors
exports.listAuthors = async (req, res) => {
    try {
        const q = req.query.q || '';
        let whereClause = '';
        const params = [];
        if (q) {
            whereClause = 'WHERE name LIKE ?';
            params.push(`%${q}%`);
        }
        const [rows] = await db.query(
            `SELECT id, name, slug FROM author ${whereClause} ORDER BY name ASC LIMIT 500`,
            params
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Admin listAuthors error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch authors' });
    }
};

// POST /api/admin/manga
exports.createManga = async (req, res) => {
    try {
        const { name, slug, summary, otherNames, from_manga18fx, status_id, is_public, hot, caution, category_ids, author_ids, artist_ids } = req.body;
        if (!name || !slug) {
            return res.status(400).json({ success: false, error: 'Name and slug are required' });
        }

        const [result] = await db.query(
            `INSERT INTO manga (name, slug, new_slug, summary, otherNames, from_manga18fx, status_id, is_public, hot, caution, created_at, update_at, create_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), UNIX_TIMESTAMP(), UNIX_TIMESTAMP())`,
            [name, slug, slug, summary || '', otherNames || '', from_manga18fx || '', status_id || 1, is_public ?? 1, hot || 0, caution || 0]
        );

        const mangaId = result.insertId;

        // Insert category relations
        if (Array.isArray(category_ids) && category_ids.length > 0) {
            const catValues = category_ids.map(cid => [cid, mangaId]);
            await db.query('INSERT INTO category_manga (category_id, manga_id) VALUES ?', [catValues]);
        }

        // Insert author/artist relations
        const authorEntries = [];
        if (Array.isArray(author_ids)) author_ids.forEach(aid => authorEntries.push([aid, mangaId, 1]));
        if (Array.isArray(artist_ids)) artist_ids.forEach(aid => authorEntries.push([aid, mangaId, 2]));
        if (authorEntries.length > 0) {
            await db.query('INSERT INTO author_manga (author_id, manga_id, type) VALUES ?', [authorEntries]);
        }

        res.status(201).json({
            success: true,
            data: { id: mangaId, name, slug }
        });
    } catch (error) {
        console.error('Admin createManga error:', error);
        res.status(500).json({ success: false, error: 'Failed to create manga' });
    }
};

// PUT /api/admin/manga/:id
exports.updateManga = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, slug, summary, otherNames, from_manga18fx, status_id, is_public, hot, caution, category_ids, author_ids, artist_ids } = req.body;

        const fields = [];
        const params = [];
        if (name !== undefined) { fields.push('name = ?'); params.push(name); }
        if (slug !== undefined) { fields.push('slug = ?'); params.push(slug); fields.push('new_slug = ?'); params.push(slug); }
        if (summary !== undefined) { fields.push('summary = ?'); params.push(summary); }
        if (otherNames !== undefined) { fields.push('otherNames = ?'); params.push(otherNames); }
        if (from_manga18fx !== undefined) { fields.push('from_manga18fx = ?'); params.push(from_manga18fx); }
        if (status_id !== undefined) { fields.push('status_id = ?'); params.push(status_id); }
        if (is_public !== undefined) { fields.push('is_public = ?'); params.push(is_public); }
        if (hot !== undefined) { fields.push('hot = ?'); params.push(hot); }
        if (caution !== undefined) { fields.push('caution = ?'); params.push(caution); }

        if (fields.length > 0) {
            fields.push('update_at = UNIX_TIMESTAMP()');
            params.push(id);
            await db.query(`UPDATE manga SET ${fields.join(', ')} WHERE id = ?`, params);
        }

        // Sync categories
        if (Array.isArray(category_ids)) {
            await db.query('DELETE FROM category_manga WHERE manga_id = ?', [id]);
            if (category_ids.length > 0) {
                const catValues = category_ids.map(cid => [cid, id]);
                await db.query('INSERT INTO category_manga (category_id, manga_id) VALUES ?', [catValues]);
            }
        }

        // Sync authors & artists
        if (Array.isArray(author_ids) || Array.isArray(artist_ids)) {
            await db.query('DELETE FROM author_manga WHERE manga_id = ?', [id]);
            const entries = [];
            if (Array.isArray(author_ids)) author_ids.forEach(aid => entries.push([aid, id, 1]));
            if (Array.isArray(artist_ids)) artist_ids.forEach(aid => entries.push([aid, id, 2]));
            if (entries.length > 0) {
                await db.query('INSERT INTO author_manga (author_id, manga_id, type) VALUES ?', [entries]);
            }
        }

        res.json({ success: true, message: 'Manga updated' });
    } catch (error) {
        console.error('Admin updateManga error:', error);
        res.status(500).json({ success: false, error: 'Failed to update manga' });
    }
};

// DELETE /api/admin/manga/:id
exports.deleteManga = async (req, res) => {
    try {
        const { id } = req.params;

        // Delete related data first
        const [chapters] = await db.query('SELECT id FROM chapter WHERE manga_id = ?', [id]);
        if (chapters.length > 0) {
            const chapterIds = chapters.map(c => c.id);
            await db.query(`DELETE FROM page WHERE chapter_id IN (?)`, [chapterIds]);
            await db.query('DELETE FROM chapter WHERE manga_id = ?', [id]);
        }
        await db.query('DELETE FROM category_manga WHERE manga_id = ?', [id]);
        await db.query('DELETE FROM comments WHERE manga_id = ?', [id]);
        await db.query('DELETE FROM bookmarks WHERE manga_id = ?', [id]);
        await db.query('DELETE FROM manga WHERE id = ?', [id]);

        res.json({ success: true, message: 'Manga deleted' });
    } catch (error) {
        console.error('Admin deleteManga error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete manga' });
    }
};

// GET /api/admin/manga/:id/chapters
exports.listChapters = async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await db.query(
            `SELECT c.id, c.name, c.slug, c.number, c.view, c.is_show, c.source_url, c.is_crawling, c.created_at
             FROM chapter c WHERE c.manga_id = ? ORDER BY CAST(c.number AS DECIMAL(10,2)) ASC, c.id ASC`,
            [id]
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Admin listChapters error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch chapters' });
    }
};

// DELETE /api/admin/chapters/:id
exports.deleteChapter = async (req, res) => {
    try {
        const { id } = req.params;
        await db.query('DELETE FROM page WHERE chapter_id = ?', [id]);
        await db.query('DELETE FROM chapter WHERE id = ?', [id]);
        res.json({ success: true, message: 'Chapter deleted' });
    } catch (error) {
        console.error('Admin deleteChapter error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete chapter' });
    }
};

// GET /api/admin/users
exports.listUsers = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.per_page) || 20;
        const offset = (page - 1) * perPage;

        const [[{ total }]] = await db.query('SELECT COUNT(*) as total FROM users');
        const [rows] = await db.query(
            `SELECT u.id, COALESCE(u.name, u.username) as name, u.username, u.email,
                    CAST(COALESCE(u.active, 0) AS UNSIGNED) as status, u.last_login,
                    COALESCE(u.created_at, FROM_UNIXTIME(NULLIF(u.created_on, 0))) as created_at,
                    CASE WHEN EXISTS (
                        SELECT 1 FROM users_groups ug
                        JOIN \`groups\` g ON g.id = ug.group_id
                        WHERE ug.user_id = u.id AND g.name = 'admin'
                    ) THEN 'admin' ELSE 'user' END as role
             FROM users u
             ORDER BY u.id DESC LIMIT ? OFFSET ?`,
            [perPage, offset]
        );

        res.json({
            success: true,
            data: rows,
            meta: {
                pagination: {
                    current_page: page,
                    last_page: Math.ceil(total / perPage),
                    per_page: perPage,
                    total,
                }
            }
        });
    } catch (error) {
        console.error('Admin listUsers error:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to fetch users' });
    }
};

// PUT /api/admin/users/:id
exports.updateUser = async (req, res) => {
    try {
        const { id } = req.params;
        const { role, status, name, email, password } = req.body;

        // Prevent admin from demoting themselves
        if (parseInt(id) === req.user.id && role && role !== 'admin') {
            return res.status(400).json({ success: false, error: 'Cannot change your own role' });
        }

        // Update role via users_groups table
        if (role !== undefined) {
            // Get admin group id
            const [[adminGroup]] = await db.query("SELECT id FROM `groups` WHERE name = 'admin' LIMIT 1");
            const [[memberGroup]] = await db.query("SELECT id FROM `groups` WHERE name = 'members' LIMIT 1");
            if (role === 'admin' && adminGroup) {
                // Remove existing group assignments, add admin
                await db.query('DELETE FROM users_groups WHERE user_id = ?', [id]);
                await db.query('INSERT INTO users_groups (user_id, group_id) VALUES (?, ?)', [id, adminGroup.id]);
            } else if (memberGroup) {
                // Remove existing group assignments, add member
                await db.query('DELETE FROM users_groups WHERE user_id = ?', [id]);
                await db.query('INSERT INTO users_groups (user_id, group_id) VALUES (?, ?)', [id, memberGroup.id]);
            }
        }

        // Update users table fields
        const fields = [];
        const params = [];
        if (status !== undefined) { fields.push('active = ?'); params.push(status); }
        if (name !== undefined) { fields.push('name = ?'); params.push(name); }
        if (email !== undefined) { fields.push('email = ?'); params.push(email); }
        if (password) {
            const hashed = await bcrypt.hash(password, 10);
            fields.push('password = ?');
            params.push(hashed);
        }

        if (fields.length > 0) {
            fields.push('updated_at = NOW()');
            params.push(id);
            await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);
        }

        res.json({ success: true, message: 'User updated' });
    } catch (error) {
        console.error('Admin updateUser error:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to update user' });
    }
};

// DELETE /api/admin/users/:id (soft delete)
exports.deleteUser = async (req, res) => {
    try {
        const { id } = req.params;

        if (parseInt(id) === req.user.id) {
            return res.status(400).json({ success: false, error: 'Cannot delete yourself' });
        }

        await db.query('UPDATE users SET active = 0, updated_at = NOW() WHERE id = ?', [id]);
        res.json({ success: true, message: 'User deactivated' });
    } catch (error) {
        console.error('Admin deleteUser error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete user' });
    }
};

// GET /api/admin/comments
exports.listComments = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.per_page) || 20;
        const offset = (page - 1) * perPage;

        const [[{ total }]] = await db.query('SELECT COUNT(*) as total FROM comments');
        const [rows] = await db.query(
            `SELECT c.id, c.comment as content, c.user_id, c.manga_id, c.created_at,
                    u.name as user_name, m.name as manga_name
             FROM comments c
             LEFT JOIN users u ON c.user_id = u.id
             LEFT JOIN manga m ON c.manga_id = m.id
             ORDER BY c.id DESC LIMIT ? OFFSET ?`,
            [perPage, offset]
        );

        res.json({
            success: true,
            data: rows,
            meta: {
                pagination: {
                    current_page: page,
                    last_page: Math.ceil(total / perPage),
                    per_page: perPage,
                    total,
                }
            }
        });
    } catch (error) {
        console.error('Admin listComments error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch comments' });
    }
};

// DELETE /api/admin/comments/:id
exports.deleteComment = async (req, res) => {
    try {
        const { id } = req.params;
        await db.query('DELETE FROM comments WHERE id = ?', [id]);
        res.json({ success: true, message: 'Comment deleted' });
    } catch (error) {
        console.error('Admin deleteComment error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete comment' });
    }
};

// POST /api/admin/manga/:id/cover
exports.uploadMangaCover = async (req, res) => {
    try {
        const { id } = req.params;
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        // Get manga slug
        const [rows] = await db.query('SELECT slug FROM manga WHERE id = ?', [id]);
        if (rows.length === 0) {
            fs.unlinkSync(req.file.path);
            return res.status(404).json({ success: false, error: 'Manga not found' });
        }

        const slug = rows[0].slug;
        const finalPath = path.join(COVER_DIR, `${slug}.jpg`);

        // Remove old cover if exists
        if (fs.existsSync(finalPath)) {
            fs.unlinkSync(finalPath);
        }

        // Rename temp file to slug.jpg
        fs.renameSync(req.file.path, finalPath);

        res.json({
            success: true,
            data: { url: `/cover/${slug}.jpg` },
        });
    } catch (error) {
        // Clean up temp file on error
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        console.error('Admin uploadMangaCover error:', error);
        res.status(500).json({ success: false, error: 'Failed to upload cover' });
    }
};

// POST /api/admin/manga/:id/chapters
exports.createChapter = async (req, res) => {
    try {
        const mangaId = req.params.id;
        const { name, slug, number, is_show, source_url, is_crawling } = req.body;
        if (!name || !slug) {
            return res.status(400).json({ success: false, error: 'Name and slug are required' });
        }

        const [result] = await db.query(
            `INSERT INTO chapter (manga_id, name, slug, number, is_show, view, source_url, is_crawling, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 0, ?, ?, NOW(), NOW())`,
            [mangaId, name, slug, number || '0', is_show ?? 1, source_url || '', is_crawling ?? 0]
        );

        // Update manga update_at
        await db.query('UPDATE manga SET update_at = UNIX_TIMESTAMP() WHERE id = ?', [mangaId]);

        res.status(201).json({
            success: true,
            data: { id: result.insertId, name, slug }
        });
    } catch (error) {
        console.error('Admin createChapter error:', error);
        res.status(500).json({ success: false, error: 'Failed to create chapter' });
    }
};

// Sync manga's denormalized latest chapter fields (chapter_1, chap_1_slug, time_chap_1)
async function syncMangaLatestChapter(mangaId) {
    const [rows] = await db.query(
        `SELECT number, slug, created_at FROM chapter
         WHERE manga_id = ? AND is_show = 1
         ORDER BY CAST(number AS DECIMAL(10,2)) DESC, id DESC LIMIT 1`,
        [mangaId]
    );
    if (rows.length > 0) {
        const ch = rows[0];
        await db.query(
            `UPDATE manga SET chapter_1 = ?, chap_1_slug = ?, time_chap_1 = UNIX_TIMESTAMP(), update_at = UNIX_TIMESTAMP() WHERE id = ?`,
            [parseFloat(ch.number) || 0, ch.slug, mangaId]
        );
    } else {
        await db.query(
            `UPDATE manga SET chapter_1 = NULL, chap_1_slug = NULL, time_chap_1 = NULL, update_at = UNIX_TIMESTAMP() WHERE id = ?`,
            [mangaId]
        );
    }

    // Get manga slug to invalidate caches
    const [[manga]] = await db.query('SELECT slug FROM manga WHERE id = ?', [mangaId]);
    if (manga) {
        cacheDelPrefix(`manga:detail:${manga.slug}`);
        cacheDelPrefix(`chapters:${manga.slug}`);
    }
    cacheDelPrefix('newest:');
    cacheDelPrefix('hotNewReleases:');
    cacheDelPrefix('browse:');
}

// PUT /api/admin/chapters/:id
exports.updateChapter = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, slug, number, is_show, source_url, is_crawling } = req.body;

        const fields = [];
        const params = [];
        if (name !== undefined) { fields.push('name = ?'); params.push(name); }
        if (slug !== undefined) { fields.push('slug = ?'); params.push(slug); }
        if (number !== undefined) { fields.push('number = ?'); params.push(number); }
        if (is_show !== undefined) { fields.push('is_show = ?'); params.push(is_show); }
        if (source_url !== undefined) { fields.push('source_url = ?'); params.push(source_url); }
        if (is_crawling !== undefined) { fields.push('is_crawling = ?'); params.push(is_crawling); }

        if (fields.length === 0) {
            return res.status(400).json({ success: false, error: 'No fields to update' });
        }

        params.push(id);
        await db.query(`UPDATE chapter SET ${fields.join(', ')} WHERE id = ?`, params);

        // When is_show changes, sync manga's latest chapter info
        if (is_show !== undefined) {
            const [[chRow]] = await db.query('SELECT manga_id FROM chapter WHERE id = ?', [id]);
            if (chRow) {
                await syncMangaLatestChapter(chRow.manga_id);
            }
        }

        res.json({ success: true, message: 'Chapter updated' });
    } catch (error) {
        console.error('Admin updateChapter error:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to update chapter' });
    }
};

// GET /api/admin/chapters/:id/pages
exports.getChapterPages = async (req, res) => {
    try {
        const { id } = req.params;

        // Get chapter + manga slug
        const [chRows] = await db.query(
            `SELECT c.slug as chapter_slug, m.slug as manga_slug
             FROM chapter c JOIN manga m ON c.manga_id = m.id
             WHERE c.id = ?`,
            [id]
        );
        if (chRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Chapter not found' });
        }

        const [pages] = await db.query(
            'SELECT id, slug, image, external FROM page WHERE chapter_id = ? ORDER BY slug ASC',
            [id]
        );

        res.json({
            success: true,
            data: {
                pages,
                manga_slug: chRows[0].manga_slug,
                chapter_slug: chRows[0].chapter_slug,
            }
        });
    } catch (error) {
        console.error('Admin getChapterPages error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch pages' });
    }
};

// POST /api/admin/chapters/:id/pages
exports.uploadChapterPages = async (req, res) => {
    try {
        const { id } = req.params;
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, error: 'No files uploaded' });
        }

        // Get chapter + manga slug
        const [chRows] = await db.query(
            `SELECT c.slug as chapter_slug, m.slug as manga_slug
             FROM chapter c JOIN manga m ON c.manga_id = m.id
             WHERE c.id = ?`,
            [id]
        );
        if (chRows.length === 0) {
            req.files.forEach(f => fs.existsSync(f.path) && fs.unlinkSync(f.path));
            return res.status(404).json({ success: false, error: 'Chapter not found' });
        }

        const { manga_slug, chapter_slug } = chRows[0];
        const destDir = path.join(PUBLIC_DIR, 'manga', manga_slug, 'chapters', chapter_slug);
        fs.mkdirSync(destDir, { recursive: true });

        // Get current max page number
        const [[{ maxSlug }]] = await db.query(
            'SELECT COALESCE(MAX(CAST(slug AS UNSIGNED)), 0) as maxSlug FROM page WHERE chapter_id = ?',
            [id]
        );

        let nextNum = maxSlug + 1;
        const insertValues = [];

        for (const file of req.files) {
            const pageSlug = String(nextNum).padStart(3, '0');
            const fileName = `${pageSlug}.jpg`;
            const finalPath = path.join(destDir, fileName);

            fs.renameSync(file.path, finalPath);
            insertValues.push([id, pageSlug, fileName, 0]);
            nextNum++;
        }

        if (insertValues.length > 0) {
            await db.query(
                'INSERT INTO page (chapter_id, slug, image, external) VALUES ?',
                [insertValues]
            );
        }

        res.json({
            success: true,
            data: { uploaded: insertValues.length, manga_slug, chapter_slug }
        });
    } catch (error) {
        // Clean up temp files
        if (req.files) {
            req.files.forEach(f => fs.existsSync(f.path) && fs.unlinkSync(f.path));
        }
        console.error('Admin uploadChapterPages error:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to upload pages' });
    }
};

// POST /api/admin/chapters/:id/pages/urls — add external image URLs
exports.addChapterPageUrls = async (req, res) => {
    try {
        const { id } = req.params;
        const { urls } = req.body; // string[] array of image URLs
        if (!Array.isArray(urls) || urls.length === 0) {
            return res.status(400).json({ success: false, error: 'No URLs provided' });
        }

        // Get current max page number
        const [[{ maxSlug }]] = await db.query(
            'SELECT COALESCE(MAX(CAST(slug AS UNSIGNED)), 0) as maxSlug FROM page WHERE chapter_id = ?',
            [id]
        );

        let nextNum = maxSlug + 1;
        const insertValues = [];

        for (const url of urls) {
            const trimmed = url.trim();
            if (!trimmed) continue;
            const pageSlug = String(nextNum).padStart(3, '0');
            insertValues.push([id, pageSlug, trimmed, 1]); // external = 1
            nextNum++;
        }

        if (insertValues.length === 0) {
            return res.status(400).json({ success: false, error: 'No valid URLs' });
        }

        await db.query(
            'INSERT INTO page (chapter_id, slug, image, external) VALUES ?',
            [insertValues]
        );

        res.json({
            success: true,
            data: { added: insertValues.length }
        });
    } catch (error) {
        console.error('Admin addChapterPageUrls error:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to add page URLs' });
    }
};

// DELETE /api/admin/pages/:id
exports.deleteChapterPage = async (req, res) => {
    try {
        const { id } = req.params;

        // Get page info + paths
        const [rows] = await db.query(
            `SELECT p.image, p.external, c.slug as chapter_slug, m.slug as manga_slug
             FROM page p
             JOIN chapter c ON p.chapter_id = c.id
             JOIN manga m ON c.manga_id = m.id
             WHERE p.id = ?`,
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Page not found' });
        }

        const page = rows[0];

        // Delete file if local
        if (page.external === 0) {
            const filePath = path.join(PUBLIC_DIR, 'manga', page.manga_slug, 'chapters', page.chapter_slug, page.image);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        await db.query('DELETE FROM page WHERE id = ?', [id]);
        res.json({ success: true, message: 'Page deleted' });
    } catch (error) {
        console.error('Admin deleteChapterPage error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete page' });
    }
};

// POST /api/admin/pages/bulk-delete — delete multiple pages
exports.bulkDeletePages = async (req, res) => {
    try {
        const { ids } = req.body; // number[]
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, error: 'No page IDs provided' });
        }

        // Get page info for local file cleanup
        const [rows] = await db.query(
            `SELECT p.id, p.image, p.external, c.slug as chapter_slug, m.slug as manga_slug
             FROM page p
             JOIN chapter c ON p.chapter_id = c.id
             JOIN manga m ON c.manga_id = m.id
             WHERE p.id IN (?)`,
            [ids]
        );

        // Delete local files
        for (const page of rows) {
            if (page.external === 0) {
                const filePath = path.join(PUBLIC_DIR, 'manga', page.manga_slug, 'chapters', page.chapter_slug, page.image);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }
        }

        await db.query('DELETE FROM page WHERE id IN (?)', [ids]);
        res.json({ success: true, message: `Deleted ${rows.length} pages` });
    } catch (error) {
        console.error('Admin bulkDeletePages error:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to delete pages' });
    }
};

// ===================== TAG CRUD =====================

// GET /api/admin/tags
exports.listTags = async (req, res) => {
    try {
        const q = req.query.q || '';
        let whereClause = '';
        const params = [];
        if (q) { whereClause = 'WHERE name LIKE ?'; params.push(`%${q}%`); }
        const [rows] = await db.query(`SELECT id, name, slug, created_at FROM tag ${whereClause} ORDER BY name ASC`, params);
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message || 'Failed to fetch tags' });
    }
};

// POST /api/admin/tags
exports.createTag = async (req, res) => {
    try {
        const { name, slug } = req.body;
        if (!name || !slug) return res.status(400).json({ success: false, error: 'Name and slug are required' });
        const [result] = await db.query('INSERT INTO tag (name, slug, created_at, updated_at) VALUES (?, ?, NOW(), NOW())', [name, slug]);
        res.status(201).json({ success: true, data: { id: result.insertId, name, slug } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message || 'Failed to create tag' });
    }
};

// PUT /api/admin/tags/:id
exports.updateTag = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, slug } = req.body;
        const fields = []; const params = [];
        if (name !== undefined) { fields.push('name = ?'); params.push(name); }
        if (slug !== undefined) { fields.push('slug = ?'); params.push(slug); }
        if (fields.length === 0) return res.status(400).json({ success: false, error: 'No fields to update' });
        fields.push('updated_at = NOW()');
        params.push(id);
        await db.query(`UPDATE tag SET ${fields.join(', ')} WHERE id = ?`, params);
        res.json({ success: true, message: 'Tag updated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message || 'Failed to update tag' });
    }
};

// DELETE /api/admin/tags/:id
exports.deleteTag = async (req, res) => {
    try {
        const { id } = req.params;
        await db.query('DELETE FROM manga_tag WHERE tag_id = ?', [id]);
        await db.query('DELETE FROM tag WHERE id = ?', [id]);
        res.json({ success: true, message: 'Tag deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message || 'Failed to delete tag' });
    }
};

// ===================== CATEGORY CRUD =====================

// GET /api/admin/categories
exports.listCategories = async (req, res) => {
    try {
        const q = req.query.q || '';
        let whereClause = '';
        const params = [];
        if (q) { whereClause = 'WHERE name LIKE ?'; params.push(`%${q}%`); }
        const [rows] = await db.query(`SELECT id, name, slug, show_home, jp_name, created_at FROM category ${whereClause} ORDER BY name ASC`, params);
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message || 'Failed to fetch categories' });
    }
};

// POST /api/admin/categories
exports.createCategory = async (req, res) => {
    try {
        const { name, slug, show_home, jp_name } = req.body;
        if (!name || !slug) return res.status(400).json({ success: false, error: 'Name and slug are required' });
        const [result] = await db.query(
            'INSERT INTO category (name, slug, show_home, jp_name, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
            [name, slug, show_home || 0, jp_name || null]
        );
        res.status(201).json({ success: true, data: { id: result.insertId, name, slug } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message || 'Failed to create category' });
    }
};

// PUT /api/admin/categories/:id
exports.updateCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, slug, show_home, jp_name } = req.body;
        const fields = []; const params = [];
        if (name !== undefined) { fields.push('name = ?'); params.push(name); }
        if (slug !== undefined) { fields.push('slug = ?'); params.push(slug); }
        if (show_home !== undefined) { fields.push('show_home = ?'); params.push(show_home); }
        if (jp_name !== undefined) { fields.push('jp_name = ?'); params.push(jp_name); }
        if (fields.length === 0) return res.status(400).json({ success: false, error: 'No fields to update' });
        fields.push('updated_at = NOW()');
        params.push(id);
        await db.query(`UPDATE category SET ${fields.join(', ')} WHERE id = ?`, params);
        res.json({ success: true, message: 'Category updated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message || 'Failed to update category' });
    }
};

// DELETE /api/admin/categories/:id
exports.deleteCategory = async (req, res) => {
    try {
        const { id } = req.params;
        await db.query('DELETE FROM category_manga WHERE category_id = ?', [id]);
        await db.query('DELETE FROM category WHERE id = ?', [id]);
        res.json({ success: true, message: 'Category deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message || 'Failed to delete category' });
    }
};

// ===================== COMICTYPE CRUD =====================

// GET /api/admin/comictypes
exports.listComicTypes = async (req, res) => {
    try {
        const [rows] = await db.query('SELECT id, label, created_at FROM comictype ORDER BY id ASC');
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message || 'Failed to fetch comic types' });
    }
};

// POST /api/admin/comictypes
exports.createComicType = async (req, res) => {
    try {
        const { label } = req.body;
        if (!label) return res.status(400).json({ success: false, error: 'Label is required' });
        const [result] = await db.query('INSERT INTO comictype (label, created_at, updated_at) VALUES (?, NOW(), NOW())', [label]);
        res.status(201).json({ success: true, data: { id: result.insertId, label } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message || 'Failed to create comic type' });
    }
};

// PUT /api/admin/comictypes/:id
exports.updateComicType = async (req, res) => {
    try {
        const { id } = req.params;
        const { label } = req.body;
        if (!label) return res.status(400).json({ success: false, error: 'Label is required' });
        await db.query('UPDATE comictype SET label = ?, updated_at = NOW() WHERE id = ?', [label, id]);
        res.json({ success: true, message: 'Comic type updated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message || 'Failed to update comic type' });
    }
};

// DELETE /api/admin/comictypes/:id
exports.deleteComicType = async (req, res) => {
    try {
        const { id } = req.params;
        await db.query('DELETE FROM comictype WHERE id = ?', [id]);
        res.json({ success: true, message: 'Comic type deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message || 'Failed to delete comic type' });
    }
};

// ===================== AUTHOR CRUD =====================

// POST /api/admin/authors
exports.createAuthor = async (req, res) => {
    try {
        const { name, slug } = req.body;
        if (!name || !slug) return res.status(400).json({ success: false, error: 'Name and slug are required' });
        const [result] = await db.query('INSERT INTO author (name, slug, created_at, updated_at) VALUES (?, ?, NOW(), NOW())', [name, slug]);
        res.status(201).json({ success: true, data: { id: result.insertId, name, slug } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message || 'Failed to create author' });
    }
};

// PUT /api/admin/authors/:id
exports.updateAuthor = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, slug } = req.body;
        const fields = []; const params = [];
        if (name !== undefined) { fields.push('name = ?'); params.push(name); }
        if (slug !== undefined) { fields.push('slug = ?'); params.push(slug); }
        if (fields.length === 0) return res.status(400).json({ success: false, error: 'No fields to update' });
        fields.push('updated_at = NOW()');
        params.push(id);
        await db.query(`UPDATE author SET ${fields.join(', ')} WHERE id = ?`, params);
        res.json({ success: true, message: 'Author updated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message || 'Failed to update author' });
    }
};

// DELETE /api/admin/authors/:id
exports.deleteAuthor = async (req, res) => {
    try {
        const { id } = req.params;
        await db.query('DELETE FROM author_manga WHERE author_id = ?', [id]);
        await db.query('DELETE FROM author WHERE id = ?', [id]);
        res.json({ success: true, message: 'Author deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message || 'Failed to delete author' });
    }
};

// POST /api/admin/chapters/bulk-delete — delete multiple chapters
exports.bulkDeleteChapters = async (req, res) => {
    try {
        const { ids } = req.body; // number[]
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, error: 'No chapter IDs provided' });
        }

        // Delete pages for these chapters
        await db.query('DELETE FROM page WHERE chapter_id IN (?)', [ids]);
        // Delete chapters
        await db.query('DELETE FROM chapter WHERE id IN (?)', [ids]);

        res.json({ success: true, message: `Deleted ${ids.length} chapters` });
    } catch (error) {
        console.error('Admin bulkDeleteChapters error:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to delete chapters' });
    }
};

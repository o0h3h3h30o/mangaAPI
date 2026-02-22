const db = require('../config/database');

// Get user's bookmarks list (with manga info)
exports.getBookmarks = async (req, res) => {
    try {
        const userId = req.user.id;
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.per_page) || 20;
        const offset = (page - 1) * perPage;

        const [countResult] = await db.query(
            `SELECT COUNT(*) as total FROM bookmarks b
             INNER JOIN manga m ON m.id = b.manga_id
             WHERE b.user_id = ? AND m.is_public = 1`,
            [userId]
        );
        const total = countResult[0].total;
        const lastPage = Math.ceil(total / perPage) || 1;

        const [rows] = await db.query(
            `SELECT b.id as bookmark_id, b.created_at as favorited_at,
                m.id as manga_id, m.name as manga_name, m.slug as manga_slug,
                m.cover as manga_cover, m.hot, m.is_new,
                m.views, m.view_day, m.view_month, m.rating,
                m.chapter_1, m.chap_1_slug, m.time_chap_1
            FROM bookmarks b
            INNER JOIN manga m ON m.id = b.manga_id
            WHERE b.user_id = ? AND m.is_public = 1
            ORDER BY b.created_at DESC
            LIMIT ?, ?`,
            [userId, offset, perPage]
        );

        const favorites = rows.map(r => ({
            id: r.manga_id,
            uuid: String(r.manga_id),
            name: r.manga_name,
            slug: r.manga_slug,
            cover_full_url: `${process.env.COVER_CDN_URL}/cover/${r.manga_slug}.jpg`,
            is_hot: r.hot === 1,
            status: 1,
            views: r.views || 0,
            average_rating: parseFloat(r.rating) || 0,
            updated_at: r.time_chap_1 ? new Date(r.time_chap_1).toISOString() : new Date().toISOString(),
            latest_chapter: r.chapter_1 ? {
                id: 0,
                uuid: r.chap_1_slug || '',
                name: r.chapter_1,
                slug: r.chap_1_slug || '',
                created_at: r.time_chap_1 ? new Date(r.time_chap_1).toISOString() : '',
            } : undefined,
            favorited_at: r.favorited_at ? new Date(r.favorited_at).toISOString() : new Date().toISOString(),
        }));

        res.json({
            success: true,
            message: 'Success',
            data: favorites,
            meta: {
                pagination: {
                    current_page: page,
                    last_page: lastPage,
                    per_page: perPage,
                    total,
                    from: offset + 1,
                    to: Math.min(offset + perPage, total),
                }
            }
        });
    } catch (error) {
        console.error('Error fetching bookmarks:', error);
        res.status(500).json({ success: false, error: 'Error fetching bookmarks' });
    }
};

// Add bookmark
exports.addBookmark = async (req, res) => {
    try {
        const userId = req.user.id;
        const { manga_id } = req.body;

        if (!manga_id) {
            return res.status(400).json({ success: false, error: 'manga_id is required' });
        }

        // Check if manga exists
        const [mangaRows] = await db.query(
            'SELECT id, name, slug FROM manga WHERE id = ? AND is_public = 1',
            [manga_id]
        );
        if (mangaRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Manga not found' });
        }

        const manga = mangaRows[0];

        // Check if already bookmarked
        const [existing] = await db.query(
            'SELECT id FROM bookmarks WHERE user_id = ? AND manga_id = ?',
            [userId, manga_id]
        );

        if (existing.length > 0) {
            return res.json({
                success: true,
                manga: {
                    id: manga.id,
                    uuid: String(manga.id),
                    name: manga.name,
                    slug: manga.slug,
                    cover_full_url: `${process.env.COVER_CDN_URL}/cover/${manga.slug}.jpg`,
                },
                favorited: true,
            });
        }

        // Insert bookmark
        await db.query(
            'INSERT INTO bookmarks (user_id, manga_id, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
            [userId, manga_id]
        );

        res.json({
            success: true,
            manga: {
                id: manga.id,
                uuid: String(manga.id),
                name: manga.name,
                slug: manga.slug,
                cover_full_url: `${process.env.COVER_CDN_URL}/cover/${manga.slug}.jpg`,
            },
            favorited: true,
        });
    } catch (error) {
        console.error('Error adding bookmark:', error);
        res.status(500).json({ success: false, error: 'Error adding bookmark' });
    }
};

// Remove bookmark
exports.removeBookmark = async (req, res) => {
    try {
        const userId = req.user.id;
        const mangaId = parseInt(req.params.mangaId);

        await db.query(
            'DELETE FROM bookmarks WHERE user_id = ? AND manga_id = ?',
            [userId, mangaId]
        );

        res.json({
            success: true,
            manga_id: mangaId,
            favorited: false,
        });
    } catch (error) {
        console.error('Error removing bookmark:', error);
        res.status(500).json({ success: false, error: 'Error removing bookmark' });
    }
};

// Check bookmark status
exports.checkBookmarkStatus = async (req, res) => {
    try {
        const userId = req.user.id;
        const mangaId = parseInt(req.params.mangaId);

        const [rows] = await db.query(
            'SELECT id FROM bookmarks WHERE user_id = ? AND manga_id = ?',
            [userId, mangaId]
        );

        res.json({
            success: true,
            manga_id: mangaId,
            is_favorited: rows.length > 0,
        });
    } catch (error) {
        console.error('Error checking bookmark:', error);
        res.status(500).json({ success: false, error: 'Error checking bookmark status' });
    }
};

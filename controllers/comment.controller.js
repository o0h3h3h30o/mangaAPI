const db = require('../config/database');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth.middleware');

const CAPTCHA_COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes

// Generate simple math captcha
function generateCaptcha() {
    const a = Math.floor(Math.random() * 9) + 1;
    const b = Math.floor(Math.random() * 9) + 1;
    const answer = a + b;
    const question = `${a} + ${b} = ?`;
    const token = jwt.sign({ answer }, JWT_SECRET, { expiresIn: '5m' });
    return { question, token };
}

// Verify captcha token and answer
function verifyCaptcha(token, answer) {
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        return decoded.answer === parseInt(answer);
    } catch {
        return false;
    }
}

// Get comments for a manga (by slug)
// Supports ?type=manga (default, manga-level only) or ?type=all (manga + all chapters)
exports.getCommentsByManga = async (req, res) => {
    try {
        const { slug } = req.params;
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.per_page) || 10;
        const sort = req.query.sort === 'asc' ? 'ASC' : 'DESC';
        const type = req.query.type || 'manga'; // 'manga' or 'all'
        const offset = (page - 1) * perPage;

        // Get current user id from token (optional - for can_edit/can_delete)
        const currentUserId = req.user ? req.user.id : null;

        // Find manga by slug
        const [mangaRows] = await db.query(
            'SELECT id FROM manga WHERE slug = ? AND is_public = 1',
            [slug]
        );
        if (mangaRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Manga not found' });
        }
        const mangaId = mangaRows[0].id;

        // Build WHERE clause based on type
        let whereClause, whereParams;
        let chapterMap = {}; // chapterId -> chapterName for chapter_info

        if (type === 'all') {
            // Uses manga_id column + composite index for fast lookup
            whereClause = 'c.manga_id = ? AND c.parent_comment IS NULL';
            whereParams = [mangaId];

            // Load chapter names for chapter_info display
            const [chapters] = await db.query(
                'SELECT id, name FROM chapter WHERE manga_id = ?',
                [mangaId]
            );
            for (const ch of chapters) {
                chapterMap[ch.id] = ch.name;
            }
        } else {
            whereClause = 'c.post_id = ? AND c.post_type = ? AND c.parent_comment IS NULL';
            whereParams = [mangaId, 'manga'];
        }

        // Count top-level comments
        const [countResult] = await db.query(
            `SELECT COUNT(*) as total FROM comments c WHERE ${whereClause}`,
            whereParams
        );
        const total = countResult[0].total;
        const lastPage = Math.ceil(total / perPage) || 1;

        // Get top-level comments with user info
        const [topComments] = await db.query(
            `SELECT c.id, c.comment, c.post_id, c.post_type, c.user_id, c.parent_comment, c.created_at, c.updated_at,
                u.name as user_name, u.avatar as user_avatar, u.slug as user_slug
            FROM comments c
            LEFT JOIN users u ON u.id = c.user_id
            WHERE ${whereClause}
            ORDER BY c.created_at ${sort}
            LIMIT ?, ?`,
            [...whereParams, offset, perPage]
        );

        // Get all replies for these top-level comments
        const topIds = topComments.map(c => c.id);
        let repliesMap = {};
        if (topIds.length > 0) {
            const [replies] = await db.query(
                `SELECT c.id, c.comment, c.post_id, c.post_type, c.user_id, c.parent_comment, c.created_at, c.updated_at,
                    u.name as user_name, u.avatar as user_avatar, u.slug as user_slug
                FROM comments c
                LEFT JOIN users u ON u.id = c.user_id
                WHERE c.parent_comment IN (?)
                ORDER BY c.created_at ASC`,
                [topIds]
            );
            for (const reply of replies) {
                if (!repliesMap[reply.parent_comment]) {
                    repliesMap[reply.parent_comment] = [];
                }
                repliesMap[reply.parent_comment].push(mapComment(reply, currentUserId, [], null));
            }
        }

        // Map to frontend Comment type (with chapter_info for chapter comments)
        const comments = topComments.map(c => {
            const chapterInfo = c.post_type === 'chapter' && chapterMap[c.post_id]
                ? { name: chapterMap[c.post_id] }
                : null;
            return mapComment(c, currentUserId, repliesMap[c.id] || [], chapterInfo);
        });

        res.json({
            success: true,
            message: 'Success',
            data: comments,
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
        console.error('Error fetching comments:', error);
        res.status(500).json({ success: false, error: 'Error fetching comments' });
    }
};

// Add comment to manga
exports.addComment = async (req, res) => {
    try {
        const { slug } = req.params;
        const userId = req.user.id;
        const { content, parent_id, captcha_token, captcha_answer } = req.body;

        if (!content || !content.trim()) {
            return res.status(400).json({ success: false, error: 'Content is required' });
        }

        // Check if user commented recently (3 min cooldown → require captcha)
        const [recentRows] = await db.query(
            'SELECT created_at FROM comments WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
            [userId]
        );
        if (recentRows.length > 0) {
            const lastCommentTime = new Date(recentRows[0].created_at).getTime();
            const now = Date.now();
            if (now - lastCommentTime < CAPTCHA_COOLDOWN_MS) {
                // Need captcha
                if (!captcha_token || !captcha_answer) {
                    const captcha = generateCaptcha();
                    return res.status(429).json({
                        success: false,
                        captcha_required: true,
                        captcha,
                    });
                }
                // Verify captcha
                if (!verifyCaptcha(captcha_token, captcha_answer)) {
                    const captcha = generateCaptcha();
                    return res.status(429).json({
                        success: false,
                        captcha_required: true,
                        captcha,
                        error: 'Wrong answer, try again',
                    });
                }
            }
        }

        // Find manga by slug
        const [mangaRows] = await db.query(
            'SELECT id FROM manga WHERE slug = ? AND is_public = 1',
            [slug]
        );
        if (mangaRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Manga not found' });
        }
        const mangaId = mangaRows[0].id;

        // If replying, verify parent comment exists
        const parentId = parent_id ? parseInt(parent_id) : null;
        if (parentId) {
            const [parentRows] = await db.query(
                'SELECT id FROM comments WHERE id = ? AND post_id = ?',
                [parentId, mangaId]
            );
            if (parentRows.length === 0) {
                return res.status(404).json({ success: false, error: 'Parent comment not found' });
            }
        }

        // Insert comment (manga_id = mangaId for fast manga-wide queries)
        const [result] = await db.query(
            'INSERT INTO comments (comment, post_id, post_type, manga_id, user_id, parent_comment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())',
            [content.trim(), mangaId, 'manga', mangaId, userId, parentId]
        );

        // Fetch the created comment with user info
        const [rows] = await db.query(
            `SELECT c.id, c.comment, c.post_id, c.post_type, c.user_id, c.parent_comment, c.created_at, c.updated_at,
                u.name as user_name, u.avatar as user_avatar, u.slug as user_slug
            FROM comments c
            LEFT JOIN users u ON u.id = c.user_id
            WHERE c.id = ?`,
            [result.insertId]
        );

        if (rows.length === 0) {
            return res.status(500).json({ success: false, error: 'Failed to fetch created comment' });
        }

        res.json({
            success: true,
            data: mapComment(rows[0], userId, [], null),
        });
    } catch (error) {
        console.error('Error adding comment:', error);
        res.status(500).json({ success: false, error: 'Error adding comment' });
    }
};

// Update comment
exports.updateComment = async (req, res) => {
    try {
        const commentId = parseInt(req.params.id);
        const userId = req.user.id;
        const { content } = req.body;

        if (!content || !content.trim()) {
            return res.status(400).json({ success: false, error: 'Content is required' });
        }

        // Check comment exists and belongs to user
        const [existing] = await db.query(
            'SELECT id, user_id FROM comments WHERE id = ?',
            [commentId]
        );
        if (existing.length === 0) {
            return res.status(404).json({ success: false, error: 'Comment not found' });
        }
        if (existing[0].user_id !== userId) {
            return res.status(403).json({ success: false, error: 'Not authorized' });
        }

        await db.query(
            'UPDATE comments SET comment = ?, updated_at = NOW() WHERE id = ?',
            [content.trim(), commentId]
        );

        // Fetch updated comment
        const [rows] = await db.query(
            `SELECT c.id, c.comment, c.post_id, c.post_type, c.user_id, c.parent_comment, c.created_at, c.updated_at,
                u.name as user_name, u.avatar as user_avatar, u.slug as user_slug
            FROM comments c
            LEFT JOIN users u ON u.id = c.user_id
            WHERE c.id = ?`,
            [commentId]
        );

        res.json({
            success: true,
            data: mapComment(rows[0], userId, [], null),
        });
    } catch (error) {
        console.error('Error updating comment:', error);
        res.status(500).json({ success: false, error: 'Error updating comment' });
    }
};

// Delete comment
exports.deleteComment = async (req, res) => {
    try {
        const commentId = parseInt(req.params.id);
        const userId = req.user.id;

        // Check comment exists and belongs to user
        const [existing] = await db.query(
            'SELECT id, user_id FROM comments WHERE id = ?',
            [commentId]
        );
        if (existing.length === 0) {
            return res.status(404).json({ success: false, error: 'Comment not found' });
        }
        if (existing[0].user_id !== userId) {
            return res.status(403).json({ success: false, error: 'Not authorized' });
        }

        // Delete (FK cascade will set child parent_comment to NULL)
        await db.query('DELETE FROM comments WHERE id = ?', [commentId]);

        res.json({ success: true, message: 'Comment deleted' });
    } catch (error) {
        console.error('Error deleting comment:', error);
        res.status(500).json({ success: false, error: 'Error deleting comment' });
    }
};

// Get comments for a chapter (by manga slug + chapter slug)
exports.getCommentsByChapter = async (req, res) => {
    try {
        const { mangaSlug, chapterSlug } = req.params;
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.per_page) || 10;
        const sort = req.query.sort === 'asc' ? 'ASC' : 'DESC';
        const offset = (page - 1) * perPage;
        const currentUserId = req.user ? req.user.id : null;

        // Find chapter by manga slug + chapter slug
        const [chapterRows] = await db.query(
            `SELECT ch.id, ch.name FROM chapter ch
            INNER JOIN manga m ON m.id = ch.manga_id
            WHERE m.slug = ? AND ch.slug = ? AND m.is_public = 1`,
            [mangaSlug, chapterSlug]
        );
        if (chapterRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Chapter not found' });
        }
        const chapterId = chapterRows[0].id;
        const chapterName = chapterRows[0].name;

        // Count top-level comments
        const [countResult] = await db.query(
            'SELECT COUNT(*) as total FROM comments WHERE post_id = ? AND post_type = ? AND parent_comment IS NULL',
            [chapterId, 'chapter']
        );
        const total = countResult[0].total;
        const lastPage = Math.ceil(total / perPage) || 1;

        // Get top-level comments with user info
        const [topComments] = await db.query(
            `SELECT c.id, c.comment, c.post_id, c.post_type, c.user_id, c.parent_comment, c.created_at, c.updated_at,
                u.name as user_name, u.avatar as user_avatar, u.slug as user_slug
            FROM comments c
            LEFT JOIN users u ON u.id = c.user_id
            WHERE c.post_id = ? AND c.post_type = ? AND c.parent_comment IS NULL
            ORDER BY c.created_at ${sort}
            LIMIT ?, ?`,
            [chapterId, 'chapter', offset, perPage]
        );

        // Get all replies for these top-level comments
        const topIds = topComments.map(c => c.id);
        let repliesMap = {};
        if (topIds.length > 0) {
            const [replies] = await db.query(
                `SELECT c.id, c.comment, c.post_id, c.post_type, c.user_id, c.parent_comment, c.created_at, c.updated_at,
                    u.name as user_name, u.avatar as user_avatar, u.slug as user_slug
                FROM comments c
                LEFT JOIN users u ON u.id = c.user_id
                WHERE c.parent_comment IN (?)
                ORDER BY c.created_at ASC`,
                [topIds]
            );
            for (const reply of replies) {
                if (!repliesMap[reply.parent_comment]) {
                    repliesMap[reply.parent_comment] = [];
                }
                repliesMap[reply.parent_comment].push(mapComment(reply, currentUserId, [], null));
            }
        }

        const comments = topComments.map(c =>
            mapComment(c, currentUserId, repliesMap[c.id] || [], { name: chapterName })
        );

        res.json({
            success: true,
            message: 'Success',
            data: comments,
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
        console.error('Error fetching chapter comments:', error);
        res.status(500).json({ success: false, error: 'Error fetching comments' });
    }
};

// Add comment to chapter
exports.addCommentToChapter = async (req, res) => {
    try {
        const { mangaSlug, chapterSlug } = req.params;
        const userId = req.user.id;
        const { content, parent_id, captcha_token, captcha_answer } = req.body;

        if (!content || !content.trim()) {
            return res.status(400).json({ success: false, error: 'Content is required' });
        }

        // Captcha cooldown check (shared with manga comments)
        const [recentRows] = await db.query(
            'SELECT created_at FROM comments WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
            [userId]
        );
        if (recentRows.length > 0) {
            const lastCommentTime = new Date(recentRows[0].created_at).getTime();
            if (Date.now() - lastCommentTime < CAPTCHA_COOLDOWN_MS) {
                if (!captcha_token || !captcha_answer) {
                    return res.status(429).json({ success: false, captcha_required: true, captcha: generateCaptcha() });
                }
                if (!verifyCaptcha(captcha_token, captcha_answer)) {
                    return res.status(429).json({ success: false, captcha_required: true, captcha: generateCaptcha(), error: 'Wrong answer, try again' });
                }
            }
        }

        // Find chapter (also get manga_id for the manga_id column)
        const [chapterRows] = await db.query(
            `SELECT ch.id, ch.manga_id FROM chapter ch
            INNER JOIN manga m ON m.id = ch.manga_id
            WHERE m.slug = ? AND ch.slug = ? AND m.is_public = 1`,
            [mangaSlug, chapterSlug]
        );
        if (chapterRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Chapter not found' });
        }
        const chapterId = chapterRows[0].id;
        const mangaId = chapterRows[0].manga_id;

        // Verify parent comment if replying
        const parentId = parent_id ? parseInt(parent_id) : null;
        if (parentId) {
            const [parentRows] = await db.query(
                'SELECT id FROM comments WHERE id = ? AND post_id = ? AND post_type = ?',
                [parentId, chapterId, 'chapter']
            );
            if (parentRows.length === 0) {
                return res.status(404).json({ success: false, error: 'Parent comment not found' });
            }
        }

        // Insert (manga_id for fast manga-wide queries)
        const [result] = await db.query(
            'INSERT INTO comments (comment, post_id, post_type, manga_id, user_id, parent_comment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())',
            [content.trim(), chapterId, 'chapter', mangaId, userId, parentId]
        );

        // Fetch created comment
        const [rows] = await db.query(
            `SELECT c.id, c.comment, c.post_id, c.post_type, c.user_id, c.parent_comment, c.created_at, c.updated_at,
                u.name as user_name, u.avatar as user_avatar, u.slug as user_slug
            FROM comments c
            LEFT JOIN users u ON u.id = c.user_id
            WHERE c.id = ?`,
            [result.insertId]
        );

        res.json({
            success: true,
            data: mapComment(rows[0], userId, [], null),
        });
    } catch (error) {
        console.error('Error adding chapter comment:', error);
        res.status(500).json({ success: false, error: 'Error adding comment' });
    }
};

// Get recent comments across all mangas (for homepage sidebar)
exports.getRecentComments = async (req, res) => {
    try {
        const perPage = Math.min(parseInt(req.query.per_page) || 5, 20);

        const [rows] = await db.query(
            `SELECT c.id, c.comment, c.post_id, c.post_type, c.manga_id, c.user_id, c.parent_comment, c.created_at, c.updated_at,
                u.name as user_name, u.avatar as user_avatar, u.slug as user_slug,
                m.name as manga_name, m.slug as manga_slug,
                ch.name as chapter_name, ch.slug as chapter_slug
            FROM comments c
            LEFT JOIN users u ON u.id = c.user_id
            LEFT JOIN manga m ON m.id = c.manga_id
            LEFT JOIN chapter ch ON ch.id = c.post_id AND c.post_type = 'chapter'
            WHERE m.is_public = 1
            ORDER BY c.created_at DESC
            LIMIT ?`,
            [perPage]
        );

        const comments = rows.map(row => {
            const mapped = mapComment(row, null, [], null);
            // Add context for recent comments sidebar
            const isChapter = row.post_type === 'chapter';
            mapped.context = {
                type: isChapter ? 'chapter' : 'manga',
                text: isChapter
                    ? `${row.manga_name} - ${row.chapter_name}`
                    : row.manga_name,
                manga_slug: row.manga_slug || '',
                chapter_slug: isChapter ? (row.chapter_slug || null) : null,
                manga_id: row.manga_id,
                chapter_id: isChapter ? row.post_id : null,
            };
            return mapped;
        });

        res.json({
            success: true,
            message: 'Success',
            data: comments,
            meta: {
                pagination: {
                    current_page: 1,
                    last_page: 1,
                    per_page: perPage,
                    total: comments.length,
                    from: 1,
                    to: comments.length,
                }
            }
        });
    } catch (error) {
        console.error('Error fetching recent comments:', error);
        res.status(500).json({ success: false, error: 'Error fetching recent comments' });
    }
};

// Helper: map DB row to frontend Comment type
function mapComment(row, currentUserId, replies, chapterInfo) {
    const isChapter = row.post_type === 'chapter';
    return {
        id: String(row.id),
        uuid: null,
        content: row.comment || '',
        commentable_type: isChapter ? 'App\\Models\\Chapter' : 'App\\Models\\Manga',
        commentable_id: String(row.post_id),
        parent_id: row.parent_comment ? String(row.parent_comment) : null,
        created_at: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
        updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
        user: {
            id: row.user_id,
            uuid: String(row.user_id),
            name: row.user_name || 'Unknown',
            avatar_full_url: row.user_avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(row.user_name || 'U')}&background=random`,
        },
        chapter_info: chapterInfo || null,
        replies: replies,
        replies_count: replies.length,
        can_edit: currentUserId === row.user_id,
        can_delete: currentUserId === row.user_id,
    };
}

const db = require('../config/database');
const { cacheGet, cacheSet, cacheDel } = require('../config/cache');

// Decode HTML entities in strings (e.g. &amp; &#039; &quot;)
function decodeEntities(str) {
    if (!str) return str;
    return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

// Convert string to Title Case: "A WONDERFUL NEW WORLD" → "A Wonderful New World"
function toTitleCase(str) {
    if (!str) return str;
    return str.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
}

// Get manga by ID
exports.getMangaById = async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await db.query('SELECT * FROM manga WHERE id = ?', [id]);

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Manga not found'
            });
        }

        res.json({
            success: true,
            data: rows[0]
        });
    } catch (error) {
        console.error('Error fetching manga:', error);
        res.status(500).json({
            success: false,
            error: 'Error fetching manga data'
        });
    }
};

// Get latest manga
exports.getLatestManga = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const [rows] = await db.query(
            'SELECT * FROM manga ORDER BY updated_at DESC LIMIT ?',
            [limit]
        );

        res.json({
            success: true,
            data: rows
        });
    } catch (error) {
        console.error('Error fetching latest manga:', error);
        res.status(500).json({
            success: false,
            error: 'Error fetching latest manga'
        });
    }
};

// Search manga (cached 60s)
exports.searchManga = async (req, res) => {
    try {
        const { q } = req.query;
        const limit = parseInt(req.query.limit) || 10;

        if (!q) {
            return res.status(400).json({
                success: false,
                error: 'Search query is required'
            });
        }

        const cacheKey = `search:${q}:${limit}`;
        const cached = cacheGet(cacheKey);
        if (cached) return res.json(cached);

        const searchTerm = `%${q}%`;
        const [rows] = await db.query(
            `SELECT m.id as manga_id,
                m.name as manga_name,
                m.slug as manga_slug,
                m.cover as manga_cover,
                m.rating as average_rating,
                m.hot as hot,
                m.is_new as is_new,
                m.caution as caution,
                m.chapter_1 as chapter_1,
                m.chap_1_slug as chap_1_slug,
                m.time_chap_1 as time_chap_1,
                m.update_at as update_at
            FROM manga m
            WHERE m.is_public = 1
                AND (m.name LIKE ? OR m.otherNames LIKE ?)
            ORDER BY m.hot DESC, update_at DESC
            LIMIT ?`,
            [searchTerm, searchTerm, limit]
        );

        const data = rows.map(r => ({ ...r, manga_name: toTitleCase(decodeEntities(r.manga_name)) }));

        const response = { success: true, data };
        cacheSet(cacheKey, response, 60);
        res.json(response);
    } catch (error) {
        console.error('Error searching manga:', error);
        res.status(500).json({
            success: false,
            error: 'Error searching manga'
        });
    }
};

// Browse manga with filters, search, sort, pagination (cached 60s)
exports.browseManga = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.per_page) || 24;
        const offset = (page - 1) * perPage;
        const q = req.query.q || '';
        const status = req.query.status || '';
        const genre = req.query.genre || '';
        const author = req.query.author || '';
        const sort = req.query.sort || '-updated_at';

        const cacheKey = `browse:${page}:${perPage}:${q}:${status}:${genre}:${author}:${sort}`;
        const cached = cacheGet(cacheKey);
        if (cached) return res.json(cached);

        // Build dynamic WHERE/JOIN
        const conditions = ['m.is_public = 1'];
        const params = [];
        let joinClause = '';

        // Search by name or otherNames
        if (q) {
            const searchTerm = `%${q}%`;
            conditions.push('(m.name LIKE ? OR m.otherNames LIKE ?)');
            params.push(searchTerm, searchTerm);
        }

        // Filter by status
        if (status === '1') {
            conditions.push("m.status = 'ongoing'");
        } else if (status === '2') {
            conditions.push("m.status = 'completed'");
        }

        // Filter by genre (category slug)
        if (genre) {
            joinClause += ' INNER JOIN category_manga cm ON cm.manga_id = m.id INNER JOIN category c ON c.id = cm.category_id';
            conditions.push('c.slug = ?');
            params.push(genre);
        }

        // Filter by author/artist name
        if (author) {
            joinClause += ' INNER JOIN author_manga am ON am.manga_id = m.id INNER JOIN author a ON a.id = am.author_id';
            conditions.push('a.name = ?');
            params.push(author);
        }

        // Sort mapping
        let orderClause;
        switch (sort) {
            case '-views': orderClause = 'm.views DESC'; break;
            case '-rating': orderClause = 'm.rating DESC'; break;
            case 'name': orderClause = 'm.name ASC'; break;
            default: orderClause = 'm.update_at DESC'; break;
        }

        const whereStr = conditions.join(' AND ');
        const groupBy = joinClause ? 'GROUP BY m.id' : '';

        // Count total
        const [countResult] = await db.query(
            `SELECT COUNT(DISTINCT m.id) as total FROM manga m ${joinClause} WHERE ${whereStr}`,
            params
        );
        const total = countResult[0].total;
        const lastPage = Math.ceil(total / perPage) || 1;

        // Fetch rows
        const [rows] = await db.query(
            `SELECT m.id as manga_id,
                m.name as manga_name,
                m.slug as manga_slug,
                m.cover as manga_cover,
                m.hot as hot,
                m.is_new as is_new,
                m.caution as caution,
                m.rating as average_rating,
                m.chapter_1 as chapter_1,
                m.chap_1_slug as chap_1_slug,
                m.time_chap_1 as time_chap_1,
                m.update_at as update_at
            FROM manga m ${joinClause}
            WHERE ${whereStr}
            ${groupBy}
            ORDER BY ${orderClause}
            LIMIT ?, ?`,
            [...params, offset, perPage]
        );

        const response = {
            success: true,
            data: rows,
            meta: {
                pagination: {
                    current_page: page,
                    last_page: lastPage,
                    per_page: perPage,
                    total,
                    from: offset + 1,
                    to: Math.min(offset + perPage, total)
                }
            }
        };
        cacheSet(cacheKey, response, 60);
        res.json(response);
    } catch (error) {
        console.error('Error browsing manga:', error);
        res.status(500).json({ success: false, error: 'Error browsing manga' });
    }
};

// Get newest manga — cached 60s
exports.getNewestManga = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;

        const cacheKey = `newest:${limit}`;
        const cached = cacheGet(cacheKey);
        if (cached) return res.json(cached);

        const [rows] = await db.query(
            `SELECT m.id as manga_id, m.name as manga_name, m.slug as manga_slug,
                m.cover as manga_cover, m.hot, m.caution, m.rating as average_rating,
                m.views, m.chapter_1, m.chap_1_slug, m.time_chap_1,
                m.update_at
            FROM manga m
            WHERE m.is_public = 1
            ORDER BY m.id DESC
            LIMIT ?`,
            [limit]
        );

        const response = { success: true, data: rows };
        cacheSet(cacheKey, response, 60);
        res.json(response);
    } catch (error) {
        console.error('Error fetching newest manga:', error);
        res.status(500).json({ success: false, error: 'Error fetching newest manga' });
    }
};

// Get hot new releases — cached 60s
exports.getHotNewReleases = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.per_page) || 30;
        const offset = (page - 1) * perPage;

        const cacheKey = `hotNewReleases:${page}:${perPage}`;
        const cached = cacheGet(cacheKey);
        if (cached) return res.json(cached);

        // Count total for pagination
        const [countResult] = await db.query(
            'SELECT COUNT(*) as total FROM manga m WHERE m.is_public = 1'
        );
        const total = countResult[0].total;
        const lastPage = Math.ceil(total / perPage);

        const [rows] = await db.query(
            `SELECT m.id as manga_id,
                m.is_new as is_new,
                m.slug as manga_slug,
                m.cover as manga_cover,
                m.name as manga_name,
                m.hot as hot,
                m.caution as caution,
                m.rating as average_rating,
                m.chapter_1 as chapter_1,
                m.chapter_2 as chapter_2,
                m.chap_1_slug as chap_1_slug,
                m.chap_2_slug as chap_2_slug,
                m.time_chap_1 as time_chap_1,
                m.flag_chap_1 as flag_chap_1,
                m.flag_chap_2 as flag_chap_2,
                m.time_chap_2 as time_chap_2,
                m.update_at as update_at
            FROM manga m
            WHERE m.is_public = 1
            ORDER BY update_at DESC
            LIMIT ?, ?`,
            [offset, perPage]
        );

        const response = {
            success: true,
            data: rows,
            meta: {
                pagination: {
                    current_page: page,
                    last_page: lastPage,
                    per_page: perPage,
                    total,
                    from: offset + 1,
                    to: Math.min(offset + perPage, total)
                }
            }
        };
        cacheSet(cacheKey, response, 60);
        res.json(response);
    } catch (error) {
        console.error('Error fetching hot new releases:', error);
        res.status(500).json({
            success: false,
            error: 'Error fetching hot new releases'
        });
    }
};

// Get manga by category slug — cached 60s
exports.getMangaByCategory = async (req, res) => {
    try {
        const { slug } = req.params;
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.per_page) || 30;
        const offset = (page - 1) * perPage;

        const cacheKey = `category:${slug}:${page}:${perPage}`;
        const cached = cacheGet(cacheKey);
        if (cached) return res.json(cached);

        // Find category by slug
        const [categories] = await db.query('SELECT id, name, slug FROM category WHERE slug = ?', [slug]);
        if (categories.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Category not found'
            });
        }
        const category = categories[0];

        // Count total manga in this category
        const [countResult] = await db.query(
            `SELECT COUNT(*) as total
            FROM category_manga cm
            INNER JOIN manga m ON m.id = cm.manga_id
            WHERE cm.category_id = ? AND m.is_public = 1`,
            [category.id]
        );
        const total = countResult[0].total;
        const lastPage = Math.ceil(total / perPage);

        // Get manga list
        const [rows] = await db.query(
            `SELECT m.id as manga_id,
                m.is_new as is_new,
                m.slug as manga_slug,
                m.cover as manga_cover,
                m.name as manga_name,
                m.hot as hot,
                m.caution as caution,
                m.chapter_1 as chapter_1,
                m.chapter_2 as chapter_2,
                m.chap_1_slug as chap_1_slug,
                m.chap_2_slug as chap_2_slug,
                m.time_chap_1 as time_chap_1,
                m.flag_chap_1 as flag_chap_1,
                m.flag_chap_2 as flag_chap_2,
                m.time_chap_2 as time_chap_2,
                m.update_at as update_at
            FROM category_manga cm
            INNER JOIN manga m ON m.id = cm.manga_id
            WHERE cm.category_id = ? AND m.is_public = 1
            ORDER BY m.update_at DESC
            LIMIT ?, ?`,
            [category.id, offset, perPage]
        );

        const response = {
            success: true,
            data: rows,
            category: { id: category.id, name: category.name, slug: category.slug },
            meta: {
                pagination: {
                    current_page: page,
                    last_page: lastPage,
                    per_page: perPage,
                    total,
                    from: offset + 1,
                    to: Math.min(offset + perPage, total)
                }
            }
        };
        cacheSet(cacheKey, response, 60);
        res.json(response);
    } catch (error) {
        console.error('Error fetching manga by category:', error);
        res.status(500).json({
            success: false,
            error: 'Error fetching manga by category'
        });
    }
};

// Get manga detail by slug — cached 5min, with parallel sub-queries
exports.getMangaBySlug = async (req, res) => {
    const safeISO = (d) => {
        if (!d) return new Date().toISOString();
        const dt = new Date(d);
        return isNaN(dt.getTime()) ? new Date().toISOString() : dt.toISOString();
    };

    try {
        const { slug } = req.params;

        const cacheKey = `manga:detail:${slug}`;
        const cached = cacheGet(cacheKey);
        if (cached) return res.json(cached);

        // Get manga basic info
        const [rows] = await db.query(
            'SELECT * FROM manga WHERE slug = ? AND is_public = 1',
            [slug]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Manga not found'
            });
        }

        const m = rows[0];

        // Run 4 sub-queries in PARALLEL instead of sequentially
        const [genreResult, firstChapterResult, ratingResult, authorResult] = await Promise.all([
            // Genres
            db.query(
                `SELECT c.id, c.name, c.slug
                FROM category c
                JOIN category_manga cm ON c.id = cm.category_id
                WHERE cm.manga_id = ?`,
                [m.id]
            ).catch(() => [[]]),
            // First chapter
            db.query(
                `SELECT id, name, slug, view, created_at, number
                FROM chapter
                WHERE manga_id = ? AND is_show = 1
                ORDER BY CAST(number AS DECIMAL(10,2)) ASC
                LIMIT 1`,
                [m.id]
            ).catch(() => [[]]),
            // Rating count
            db.query(
                'SELECT COUNT(*) as total FROM item_ratings WHERE item_id = ?',
                [m.id]
            ).catch(() => [[{ total: 0 }]]),
            // Authors
            db.query(
                `SELECT a.id, a.name, a.slug, am.type
                FROM author a
                JOIN author_manga am ON a.id = am.author_id
                WHERE am.manga_id = ?`,
                [m.id]
            ).catch(() => [[]]),
        ]);

        // Process genres
        const genreRows = genreResult[0] || [];
        const genres = genreRows.map(g => ({
            id: g.id,
            uuid: String(g.id),
            name: g.name,
            slug: g.slug,
        }));

        // Process first chapter
        let firstChapter = null;
        const chapterRows = firstChapterResult[0] || [];
        if (chapterRows.length > 0) {
            const ch = chapterRows[0];
            firstChapter = {
                id: ch.id,
                uuid: String(ch.id),
                name: ch.name || `第${ch.number}話`,
                slug: ch.slug || `chapter-${ch.number}`,
                views: ch.view || 0,
                order: parseInt(ch.number) || 1,
                created_at: safeISO(ch.created_at),
            };
        }

        // Process latest chapter from denormalized fields
        let latestChapter = null;
        if (m.chapter_1) {
            latestChapter = {
                id: 0,
                uuid: m.chap_1_slug || '',
                name: m.chapter_1,
                slug: m.chap_1_slug || '',
                views: 0,
                order: 0,
                created_at: safeISO(m.time_chap_1 ? m.time_chap_1 * 1000 : null),
            };
        }

        // Process ratings
        const ratingRows = ratingResult[0] || [];
        const totalRatings = (ratingRows[0] && ratingRows[0].total) || 0;

        // Process authors
        let author = null;
        let artist = null;
        const authorRows = authorResult[0] || [];
        for (const row of authorRows) {
            const obj = { id: row.id, uuid: String(row.id), name: row.name, slug: row.slug };
            if (row.type === 1 && !author) author = obj;
            if (row.type === 2 && !artist) artist = obj;
        }

        const views = (m.view_day || 0) + (m.view_week || 0) + (m.view_month || 0);

        const manga = {
            id: m.id,
            uuid: String(m.id),
            name: toTitleCase(decodeEntities(m.name)),
            name_alt: toTitleCase(decodeEntities(m.otherNames)) || '',
            slug: m.slug,
            pilot: m.summary || '',
            status: m.status === 'completed' ? 2 : 1,
            views: views,
            views_week: m.view_week || 0,
            views_day: m.view_day || 0,
            average_rating: parseFloat(m.rating) || 0,
            total_ratings: totalRatings,
            is_hot: m.hot === 1,
            is_reviewed: 0,
            cover_full_url: `${process.env.COVER_CDN_URL}/cover/${m.slug}.jpg`,
            created_at: safeISO(m.created_at),
            updated_at: m.update_at ? safeISO(m.update_at * 1000) : safeISO(m.updated_at),
            genres,
            author: author,
            artist: artist,
            group: null,
            latest_chapter: latestChapter,
            first_chapter: firstChapter,
        };

        const response = { success: true, data: manga };
        cacheSet(cacheKey, response, 300);
        res.json(response);
    } catch (error) {
        console.error('Error fetching manga detail:', error);
        res.status(500).json({
            success: false,
            error: 'Error fetching manga detail'
        });
    }
};

// Rate a manga (IP-based dedup) — invalidates detail cache
exports.rateManga = async (req, res) => {
    try {
        const { slug } = req.params;
        const { rating } = req.body;
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';

        const score = parseInt(rating);
        if (!score || score < 1 || score > 5) {
            return res.status(400).json({ success: false, error: 'Rating must be between 1 and 5' });
        }

        // Find manga
        const [mangaRows] = await db.query(
            'SELECT id FROM manga WHERE slug = ? AND is_public = 1',
            [slug]
        );
        if (mangaRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Manga not found' });
        }
        const mangaId = mangaRows[0].id;

        // Upsert rating by IP
        const [existing] = await db.query(
            'SELECT id FROM item_ratings WHERE item_id = ? AND ip_address = ?',
            [mangaId, ip]
        );

        if (existing.length > 0) {
            await db.query(
                'UPDATE item_ratings SET score = ?, added_on = NOW() WHERE id = ?',
                [score, existing[0].id]
            );
        } else {
            await db.query(
                'INSERT INTO item_ratings (item_id, score, ip_address) VALUES (?, ?, ?)',
                [mangaId, score, ip]
            );
        }

        // Recalculate average and update manga.rating
        const [avgResult] = await db.query(
            'SELECT AVG(score) as avg_rating, COUNT(*) as total FROM item_ratings WHERE item_id = ?',
            [mangaId]
        );
        const avgRating = parseFloat(avgResult[0].avg_rating) || 0;
        const totalRatings = avgResult[0].total || 0;

        await db.query('UPDATE manga SET rating = ? WHERE id = ?', [avgRating.toFixed(2), mangaId]);

        // Invalidate detail cache
        cacheDel(`manga:detail:${slug}`);

        res.json({
            success: true,
            data: {
                rating: {
                    id: existing.length > 0 ? existing[0].id : 0,
                    uuid: '',
                    rating: score,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    user: { id: 0, name: 'Anonymous' },
                },
                manga_stats: {
                    average_rating: parseFloat(avgRating.toFixed(2)),
                    total_ratings: totalRatings,
                },
            },
        });
    } catch (error) {
        console.error('Error rating manga:', error);
        res.status(500).json({ success: false, error: 'Error rating manga' });
    }
};

// Get user's rating for a manga (by IP)
exports.getUserRating = async (req, res) => {
    try {
        const { slug } = req.params;
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';

        const [mangaRows] = await db.query(
            'SELECT id FROM manga WHERE slug = ? AND is_public = 1',
            [slug]
        );
        if (mangaRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Manga not found' });
        }

        const [ratingRows] = await db.query(
            'SELECT score FROM item_ratings WHERE item_id = ? AND ip_address = ?',
            [mangaRows[0].id, ip]
        );

        res.json({
            success: true,
            data: { score: ratingRows.length > 0 ? ratingRows[0].score : null },
        });
    } catch (error) {
        console.error('Error fetching user rating:', error);
        res.status(500).json({ success: false, error: 'Error fetching rating' });
    }
};

// Get chapters by manga slug — cached 5min
exports.getChaptersByManga = async (req, res) => {
    try {
        const { slug } = req.params;
        const sort = req.query.sort === 'asc' ? 'ASC' : 'DESC';
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.per_page) || 999;
        const offset = (page - 1) * perPage;

        const cacheKey = `chapters:${slug}:${sort}:${page}:${perPage}`;
        const cached = cacheGet(cacheKey);
        if (cached) return res.json(cached);

        // Find manga by slug
        const [mangaRows] = await db.query(
            'SELECT id FROM manga WHERE slug = ? AND is_public = 1',
            [slug]
        );

        if (mangaRows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Manga not found'
            });
        }

        const mangaId = mangaRows[0].id;

        // Get chapters from chapter table
        let chapters = [];
        let total = 0;
        try {
            const [countResult] = await db.query(
                'SELECT COUNT(*) as total FROM chapter WHERE manga_id = ? AND is_show = 1',
                [mangaId]
            );
            total = countResult[0].total;

            const [rows] = await db.query(
                `SELECT id, name, slug, number, view, created_at, updated_at
                FROM chapter
                WHERE manga_id = ? AND is_show = 1
                ORDER BY CAST(number AS DECIMAL(10,2)) ${sort}
                LIMIT ?, ?`,
                [mangaId, offset, perPage]
            );

            const safeISO = (d) => {
                if (!d) return new Date().toISOString();
                const dt = new Date(d);
                return isNaN(dt.getTime()) ? new Date().toISOString() : dt.toISOString();
            };

            chapters = rows.map(ch => ({
                id: ch.id,
                uuid: String(ch.id),
                name: ch.name || `第${ch.number}話`,
                slug: ch.slug || `chapter-${ch.number}`,
                views: ch.view || 0,
                order: parseInt(ch.number) || 0,
                chapter_number: parseFloat(ch.number) || 0,
                created_at: safeISO(ch.created_at),
                updated_at: safeISO(ch.updated_at),
            }));
        } catch (e) {
            console.error('Chapter table query error:', e.message);
        }

        const lastPage = Math.ceil(total / perPage) || 1;

        const response = {
            success: true,
            data: chapters,
            meta: {
                pagination: {
                    current_page: page,
                    last_page: lastPage,
                    per_page: perPage,
                    total,
                    from: offset + 1,
                    to: Math.min(offset + perPage, total)
                }
            }
        };
        cacheSet(cacheKey, response, 300);
        res.json(response);
    } catch (error) {
        console.error('Error fetching chapters:', error);
        res.status(500).json({
            success: false,
            error: 'Error fetching chapters'
        });
    }
};

// Get manga by slugs (for localStorage history/continue reading)
exports.getMangaBySlugs = async (req, res) => {
    try {
        const { slugs } = req.body;
        if (!Array.isArray(slugs) || slugs.length === 0) {
            return res.json({ success: true, data: [] });
        }
        const limited = slugs.slice(0, 30);
        const placeholders = limited.map(() => '?').join(',');
        const [rows] = await db.query(
            `SELECT m.id as manga_id, m.name as manga_name, m.slug as manga_slug,
                m.cover as manga_cover, m.rating as average_rating
            FROM manga m
            WHERE m.slug IN (${placeholders}) AND m.is_public = 1`,
            limited
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error fetching manga by slugs:', error);
        res.status(500).json({ success: false, error: 'Error fetching manga by slugs' });
    }
};

// Get top manga by period — cached 60s
exports.getTopManga = async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 10, 30);
        const period = req.query.period || 'day';

        const cacheKey = `top:${period}:${limit}`;
        const cached = cacheGet(cacheKey);
        if (cached) return res.json(cached);

        let orderCol;
        if (period === 'month') orderCol = 'view_month';
        else if (period === 'all') orderCol = 'views';
        else orderCol = 'view_day';

        const [rows] = await db.query(
            `SELECT m.id as manga_id, m.name as manga_name, m.slug as manga_slug,
                m.cover as manga_cover, m.rating as average_rating,
                m.views, m.view_day, m.view_month,
                m.hot, m.caution, m.chapter_1, m.chap_1_slug, m.time_chap_1,
                m.update_at as update_at
            FROM manga m
            WHERE m.is_public = 1
            ORDER BY ${orderCol} DESC
            LIMIT ?`,
            [limit]
        );

        const response = { success: true, data: rows };
        cacheSet(cacheKey, response, 60);
        res.json(response);
    } catch (error) {
        console.error('Error fetching top manga:', error);
        res.status(500).json({ success: false, error: 'Error fetching top manga' });
    }
};

// Get popular manga by day
exports.getPopularByDay = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const offset = parseInt(req.query.offset) || 0;

        const [rows] = await db.query(
            'SELECT m.id as manga_id, m.name, m.slug, m.view_day as view FROM manga m ORDER BY view_day DESC LIMIT ?, ?',
            [offset, limit]
        );

        res.json({
            success: true,
            data: rows
        });
    } catch (error) {
        console.error('Error fetching popular manga by day:', error);
        res.status(500).json({
            success: false,
            error: 'Error fetching popular manga by day'
        });
    }
};

// Get popular manga by week
exports.getPopularByWeek = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const offset = parseInt(req.query.offset) || 0;

        const [rows] = await db.query(
            'SELECT m.id as manga_id, m.name, m.slug, m.view_week as view FROM manga m ORDER BY view_week DESC LIMIT ?, ?',
            [offset, limit]
        );

        res.json({
            success: true,
            data: rows
        });
    } catch (error) {
        console.error('Error fetching popular manga by week:', error);
        res.status(500).json({
            success: false,
            error: 'Error fetching popular manga by week'
        });
    }
};

// Get popular manga by month
exports.getPopularByMonth = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const offset = parseInt(req.query.offset) || 0;

        const [rows] = await db.query(
            'SELECT m.id as manga_id, m.name, m.slug, m.view_month as view FROM manga m ORDER BY view_month DESC LIMIT ?, ?',
            [offset, limit]
        );

        res.json({
            success: true,
            data: rows
        });
    } catch (error) {
        console.error('Error fetching popular manga by month:', error);
        res.status(500).json({
            success: false,
            error: 'Error fetching popular manga by month'
        });
    }
};

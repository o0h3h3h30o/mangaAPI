const db = require('../config/database');

// Get all categories
exports.getAllCategories = async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM category ORDER BY name ASC');
        res.json({
            success: true,
            data: rows
        });
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({
            success: false,
            error: 'Error fetching categories'
        });
    }
};

// Get category by ID
exports.getCategoryById = async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await db.query('SELECT * FROM category WHERE id = ?', [id]);

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Category not found'
            });
        }

        res.json({
            success: true,
            data: rows[0]
        });
    } catch (error) {
        console.error('Error fetching category:', error);
        res.status(500).json({
            success: false,
            error: 'Error fetching category'
        });
    }
};

// In-memory cache for popular categories (30 days)
let popularCache = { data: null, expiry: 0 };
const POPULAR_CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

// Get top N popular categories by manga count
exports.getPopularCategories = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 4;
        const cacheKey = `popular_${limit}`;

        if (popularCache.data && popularCache.key === cacheKey && Date.now() < popularCache.expiry) {
            return res.json({ success: true, data: popularCache.data });
        }

        const [rows] = await db.query(
            `SELECT c.id, c.name, c.slug, COUNT(cm.manga_id) as manga_count
             FROM category c
             JOIN category_manga cm ON c.id = cm.category_id
             GROUP BY c.id, c.name, c.slug
             ORDER BY manga_count DESC
             LIMIT ?`,
            [limit]
        );

        popularCache = { data: rows, key: cacheKey, expiry: Date.now() + POPULAR_CACHE_TTL };
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error fetching popular categories:', error);
        res.status(500).json({ success: false, error: 'Error fetching popular categories' });
    }
};

// Get category by slug
exports.getCategoryBySlug = async (req, res) => {
    try {
        const { slug } = req.params;
        const [rows] = await db.query('SELECT * FROM category WHERE slug = ?', [slug]);

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Category not found'
            });
        }

        res.json({
            success: true,
            data: rows[0]
        });
    } catch (error) {
        console.error('Error fetching category:', error);
        res.status(500).json({
            success: false,
            error: 'Error fetching category'
        });
    }
};

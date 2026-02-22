const jwt = require('jsonwebtoken');
const db = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'manga-app-secret-key-change-in-production';

/**
 * Middleware to verify JWT token from Authorization header.
 * Attaches decoded user payload to req.user on success.
 */
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            success: false,
            error: 'Access token is required'
        });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            error: 'Invalid or expired token'
        });
    }
};

/**
 * Middleware to require admin role.
 * Must be used after authenticateToken.
 */
const requireAdmin = async (req, res, next) => {
    try {
        const [rows] = await db.query(
            `SELECT ug.group_id FROM users u
             JOIN users_groups ug ON ug.user_id = u.id
             JOIN groups g ON g.id = ug.group_id
             WHERE u.id = ? AND u.active = 1 AND g.name = 'admin'
             LIMIT 1`,
            [req.user.id]
        );
        if (rows.length === 0) {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }
        req.user.role = 'admin';
        next();
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: 'Authorization check failed'
        });
    }
};

module.exports = { authenticateToken, requireAdmin, JWT_SECRET };

const express = require('express');
const router = express.Router();
const commentController = require('../controllers/comment.controller');
const { authenticateToken } = require('../middleware/auth.middleware');

// Optional auth middleware - sets req.user if token present, but doesn't block
const optionalAuth = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return next();

    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('../middleware/auth.middleware');
    try {
        req.user = jwt.verify(token, JWT_SECRET);
    } catch {
        // Invalid token - continue without user
    }
    next();
};

// Recent comments (homepage sidebar)
router.get('/recent', commentController.getRecentComments);

// Manga comments
router.get('/manga/:slug', optionalAuth, commentController.getCommentsByManga);
router.post('/manga/:slug', authenticateToken, commentController.addComment);

// Chapter comments
router.get('/chapter/:mangaSlug/:chapterSlug', optionalAuth, commentController.getCommentsByChapter);
router.post('/chapter/:mangaSlug/:chapterSlug', authenticateToken, commentController.addCommentToChapter);

// Edit/delete (shared)
router.put('/:id', authenticateToken, commentController.updateComment);
router.delete('/:id', authenticateToken, commentController.deleteComment);

module.exports = router;

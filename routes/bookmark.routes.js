const express = require('express');
const router = express.Router();
const bookmarkController = require('../controllers/bookmark.controller');
const { authenticateToken } = require('../middleware/auth.middleware');

// All bookmark routes require authentication
router.get('/', authenticateToken, bookmarkController.getBookmarks);
router.post('/', authenticateToken, bookmarkController.addBookmark);
router.delete('/:mangaId', authenticateToken, bookmarkController.removeBookmark);
router.get('/check/:mangaId', authenticateToken, bookmarkController.checkBookmarkStatus);

module.exports = router;

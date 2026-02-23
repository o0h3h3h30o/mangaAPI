const express = require('express');
const router = express.Router();
const chapterController = require('../controllers/chapter.controller');
const { cache } = require('../middleware/cache');

// Get chapter detail
router.get('/:mangaSlug/:chapterSlug', cache.long, chapterController.getChapterDetail);

// Get chapter images
router.get('/:mangaSlug/:chapterSlug/images', cache.long, chapterController.getChapterImages);

// Track chapter view (client-side only, prevents double-counting)
router.post('/:mangaSlug/:chapterSlug/track-view', chapterController.trackView);

module.exports = router;

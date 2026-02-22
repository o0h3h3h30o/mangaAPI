const express = require('express');
const router = express.Router();
const mangaController = require('../controllers/manga.controller');
const { searchLimiter, writeLimiter } = require('../middleware/rate-limit');

// Get latest manga
router.get('/latest', mangaController.getLatestManga);

// Get newest manga (order by id desc)
router.get('/newest', mangaController.getNewestManga);

// Get hot new releases
router.get('/hot-new-releases', mangaController.getHotNewReleases);

// Get manga by slugs (for reading history)
router.post('/by-slugs', mangaController.getMangaBySlugs);

// Get top manga by period
router.get('/top', mangaController.getTopManga);

// Get popular manga by day
router.get('/popular/day', mangaController.getPopularByDay);

// Get popular manga by week
router.get('/popular/week', mangaController.getPopularByWeek);

// Get popular manga by month
router.get('/popular/month', mangaController.getPopularByMonth);

// Get manga by category slug
router.get('/by-category/:slug', mangaController.getMangaByCategory);

// Browse manga with filters
router.get('/browse', mangaController.browseManga);

// Search manga
router.get('/search', searchLimiter, mangaController.searchManga);

// Get manga detail by slug
router.get('/detail/:slug', mangaController.getMangaBySlug);

// Rating
router.post('/:slug/rate', writeLimiter, mangaController.rateManga);
router.get('/:slug/rating', mangaController.getUserRating);

// Get chapters by manga slug
router.get('/:slug/chapters', mangaController.getChaptersByManga);

// Get manga by ID
router.get('/:id', mangaController.getMangaById);

module.exports = router;

const express = require('express');
const router = express.Router();
const mangaController = require('../controllers/manga.controller');
const { searchLimiter, writeLimiter } = require('../middleware/rate-limit');
const { cache } = require('../middleware/cache');

// Get latest manga
router.get('/latest', cache.short, mangaController.getLatestManga);

// Get newest manga (order by id desc)
router.get('/newest', cache.short, mangaController.getNewestManga);

// Get hot new releases
router.get('/hot-new-releases', cache.short, mangaController.getHotNewReleases);

// Get manga by slugs (for reading history)
router.post('/by-slugs', mangaController.getMangaBySlugs);

// Get top manga by period
router.get('/top', cache.short, mangaController.getTopManga);

// Get popular manga by day
router.get('/popular/day', cache.short, mangaController.getPopularByDay);

// Get popular manga by week
router.get('/popular/week', cache.short, mangaController.getPopularByWeek);

// Get popular manga by month
router.get('/popular/month', cache.short, mangaController.getPopularByMonth);

// Get manga by category slug
router.get('/by-category/:slug', cache.short, mangaController.getMangaByCategory);

// Browse manga with filters
router.get('/browse', cache.short, mangaController.browseManga);

// Search manga
router.get('/search', searchLimiter, cache.search, mangaController.searchManga);

// Get manga detail by slug
router.get('/detail/:slug', cache.medium, mangaController.getMangaBySlug);

// Rating
router.post('/:slug/rate', writeLimiter, mangaController.rateManga);
router.get('/:slug/rating', mangaController.getUserRating);

// Get chapters by manga slug
router.get('/:slug/chapters', cache.medium, mangaController.getChaptersByManga);

// Get manga by ID
router.get('/:id', cache.medium, mangaController.getMangaById);

module.exports = router;

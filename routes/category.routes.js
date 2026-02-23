const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/category.controller');
const { cache } = require('../middleware/cache');

// Get all categories
router.get('/', cache.medium, categoryController.getAllCategories);

// Get popular categories (top N by manga count)
router.get('/popular', cache.medium, categoryController.getPopularCategories);

// Get category by slug
router.get('/slug/:slug', cache.medium, categoryController.getCategoryBySlug);

// Get category by ID
router.get('/:id', cache.medium, categoryController.getCategoryById);

module.exports = router;

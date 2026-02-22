const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/category.controller');

// Get all categories
router.get('/', categoryController.getAllCategories);

// Get popular categories (top N by manga count)
router.get('/popular', categoryController.getPopularCategories);

// Get category by slug
router.get('/slug/:slug', categoryController.getCategoryBySlug);

// Get category by ID
router.get('/:id', categoryController.getCategoryById);

module.exports = router;

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const { authenticateToken, requireAdmin } = require('../middleware/auth.middleware');

// All admin routes require authentication + admin role
router.use(authenticateToken, requireAdmin);

// Dashboard
router.get('/stats', adminController.getStats);

// Manga CRUD
router.get('/manga', adminController.listMangas);
router.get('/manga/:id', adminController.getManga);
router.post('/manga', adminController.createManga);
router.put('/manga/:id', adminController.updateManga);
router.delete('/manga/:id', adminController.deleteManga);
router.post('/manga/:id/cover', adminController.uploadCover, adminController.uploadMangaCover);

// Tags
router.get('/tags', adminController.listTags);
router.post('/tags', adminController.createTag);
router.put('/tags/:id', adminController.updateTag);
router.delete('/tags/:id', adminController.deleteTag);

// Categories
router.get('/categories', adminController.listCategories);
router.post('/categories', adminController.createCategory);
router.put('/categories/:id', adminController.updateCategory);
router.delete('/categories/:id', adminController.deleteCategory);

// Comic Types
router.get('/comictypes', adminController.listComicTypes);
router.post('/comictypes', adminController.createComicType);
router.put('/comictypes/:id', adminController.updateComicType);
router.delete('/comictypes/:id', adminController.deleteComicType);

// Authors
router.get('/authors', adminController.listAuthors);
router.post('/authors', adminController.createAuthor);
router.put('/authors/:id', adminController.updateAuthor);
router.delete('/authors/:id', adminController.deleteAuthor);

// Chapters
router.get('/manga/:id/chapters', adminController.listChapters);
router.post('/manga/:id/chapters', adminController.createChapter);
router.put('/chapters/:id', adminController.updateChapter);
router.delete('/chapters/:id', adminController.deleteChapter);

// Chapter pages
router.get('/chapters/:id/pages', adminController.getChapterPages);
router.post('/chapters/:id/pages', adminController.uploadPages, adminController.uploadChapterPages);
router.post('/chapters/:id/pages/urls', adminController.addChapterPageUrls);
router.post('/pages/bulk-delete', adminController.bulkDeletePages);
router.delete('/pages/:id', adminController.deleteChapterPage);

// Bulk operations
router.post('/chapters/bulk-delete', adminController.bulkDeleteChapters);

// Users
router.get('/users', adminController.listUsers);
router.put('/users/:id', adminController.updateUser);
router.delete('/users/:id', adminController.deleteUser);

// Comments
router.get('/comments', adminController.listComments);
router.delete('/comments/:id', adminController.deleteComment);

module.exports = router;

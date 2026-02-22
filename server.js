const express = require('express');
const cors = require('cors');
const compression = require('compression');
require('dotenv').config();

const { globalLimiter } = require('./middleware/rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (Nginx/Cloudflare) to get real client IP for rate limiting
app.set('trust proxy', 1);

// Middleware
app.use(compression());
app.use(cors());
app.use(globalLimiter);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request timeout: 30s
app.use((req, res, next) => {
    res.setTimeout(30000, () => {
        res.status(408).json({ success: false, error: 'Request timeout' });
    });
    next();
});

// Import database connection
const db = require('./config/database');

// Import routes
const mangaRoutes = require('./routes/manga.routes');
const categoryRoutes = require('./routes/category.routes');
const authRoutes = require('./routes/auth.routes');
const chapterRoutes = require('./routes/chapter.routes');
const bookmarkRoutes = require('./routes/bookmark.routes');
const commentRoutes = require('./routes/comment.routes');
const adminRoutes = require('./routes/admin.routes');

// Use routes
app.use('/api/manga', mangaRoutes);
app.use('/api/category', categoryRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/chapter', chapterRoutes);
app.use('/api/bookmarks', bookmarkRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/admin', adminRoutes);

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'Welcome to Manga API',
        version: '1.0.0',
        endpoints: {
            manga: '/api/manga',
            category: '/api/category',
            auth: '/api/auth'
        }
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        error: 'Something went wrong!',
        message: err.message
    });
});

// Start server
const server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT} (pid: ${process.pid})`);
});

// Graceful shutdown
function gracefulShutdown(signal) {
    console.log(`${signal} received. Shutting down gracefully...`);
    const { shutdown: flushViews } = require('./lib/view-counter');
    flushViews().then(() => {
        server.close(() => {
            console.log('Server closed');
            process.exit(0);
        });
    });
    // Force exit after 10s
    setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = app;

const db = require('../config/database');

// Buffered view counters — flush to DB every 30s
const chapterViews = new Map(); // chapterId → count
const mangaViews = new Map();   // mangaId → count

/**
 * Increment chapter view count (buffered)
 * @param {number} chapterId
 */
function incrementChapterView(chapterId) {
    chapterViews.set(chapterId, (chapterViews.get(chapterId) || 0) + 1);
}

/**
 * Increment manga view counts (buffered)
 * @param {number} mangaId
 */
function incrementMangaView(mangaId) {
    mangaViews.set(mangaId, (mangaViews.get(mangaId) || 0) + 1);
}

/**
 * Flush all buffered views to database
 */
async function flushViews() {
    if (chapterViews.size === 0 && mangaViews.size === 0) return;

    // Snapshot and clear
    const chapterBatch = new Map(chapterViews);
    const mangaBatch = new Map(mangaViews);
    chapterViews.clear();
    mangaViews.clear();

    // Flush chapter views
    for (const [id, count] of chapterBatch) {
        try {
            await db.query('UPDATE chapter SET view = view + ? WHERE id = ?', [count, id]);
        } catch (err) {
            console.error(`[ViewCounter] Failed to flush chapter ${id}:`, err.message);
        }
    }

    // Flush manga views
    for (const [id, count] of mangaBatch) {
        try {
            await db.query(
                'UPDATE manga SET views = views + ?, view_day = view_day + ?, view_week = view_week + ?, view_month = view_month + ? WHERE id = ?',
                [count, count, count, count, id]
            );
        } catch (err) {
            console.error(`[ViewCounter] Failed to flush manga ${id}:`, err.message);
        }
    }
}

// Flush every 30 seconds
const flushInterval = setInterval(flushViews, 30000);

// Graceful shutdown: flush remaining views
function shutdown() {
    clearInterval(flushInterval);
    return flushViews();
}

module.exports = { incrementChapterView, incrementMangaView, shutdown };

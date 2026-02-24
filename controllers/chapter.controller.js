const db = require('../config/database');
const { incrementChapterView, incrementMangaView } = require('../lib/view-counter');

// Get chapter detail by manga slug + chapter slug
exports.getChapterDetail = async (req, res) => {
    try {
        const { mangaSlug, chapterSlug } = req.params;

        // Find manga
        const [mangaRows] = await db.query(
            'SELECT id, name, slug, otherNames, cover FROM manga WHERE slug = ? AND is_public = 1',
            [mangaSlug]
        );

        if (mangaRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Manga not found' });
        }

        const manga = mangaRows[0];

        // Find chapter
        const [chapterRows] = await db.query(
            'SELECT id, name, slug, number, view, created_at, updated_at FROM chapter WHERE manga_id = ? AND slug = ? AND is_show = 1',
            [manga.id, chapterSlug]
        );

        if (chapterRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Chapter not found' });
        }

        const ch = chapterRows[0];

        // Views are tracked via POST /track-view endpoint (not here)
        // to avoid double-counting from SSR metadata + client render

        const chapter = {
            id: ch.id,
            uuid: String(ch.id),
            name: ch.name || `第${ch.number}話`,
            slug: ch.slug,
            views: ch.view || 0,
            order: parseInt(ch.number) || 0,
            chapter_number: parseFloat(ch.number) || 0,
            created_at: ch.created_at ? new Date(ch.created_at).toISOString() : new Date().toISOString(),
            updated_at: ch.updated_at ? new Date(ch.updated_at).toISOString() : new Date().toISOString(),
            content: [], // images loaded separately via getImages
            manga: {
                id: manga.id,
                uuid: String(manga.id),
                name: manga.name,
                name_alt: manga.otherNames || '',
                slug: manga.slug,
                cover_full_url: `${process.env.COVER_CDN_URL}/cover/${manga.slug}.jpg`,
            },
        };

        res.json({ success: true, data: chapter });
    } catch (error) {
        console.error('Error fetching chapter detail:', error);
        res.status(500).json({ success: false, error: 'Error fetching chapter detail' });
    }
};

// Get chapter images from page table
exports.getChapterImages = async (req, res) => {
    try {
        const { mangaSlug, chapterSlug } = req.params;

        // Find manga
        const [mangaRows] = await db.query(
            'SELECT id, name, slug FROM manga WHERE slug = ? AND is_public = 1',
            [mangaSlug]
        );

        if (mangaRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Manga not found' });
        }

        const manga = mangaRows[0];

        // Find chapter
        const [chapterRows] = await db.query(
            'SELECT id, name, slug, number, view, created_at FROM chapter WHERE manga_id = ? AND slug = ? AND is_show = 1',
            [manga.id, chapterSlug]
        );

        if (chapterRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Chapter not found' });
        }

        const ch = chapterRows[0];

        // Get pages (images) for this chapter, grouped by slug to avoid duplicates from re-crawling
        const [pages] = await db.query(
            'SELECT MIN(id) as id, slug, image, external FROM page WHERE chapter_id = ? GROUP BY slug ORDER BY CAST(slug AS UNSIGNED) ASC',
            [ch.id]
        );

        // Build image URLs
        const images = pages.map(p => {
            if (p.external === 1) {
                return p.image;
            }
            return `${process.env.CHAPTER_CDN_URL}/manga/${mangaSlug}/chapters/${chapterSlug}/${p.image}`;
        });

        res.json({
            success: true,
            chapter: {
                id: ch.id,
                uuid: String(ch.id),
                name: ch.name || `第${ch.number}話`,
                slug: ch.slug,
                views: ch.view || 0,
                order: parseInt(ch.number) || 0,
                created_at: ch.created_at ? new Date(ch.created_at).toISOString() : new Date().toISOString(),
                manga: {
                    id: manga.id,
                    name: manga.name,
                    slug: manga.slug,
                },
            },
            images,
        });
    } catch (error) {
        console.error('Error fetching chapter images:', error);
        res.status(500).json({ success: false, error: 'Error fetching chapter images' });
    }
};

// Track chapter view (called once from client-side only)
exports.trackView = async (req, res) => {
    try {
        const { mangaSlug, chapterSlug } = req.params;

        const [mangaRows] = await db.query(
            'SELECT id FROM manga WHERE slug = ? AND is_public = 1',
            [mangaSlug]
        );
        if (mangaRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Manga not found' });
        }

        const [chapterRows] = await db.query(
            'SELECT id FROM chapter WHERE manga_id = ? AND slug = ? AND is_show = 1',
            [mangaRows[0].id, chapterSlug]
        );
        if (chapterRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Chapter not found' });
        }

        incrementChapterView(chapterRows[0].id);
        incrementMangaView(mangaRows[0].id);

        res.json({ success: true });
    } catch (error) {
        console.error('Error tracking view:', error);
        res.status(500).json({ success: false, error: 'Error tracking view' });
    }
};

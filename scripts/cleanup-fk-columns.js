const mysql = require('mysql2/promise');

// Columns that failed due to FK constraints
const FK_COLUMNS = [
  { table: 'manga', column: 'type_id', fk: 'manga_type_id_foreign' },
  { table: 'manga', column: 'user_id', fk: 'manga_user_id_foreign' },
  { table: 'chapter', column: 'user_id', fk: 'chapter_user_id_foreign' },
  { table: 'bookmarks', column: 'chapter_id', fk: 'bookmarks_chapter_id_foreign' },
  { table: 'bookmarks', column: 'page_id', fk: 'bookmarks_page_id_foreign' },
];

(async () => {
  const conn = await mysql.createConnection({ host: 'localhost', user: 'root', database: 'mangaraw4u' });

  for (const { table, column, fk } of FK_COLUMNS) {
    try {
      // Drop FK constraint first
      await conn.query(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${fk}\``);
      console.log(`DROPPED FK: ${table}.${fk}`);
    } catch (e) {
      console.log(`FK skip: ${fk} — ${e.message}`);
    }

    try {
      // Now drop the column
      await conn.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``);
      console.log(`DROPPED COLUMN: ${table}.${column}`);
    } catch (e) {
      console.error(`FAILED: ${table}.${column} — ${e.message}`);
    }
  }

  // Verify
  for (const table of ['manga', 'chapter', 'bookmarks']) {
    const [cols] = await conn.query(`SHOW COLUMNS FROM \`${table}\``);
    console.log(`\n${table}: ${cols.map(c => c.Field).join(', ')}`);
  }

  await conn.end();
  console.log('\nDone!');
})().catch(e => console.error(e.message));

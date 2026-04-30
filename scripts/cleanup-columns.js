require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const DROP_COLUMNS = {
  manga: [
    'releaseDate', 'rate', 'bulkStatus', 'type_id', 'user_id',
    'genres', 'thumbnail', 'time_public', 'name_chapter_1', 'name_chapter_2',
  ],
  chapter: ['volume', 'user_id', 'translate'],
  bookmarks: ['status', 'chapter_id', 'page_id'],
  page: ['created_at', 'updated_at'],
  users: [
    'notify', 'avatar', 'permissions', 'first_name', 'last_name', 'phone',
    'activation_selector', 'activation_code',
    'forgotten_password_selector', 'forgotten_password_code', 'forgotten_password_time',
    'remember_selector', 'remember_code',
    'date', 'company', 'bio', 'user_img',
  ],
  groups: ['description'],
};

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'mangaraw4u',
  });

  let totalDropped = 0;
  let totalFailed = 0;

  for (const [table, columns] of Object.entries(DROP_COLUMNS)) {
    console.log(`\n=== ${table} ===`);
    for (const col of columns) {
      try {
        await conn.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${col}\``);
        console.log(`  DROPPED: ${col}`);
        totalDropped++;
      } catch (e) {
        if (e.message.includes("check that column/key exists")) {
          console.log(`  SKIP: ${col} (doesn't exist)`);
        } else {
          console.error(`  FAILED: ${col} — ${e.message}`);
          totalFailed++;
        }
      }
    }
  }

  // Add missing view_week column
  console.log('\n=== ADD view_week to manga ===');
  try {
    await conn.query('ALTER TABLE manga ADD COLUMN view_week INT DEFAULT 0 AFTER view_day');
    console.log('  ADDED: view_week');
  } catch (e) {
    if (e.message.includes('Duplicate column')) {
      console.log('  SKIP: view_week already exists');
    } else {
      console.error('  FAILED:', e.message);
    }
  }

  // Verify final schema
  console.log('\n========== FINAL SCHEMA ==========\n');
  const [tables] = await conn.query('SHOW TABLES');
  for (const row of tables) {
    const table = Object.values(row)[0];
    const [cols] = await conn.query(`SHOW COLUMNS FROM \`${table}\``);
    const colNames = cols.map(c => c.Field).join(', ');
    console.log(`${table}: ${colNames}`);
  }

  await conn.end();
  console.log(`\nDone! Dropped ${totalDropped} columns, ${totalFailed} failed.`);
})().catch(e => console.error(e.message));

const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({ host: 'localhost', user: 'root', database: 'mangaraw4u' });
  const [tables] = await conn.query('SHOW TABLES');
  for (const row of tables) {
    const table = Object.values(row)[0];
    const [cols] = await conn.query(`SHOW COLUMNS FROM \`${table}\``);
    console.log(`=== ${table} ===`);
    cols.forEach(c => {
      const def = c.Default !== null ? c.Default : 'null';
      console.log(`  ${c.Field} | ${c.Type} | ${c.Key || '-'} | ${def}`);
    });
    console.log('');
  }
  await conn.end();
})().catch(e => console.error(e.message));

const fs = require('fs');
const path = require('path');
const db = require('./db');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', '001_initial.sql'), 'utf-8');
  try {
    await db.query(sql);
    console.log('Migration complete');
  } catch (err) {
    console.error('Migration failed:', err.message);
  }
  await db.end();
}

migrate();

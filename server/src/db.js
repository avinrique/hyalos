const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({ connectionString: config.dbUrl });

module.exports = pool;

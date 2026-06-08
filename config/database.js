const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  ssl: { rejectUnauthorized: false },
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

pool.on('connect', () => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('âœ… ConnectÃ© Ã  PostgreSQL');
  }
});

pool.on('error', (err) => {
  console.error('âŒ Erreur PostgreSQL :', err.message);
});

module.exports = pool;


/**
 * @file db/scripts/initDb.js
 * @description One-time database initialization script for Nyaya-Mitra.
 *
 * Reads `db/schema.sql` and executes it against the configured PostgreSQL
 * database. Run this manually to reset and recreate the schema.
 *
 * ⚠️  WARNING: This is DESTRUCTIVE. It drops and recreates all tables.
 *     Only run against a development or fresh database.
 *
 * PREREQUISITES:
 *   - DATABASE_URL must be set in your environment (or a .env file).
 *   - Run: `npm install dotenv pg` if not already installed.
 *
 * USAGE:
 *   node db/scripts/initDb.js
 *   # or with dotenv:
 *   node -r dotenv/config db/scripts/initDb.js
 */

'use strict';

// Load .env variables if dotenv is available (dev convenience).
// In production, environment variables should be set at the OS/container level.
try {
  require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
} catch {
  // dotenv is optional; ignore if not installed.
}

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const SCHEMA_PATH = path.resolve(__dirname, '../schema.sql');

const run = async () => {
  console.log('🚀 Nyaya-Mitra — Database Initialization');
  console.log('=========================================');
  console.log(`📄 Schema file: ${SCHEMA_PATH}`);

  if (!process.env.DATABASE_URL) {
    console.error('❌ ERROR: DATABASE_URL environment variable is not set.');
    process.exit(1);
  }

  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('🔌 Connecting to database...');
    const client = await pool.connect();

    console.log('⚙️  Executing schema.sql...');
    await client.query(sql);

    console.log('✅ Schema initialized successfully!');
    console.log('\nTables created:');
    const { rows } = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`
    );
    rows.forEach(r => console.log(`   • ${r.table_name}`));

    client.release();
  } catch (err) {
    console.error('❌ Schema initialization failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
};

run();
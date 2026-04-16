/**
 * @file db/connection.js
 * @description PostgreSQL connection pool for Nyaya-Mitra Legal Tech Application.
 *
 * Uses the `pg` (node-postgres) library to create a persistent connection pool
 * pointed at Supabase's IPv4 connection pooler (Transaction Mode on port 6543).
 *
 * WHY A POOL?
 * A pool maintains a set of reusable database connections. Instead of opening
 * a new TCP connection on every request (expensive ~50-100ms), we borrow an
 * idle connection from the pool, use it, and return it. This is essential for
 * any production API serving concurrent requests.
 *
 * SUPABASE POOLER NOTE:
 * Supabase provides two connection modes:
 *   - Session Mode  (port 5432): Full PostgreSQL session, supports prepared statements.
 *   - Transaction Mode (port 6543): Each transaction gets a connection; statements
 *     are NOT persisted between calls. We use this for scalability.
 * Since pgBouncer (Transaction Mode) does not support named prepared statements,
 * we MUST use parameterized queries via $1, $2, etc. (which pg handles correctly).
 */

'use strict';

const { Pool } = require('pg');

// ---------------------------------------------------------------------------
// Pool Initialization
// ---------------------------------------------------------------------------

/**
 * The central pg Pool instance.
 *
 * `connectionString` is read from the DATABASE_URL environment variable.
 * This should be your Supabase IPv4 pooler connection string, which looks like:
 *   postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
 *
 * Pool configuration options:
 * @param {number} max         - Maximum number of clients in the pool (default: 10).
 *                               For Supabase free tier, keep this at 10 or lower
 *                               to avoid exhausting the connection limit.
 * @param {number} idleTimeoutMillis - A client sitting idle for this long is
 *                               destroyed and removed from the pool (30 seconds).
 * @param {number} connectionTimeoutMillis - How long to wait for an available
 *                               connection before throwing an error (10 seconds).
 * @param {boolean} ssl        - Required for Supabase. `rejectUnauthorized: false`
 *                               trusts Supabase's self-signed SSL cert without
 *                               needing the CA bundle locally.
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: {
    // Supabase uses SSL by default. Setting rejectUnauthorized to false
    // is acceptable for Supabase's managed pooler endpoint, as the connection
    // URL itself is the secret. In a fully custom PostgreSQL setup, you would
    // supply a CA certificate instead.
    rejectUnauthorized: false,
  },
});

// ---------------------------------------------------------------------------
// Pool-level Event Listeners
// ---------------------------------------------------------------------------

/**
 * 'connect' event: Fired every time a new physical client is established
 * and added to the pool. Useful for confirming the pool is alive on startup
 * or after a reconnection.
 */
pool.on('connect', (client) => {
  console.log('[DB Pool] New client connected to PostgreSQL.');
});

/**
 * 'acquire' event: Fired each time a client is checked out of the pool.
 * Commented out by default to avoid log spam in production, but invaluable
 * for debugging connection-leak issues during development.
 */
// pool.on('acquire', (client) => {
//   console.log('[DB Pool] Client acquired from pool.');
// });

/**
 * 'remove' event: Fired when a client is destroyed and removed from the pool
 * (e.g., after idleTimeoutMillis has elapsed or after an error).
 * Helps detect unexpected pool churn.
 */
pool.on('remove', (client) => {
  console.warn('[DB Pool] A client has been removed from the pool.');
});

/**
 * 'error' event: CRITICAL — handles unexpected errors on IDLE clients.
 *
 * If a client sitting idle in the pool encounters an error (e.g., the
 * database server restarted, or the network dropped), this event fires.
 * Without this handler, the error would be an unhandled rejection, which
 * crashes the Node.js process in newer versions (v15+).
 *
 * We log the error and allow the pool to discard the bad client
 * automatically and create a new one on the next request.
 */
pool.on('error', (err, client) => {
  console.error('[DB Pool] Unexpected error on idle PostgreSQL client:', err.message);
  // Do NOT call process.exit() here. The pool will self-heal by creating
  // a new client the next time one is needed. Exiting would crash the server.
});

// ---------------------------------------------------------------------------
// Exported Query Helper
// ---------------------------------------------------------------------------

/**
 * Executes a parameterized SQL query against the database pool.
 *
 * This function is the single, standardized entry point for ALL database
 * operations in this application. It:
 *   1. Checks out a client from the pool.
 *   2. Executes the query.
 *   3. Returns the client to the pool (whether the query succeeds or fails).
 *
 * @param {string}  text   - The SQL query string with $1, $2, ... placeholders.
 *                           Example: 'SELECT * FROM users WHERE user_id = $1'
 * @param {Array}   [params=[]] - An array of values to substitute for placeholders.
 *                           Example: ['some-uuid-here']
 * @returns {Promise<import('pg').QueryResult>} The pg QueryResult object, which
 *          contains a `rows` array (the returned data), `rowCount`, `command`, etc.
 * @throws  Will throw a PostgreSQL error if the query is malformed, violates a
 *          constraint, or if a connection cannot be acquired from the pool.
 *
 * @example
 * const { rows } = await query(
 *   'SELECT name, email FROM users WHERE user_id = $1',
 *   ['a1b2c3d4-...']
 * );
 * console.log(rows[0].name);
 */
const query = async (text, params = []) => {
  // Record start time for performance logging.
  const start = Date.now();

  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;

    // Log slow queries (over 200ms) to help identify bottlenecks in production.
    // The query text is truncated to avoid logging sensitive data.
    if (duration > 200) {
      console.warn(
        `[DB Query] Slow query detected (${duration}ms): ${text.substring(0, 80)}...`
      );
    }

    return result;
  } catch (err) {
    // Re-throw the error after logging it. The calling service/controller
    // is responsible for deciding how to handle it (e.g., return 500 to client).
    console.error('[DB Query] Error executing query:', {
      text: text.substring(0, 120), // Truncate to avoid leaking data in logs
      error: err.message,
      code: err.code, // PostgreSQL error codes (e.g., '23505' = unique_violation)
    });
    throw err;
  }
};

// ---------------------------------------------------------------------------
// Pool Health Check Helper
// ---------------------------------------------------------------------------

/**
 * Verifies that the database connection is alive.
 * Call this during server startup to fail fast if the DB is unreachable.
 *
 * @returns {Promise<void>}
 * @throws  Will throw if the connection cannot be established.
 *
 * @example
 * // In your main server.js / app.js:
 * const { testConnection } = require('./db/connection');
 * await testConnection();
 * app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
 */
const testConnection = async () => {
  console.log('[DB] Testing database connection...');
  const { rows } = await query('SELECT NOW() AS current_time');
  console.log(`[DB] Connection successful. Server time: ${rows[0].current_time}`);
};

// ---------------------------------------------------------------------------
// Module Exports
// ---------------------------------------------------------------------------

module.exports = {
  /**
   * Execute a parameterized SQL query.
   * @type {typeof query}
   */
  query,

  /**
   * The raw pg Pool instance. Exported for use cases requiring manual client
   * management (e.g., multi-statement transactions with BEGIN/COMMIT/ROLLBACK).
   *
   * @example
   * const { pool } = require('./db/connection');
   * const client = await pool.connect();
   * try {
   *   await client.query('BEGIN');
   *   await client.query('UPDATE ...');
   *   await client.query('INSERT ...');
   *   await client.query('COMMIT');
   * } catch (e) {
   *   await client.query('ROLLBACK');
   *   throw e;
   * } finally {
   *   client.release(); // ALWAYS release back to pool
   * }
   */
  pool,

  /**
   * Test the DB connection. Use on server startup.
   * @type {typeof testConnection}
   */
  testConnection,
};
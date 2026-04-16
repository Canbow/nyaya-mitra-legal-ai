/**
 * @file db/index.js
 * @description Barrel export for the Nyaya-Mitra database module.
 *
 * This file is the single public interface for all database operations.
 * Application code (routes, services, controllers) should ONLY import
 * from this file — never directly from sub-modules like `connection.js`
 * or individual models. This:
 *
 *   1. Keeps import paths clean:  `require('../db')`  vs
 *                                 `require('../db/models/vectorModel')`
 *   2. Makes refactoring easier — internal module paths can change without
 *      touching any application code.
 *   3. Provides a single place to see the full public API of the DB layer.
 *
 * USAGE IN APPLICATION CODE:
 * @example
 * // In a route handler or service file:
 * const { semanticSearch, saveChatMessage, getChatHistory } = require('../db');
 *
 * const results = await semanticSearch(queryVector, 5, { documentType: 'statute' });
 * await saveChatMessage(userId, userQuestion, aiAnswer);
 * const history = await getChatHistory(userId, 10);
 */

'use strict';

// --- Core Connection Utilities ---
const { query, pool, testConnection } = require('./connection');

// --- Vector Knowledge Base Model ---
const {
  insertKnowledgeChunk,
  semanticSearch,
  bulkInsertKnowledgeChunks,
} = require('./models/vectorModel');

// --- Chat History Model ---
const {
  saveChatMessage,
  getChatHistory,
  clearUserChatHistory,
  getPaginatedHistory,
} = require('./models/chatModel');

// ---------------------------------------------------------------------------
// Re-export everything as a flat namespace for convenient destructuring.
// ---------------------------------------------------------------------------

module.exports = {
  // ── Connection ─────────────────────────────────────────────────────────────
  /** Execute a parameterized SQL query. Use for custom queries not covered by models. */
  query,
  /** The raw pg Pool. Use only for manual transaction management (BEGIN/COMMIT/ROLLBACK). */
  pool,
  /** Verify DB connectivity. Call once on server startup to fail fast. */
  testConnection,

  // ── Vector Model (RAG Knowledge Base) ──────────────────────────────────────
  /** Insert a single pre-chunked legal document + its embedding into the knowledge base. */
  insertKnowledgeChunk,
  /** ANN cosine similarity search using the HNSW index. Core of the RAG retrieval step. */
  semanticSearch,
  /** Transactional bulk insert for ingestion scripts. */
  bulkInsertKnowledgeChunks,

  // ── Chat Model (Conversation Memory) ───────────────────────────────────────
  /** Persist a user↔AI exchange after a successful generation. */
  saveChatMessage,
  /** Get last N messages in chronological order for LLM context injection. */
  getChatHistory,
  /** Delete all history for a user (GDPR / data hygiene). */
  clearUserChatHistory,
  /** Cursor-paginated history for the conversation history UI. */
  getPaginatedHistory,
};
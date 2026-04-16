/**
 * @file db/models/chatModel.js
 * @description Data access layer for the `chat_history` table.
 *
 * This module manages the persistence and retrieval of conversations between
 * users and the Nyaya-Mitra AI assistant.
 *
 * WHY CONVERSATION HISTORY MATTERS IN RAG:
 *   LLMs are stateless — they have no memory between API calls. To enable
 *   coherent multi-turn conversations ("follow up on what you said earlier"),
 *   we maintain a "sliding window" of the last N exchanges in the database
 *   and inject them into every LLM prompt as context.
 *
 * TYPICAL PROMPT CONSTRUCTION WITH HISTORY:
 *   1. User asks: "What is Section 420 of IPC?"
 *   2. We call getChatHistory(userId, 5) → last 5 Q&A pairs
 *   3. We call semanticSearch(queryVector, 5) → relevant legal chunks
 *   4. LLM prompt = [system prompt] + [history] + [retrieved chunks] + [user question]
 *   5. LLM responds → we call saveChatMessage(userId, question, answer)
 *
 * SLIDING WINDOW TRADE-OFF:
 *   - Larger N = more coherent long conversations, but more LLM tokens = higher cost.
 *   - For legal Q&A, 5-10 exchanges is typically sufficient.
 *   - Consider implementing per-user session management for production at scale.
 */

'use strict';

const { query } = require('../connection');

// ---------------------------------------------------------------------------
// WRITE: Save a New Chat Exchange to History
// ---------------------------------------------------------------------------

/**
 * Persists a single user↔AI exchange to the `chat_history` table.
 *
 * Call this AFTER a successful AI response has been generated and returned
 * to the user — not before — to avoid saving failed or error responses.
 *
 * @param {string} userId     - The UUID of the user who asked the question.
 *                              Must correspond to an existing row in `users`.
 * @param {string} queryText  - The user's original message/question, verbatim.
 * @param {string} aiResponse - The AI assistant's full response text.
 * @returns {Promise<Object>} The saved message row: { message_id, user_id,
 *                            query_text, ai_response, timestamp }
 * @throws {Error} On FK violation (user not found), or connection failure.
 *
 * @example
 * const saved = await saveChatMessage(
 *   'a1b2-c3d4-...',
 *   'What are my rights if I am arrested?',
 *   'Under Article 22 of the Indian Constitution, you have the right to...'
 * );
 * console.log('Saved with ID:', saved.message_id);
 */
const saveChatMessage = async (userId, queryText, aiResponse) => {
  // Basic input validation to surface clear errors early.
  if (!userId)     throw new Error('[chatModel] saveChatMessage: userId is required.');
  if (!queryText)  throw new Error('[chatModel] saveChatMessage: queryText is required.');
  if (!aiResponse) throw new Error('[chatModel] saveChatMessage: aiResponse is required.');

  const sql = `
    INSERT INTO chat_history
      (user_id, query_text, ai_response)
    VALUES
      ($1, $2, $3)
    RETURNING
      message_id,
      user_id,
      query_text,
      ai_response,
      timestamp
  `;

  const { rows } = await query(sql, [userId, queryText, aiResponse]);

  // RETURNING on INSERT guarantees exactly one row.
  return rows[0];
};


// ---------------------------------------------------------------------------
// READ: Retrieve Recent Chat History for Context Window
// ---------------------------------------------------------------------------

/**
 * Retrieves the most recent N chat exchanges for a given user.
 *
 * The results are returned in CHRONOLOGICAL order (oldest first) so they
 * can be directly injected into the LLM prompt in the correct temporal
 * sequence without additional sorting on the application side.
 *
 * IMPLEMENTATION NOTE — Double-ORDER-BY Pattern:
 *   To efficiently get the LAST N rows but return them in ASC order,
 *   we use a subquery:
 *     1. Inner query: ORDER BY timestamp DESC, LIMIT N  → gets the N most recent rows.
 *     2. Outer query: ORDER BY timestamp ASC            → re-sorts them chronologically.
 *   This avoids fetching all rows and is efficiently supported by the
 *   composite index `idx_chat_history_user_timestamp`.
 *
 * @param {string} userId - The UUID of the user whose history to retrieve.
 * @param {number} [limit=10] - Number of most recent messages to return.
 *                              Recommended range: 5–15 for typical LLM context windows.
 *                              Clamped internally to max 50 to prevent accidental overload.
 * @returns {Promise<Array<{
 *   message_id:  string,
 *   user_id:     string,
 *   query_text:  string,
 *   ai_response: string,
 *   timestamp:   Date
 * }>>} Array of message objects in chronological order (oldest → newest).
 *      Returns an empty array if the user has no history.
 * @throws {Error} On connection failure.
 *
 * @example
 * const history = await getChatHistory('a1b2-c3d4-...', 5);
 *
 * // Build Gemini-compatible conversation history format:
 * const conversationContext = history.map(msg => [
 *   { role: 'user',  parts: [{ text: msg.query_text  }] },
 *   { role: 'model', parts: [{ text: msg.ai_response }] },
 * ]).flat();
 *
 * // Now prepend to the Gemini multi-turn request:
 * const geminiResponse = await gemini.generateContent({
 *   contents: [
 *     ...conversationContext,
 *     { role: 'user', parts: [{ text: currentUserQuestion }] }
 *   ]
 * });
 */
const getChatHistory = async (userId, limit = 10) => {
  if (!userId) throw new Error('[chatModel] getChatHistory: userId is required.');

  // Clamp limit between 1 and 50 to prevent memory/token overruns.
  const clampedLimit = Math.max(1, Math.min(limit, 50));

  // The double-ORDER-BY subquery pattern explained above.
  // The inner query efficiently uses idx_chat_history_user_timestamp.
  const sql = `
    SELECT
      message_id,
      user_id,
      query_text,
      ai_response,
      timestamp
    FROM (
      -- Inner query: fetch the N most recent messages for this user.
      -- The composite index (user_id, timestamp DESC) makes this a fast index scan.
      SELECT
        message_id,
        user_id,
        query_text,
        ai_response,
        timestamp
      FROM
        chat_history
      WHERE
        user_id = $1
      ORDER BY
        timestamp DESC
      LIMIT $2
    ) AS recent_messages

    -- Outer query: re-sort to chronological (oldest → newest) for prompt injection.
    ORDER BY
      timestamp ASC
  `;

  const { rows } = await query(sql, [userId, clampedLimit]);

  // pg returns TIMESTAMPTZ columns as JavaScript Date objects automatically.
  // No manual parsing needed.
  return rows;
};


// ---------------------------------------------------------------------------
// UTILITY: Delete a User's Entire Chat History
// ---------------------------------------------------------------------------

/**
 * Permanently deletes all chat history for a given user.
 *
 * Use cases:
 *   - User requests data deletion (GDPR / right to erasure).
 *   - Admin action to clear a corrupted conversation state.
 *   - Starting a fresh "session" for a user.
 *
 * NOTE: The `users` table has `ON DELETE CASCADE` on `chat_history.user_id`,
 * so deleting the user account also deletes history automatically. This
 * function is for deleting history WITHOUT deleting the account.
 *
 * @param {string} userId - The UUID of the user whose history to delete.
 * @returns {Promise<number>} The count of deleted rows.
 * @throws {Error} On connection failure.
 *
 * @example
 * const deletedCount = await clearUserChatHistory('a1b2-c3d4-...');
 * console.log(`Cleared ${deletedCount} messages.`);
 */
const clearUserChatHistory = async (userId) => {
  if (!userId) throw new Error('[chatModel] clearUserChatHistory: userId is required.');

  const sql = `
    DELETE FROM chat_history
    WHERE user_id = $1
  `;

  const result = await query(sql, [userId]);

  // `rowCount` on a DELETE statement returns the number of rows deleted.
  return result.rowCount;
};


// ---------------------------------------------------------------------------
// UTILITY: Get Paginated Chat History (for UI history display)
// ---------------------------------------------------------------------------

/**
 * Retrieves a paginated slice of a user's chat history for display in a
 * "conversation history" UI (not for LLM context injection — use getChatHistory
 * for that).
 *
 * Uses cursor-based pagination via the `before` timestamp parameter,
 * which is more efficient and consistent than OFFSET-based pagination
 * (OFFSET scans are O(N) and suffer from "page drift" on new inserts).
 *
 * @param {string} userId         - The UUID of the user.
 * @param {number} [pageSize=20]  - Messages per page (max 100).
 * @param {Date|string|null} [before=null] - Fetch messages BEFORE this timestamp
 *                                           (exclusive). Pass null for the first page
 *                                           (most recent messages).
 * @returns {Promise<Array<Object>>} Page of messages, newest first.
 *
 * @example
 * // First page (most recent 20 messages):
 * const page1 = await getPaginatedHistory(userId, 20, null);
 *
 * // Next page (use the timestamp of the oldest message in page1 as cursor):
 * const oldestTimestamp = page1[page1.length - 1].timestamp;
 * const page2 = await getPaginatedHistory(userId, 20, oldestTimestamp);
 */
const getPaginatedHistory = async (userId, pageSize = 20, before = null) => {
  if (!userId) throw new Error('[chatModel] getPaginatedHistory: userId is required.');

  const clampedPageSize = Math.max(1, Math.min(pageSize, 100));

  // Build query dynamically based on whether a cursor timestamp was provided.
  const params = [userId, clampedPageSize];
  let cursorCondition = '';

  if (before) {
    params.push(before); // $3
    cursorCondition = 'AND timestamp < $3';
  }

  const sql = `
    SELECT
      message_id,
      user_id,
      query_text,
      ai_response,
      timestamp
    FROM
      chat_history
    WHERE
      user_id = $1
      ${cursorCondition}
    ORDER BY
      timestamp DESC
    LIMIT $2
  `;

  const { rows } = await query(sql, params);
  return rows;
};


// ---------------------------------------------------------------------------
// Module Exports
// ---------------------------------------------------------------------------

module.exports = {
  /**
   * Save a new user↔AI chat exchange to the database.
   * @type {typeof saveChatMessage}
   */
  saveChatMessage,

  /**
   * Get the last N messages for a user, in chronological order, for LLM context.
   * @type {typeof getChatHistory}
   */
  getChatHistory,

  /**
   * Permanently delete all chat history for a user (GDPR / data hygiene).
   * @type {typeof clearUserChatHistory}
   */
  clearUserChatHistory,

  /**
   * Get paginated chat history for UI display (cursor-based pagination).
   * @type {typeof getPaginatedHistory}
   */
  getPaginatedHistory,
};
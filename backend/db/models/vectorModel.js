/**
 * @file db/models/vectorModel.js
 * @description Data access layer for the `legal_knowledge_base` table.
 *
 * This module is the core of the RAG (Retrieval-Augmented Generation) pipeline.
 * It provides two primary operations:
 *
 *   1. `insertKnowledgeChunk` — Persist a pre-chunked legal text and its
 *      Gemini-generated embedding vector into the knowledge base. Called during
 *      the offline "ingestion" phase (e.g., a one-time script to load IPC/CrPC).
 *
 *   2. `semanticSearch` — Given a query embedding vector (from the user's
 *      question), find the Top-K most semantically similar chunks using cosine
 *      distance and the HNSW index. Called in real-time on every user query.
 *
 * RAG PIPELINE CONTEXT:
 *   [User Question]
 *       → Gemini Embedding API → [Query Vector 3072-dim]
 *       → semanticSearch()    → [Top-K Relevant Legal Chunks]
 *       → Inject into LLM Prompt
 *       → Gemini LLM          → [Grounded Answer with Citations]
 *
 * IMPORTANT — pg and pgvector Array Format:
 *   The `pg` library does not natively serialize JavaScript Arrays into the
 *   pgvector wire format. We must stringify the array as a PostgreSQL
 *   array literal: '[0.12, -0.45, ...]'::halfvec
 *   We do this by passing JSON.stringify(array) and casting in the SQL.
 */

'use strict';

const { query } = require('../connection');

// ---------------------------------------------------------------------------
// INSERT: Add a New Knowledge Chunk to the Knowledge Base
// ---------------------------------------------------------------------------

/**
 * Inserts a single pre-chunked legal document and its embedding vector into
 * the `legal_knowledge_base` table.
 *
 * This function is intended to be called from an ingestion script
 * (e.g., `scripts/ingestLegalData.js`), not from a user-facing API route.
 * Wrap multiple inserts in a transaction for bulk operations.
 *
 * @param {string}   datasetSource - The source dataset identifier.
 *                                   Example: 'IPC_1860', 'SupremeCourt_2023'
 * @param {string}   documentType  - The type of legal document.
 *                                   Example: 'statute', 'judgement', 'faq'
 * @param {string}   contentText   - The raw text of the knowledge chunk.
 *                                   Keep chunks to ~256-512 tokens for best results.
 * @param {number[]} vectorArray   - The 3072-dimensional embedding from Gemini's
 *                                   gemini-embedding-001 model. Must be exactly
 *                                   3072 float values.
 * @returns {Promise<Object>} The newly inserted row: { vector_id, dataset_source,
 *                            document_type, content_text }
 * @throws {Error} On DB constraint violation or connection failure.
 *
 * @example
 * const embedding = await geminiClient.embedContent('Section 302 IPC...');
 * const chunk = await insertKnowledgeChunk(
 *   'IPC_1860',
 *   'statute',
 *   'Section 302 — Punishment for Murder: Whoever commits murder shall be...',
 *   embedding.values  // Array of 3072 floats
 * );
 * console.log('Inserted chunk ID:', chunk.vector_id);
 */
const insertKnowledgeChunk = async (
  datasetSource,
  documentType,
  contentText,
  vectorArray
) => {
  // Validate the vector dimensionality BEFORE hitting the DB to get a clear
  // error message instead of a cryptic PostgreSQL type mismatch error.
  if (!Array.isArray(vectorArray) || vectorArray.length !== 3072) {
    throw new Error(
      `[vectorModel] insertKnowledgeChunk: vectorArray must be a number[] of ` +
      `exactly 3072 elements. Received length: ${vectorArray?.length ?? 'N/A'}`
    );
  }

  // Serialize the JS array to a PostgreSQL array literal string.
  // The ::halfvec cast in SQL converts it to the pgvector halfvec type.
  // Example output: '[0.0012, -0.4521, ...]'
  const vectorLiteral = JSON.stringify(vectorArray);

  const sql = `
    INSERT INTO legal_knowledge_base
      (dataset_source, document_type, content_text, embedding)
    VALUES
      ($1, $2, $3, $4::halfvec)
    RETURNING
      vector_id,
      dataset_source,
      document_type,
      content_text
  `;

  const params = [datasetSource, documentType, contentText, vectorLiteral];

  const { rows } = await query(sql, params);

  // RETURNING guarantees exactly one row on a successful INSERT.
  return rows[0];
};


// ---------------------------------------------------------------------------
// SEARCH: Approximate Nearest Neighbor Semantic Search
// ---------------------------------------------------------------------------

/**
 * Performs a cosine similarity semantic search over the `legal_knowledge_base`
 * using the HNSW index.
 *
 * Given a 3072-dimensional query vector (the embedding of the user's question),
 * this function returns the Top-K most semantically similar legal text chunks.
 * These chunks form the "retrieved context" that is injected into the LLM prompt.
 *
 * COSINE DISTANCE vs. COSINE SIMILARITY:
 *   pgvector's <=> operator returns COSINE DISTANCE = 1 - cosine_similarity.
 *   Range: 0 (identical direction) to 2 (opposite direction).
 *   We ORDER BY distance ASC so the MOST SIMILAR results come first.
 *   We alias it as `similarity_score` and subtract from 1 so the returned
 *   value is intuitive: 1.0 = perfect match, 0.0 = unrelated.
 *
 * METADATA FILTERING:
 *   An optional `filters` object allows pre-filtering by document_type and/or
 *   dataset_source BEFORE the ANN search. This is called "pre-filtering" and
 *   is supported by pgvector's HNSW implementation.
 *
 *   NOTE: Aggressive pre-filtering (e.g., only 100 rows match the filter) can
 *   reduce HNSW recall because the graph has fewer candidates to explore.
 *   For very selective filters, consider post-filtering or a larger `topK`.
 *
 * @param {number[]} queryVector  - The 3072-dim embedding of the user's question.
 * @param {number}   [topK=5]     - Number of top results to return. Typical
 *                                  values: 3-10. Larger = more context but more
 *                                  LLM tokens and slower generation.
 * @param {Object}   [filters={}] - Optional metadata filters.
 * @param {string}   [filters.documentType]  - Filter by document type.
 *                                  Example: 'statute', 'judgement'
 * @param {string}   [filters.datasetSource] - Filter by dataset source.
 *                                  Example: 'IPC_1860'
 * @returns {Promise<Array<{
 *   vector_id:       number,
 *   dataset_source:  string,
 *   document_type:   string,
 *   content_text:    string,
 *   similarity_score: number
 * }>>} Array of up to `topK` rows, ordered by descending similarity (best first).
 * @throws {Error} On connection failure or malformed vector input.
 *
 * @example
 * // Basic search — no metadata filter
 * const queryEmbedding = await gemini.embedContent(userQuestion);
 * const results = await semanticSearch(queryEmbedding.values, 5);
 *
 * // Filtered search — only return IPC statutes
 * const results = await semanticSearch(queryEmbedding.values, 5, {
 *   documentType: 'statute',
 *   datasetSource: 'IPC_1860'
 * });
 *
 * results.forEach(r => {
 *   console.log(`Score: ${r.similarity_score.toFixed(4)} | ${r.content_text.substring(0, 80)}`);
 * });
 */
const semanticSearch = async (queryVector, topK = 5, filters = {}) => {
  // --- Input Validation ---
  if (!Array.isArray(queryVector) || queryVector.length !== 3072) {
    throw new Error(
      `[vectorModel] semanticSearch: queryVector must be a number[] of exactly ` +
      `3072 elements. Received length: ${queryVector?.length ?? 'N/A'}`
    );
  }

  const clampedTopK = Math.max(1, Math.min(topK, 50)); // Safety clamp: 1–50

  // --- Build Dynamic WHERE Clause for Optional Metadata Filters ---
  // We use a dynamic params array and condition list to cleanly support
  // optional filters without string interpolation (which risks SQL injection).
  //
  // The query vector ($1) is always the first parameter.
  // Additional filter values are appended as $2, $3, etc.
  const params = [JSON.stringify(queryVector)]; // $1 — query vector
  const conditions = [];                         // WHERE clause fragments
  let paramIndex = 2;                            // Next available $N placeholder

  if (filters.documentType) {
    conditions.push(`document_type = $${paramIndex}`);
    params.push(filters.documentType);
    paramIndex++;
  }

  if (filters.datasetSource) {
    conditions.push(`dataset_source = $${paramIndex}`);
    params.push(filters.datasetSource);
    paramIndex++;
  }

  // topK is a LIMIT value (integer), safe to interpolate since it's
  // clamped and validated above — not user-supplied raw input.
  // However, we add it as a parameter for full consistency and safety.
  params.push(clampedTopK); // $paramIndex — LIMIT value
  const limitPlaceholder = `$${paramIndex}`;

  // Compose the optional WHERE clause.
  // If no filters were provided, whereClause is an empty string and
  // the query runs as a full-corpus search.
  const whereClause =
    conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

  // --- HNSW Search Quality Hint ---
  // ef_search controls how many candidates the HNSW graph explores at query time.
  // Higher values = better recall but slightly slower. 100 is a good balance
  // for legal RAG (where recall quality is more important than raw latency).
  // This is a session-level setting that applies only to this DB connection
  // checkout (the pool returns it afterward, resetting for the next caller).
  // We set it in the same query batch using a CTE approach, or as a separate call.
  //
  // We set it separately before the main query for clarity:
  await query('SET LOCAL hnsw.ef_search = 100');

  // --- Main Semantic Search Query ---
  //
  // QUERY BREAKDOWN:
  //   1::halfvec cast: Converts the JSON array literal in $1 to a halfvec type.
  //   <=>: pgvector COSINE DISTANCE operator. Returns 0.0 (identical) to 2.0 (opposite).
  //   1 - (embedding <=> $1::halfvec): Converts distance → similarity score (0–1).
  //   ORDER BY ... ASC: Ascending distance = descending similarity = best matches first.
  //   LIMIT $N: Parameterized LIMIT. pg accepts integer parameters for LIMIT.
  const sql = `
    SELECT
      vector_id,
      dataset_source,
      document_type,
      content_text,
      -- Convert cosine distance to similarity score for intuitive interpretation.
      -- Score of 1.0 = identical vectors, 0.0 = orthogonal (unrelated).
      (1 - (embedding <=> $1::halfvec)) AS similarity_score
    FROM
      legal_knowledge_base
    ${whereClause}
    ORDER BY
      -- Order by RAW DISTANCE (ascending) rather than computed similarity
      -- so PostgreSQL can use the HNSW index efficiently.
      -- Recalculating 1-distance for the ORDER BY would prevent index use.
      embedding <=> $1::halfvec ASC
    LIMIT
      ${limitPlaceholder}
  `;

  const { rows } = await query(sql, params);

  // Parse similarity_score from string (pg returns numerics as strings) to float.
  return rows.map((row) => ({
    ...row,
    similarity_score: parseFloat(row.similarity_score),
  }));
};


// ---------------------------------------------------------------------------
// UTILITY: Bulk Insert (for ingestion scripts)
// ---------------------------------------------------------------------------

/**
 * Bulk-inserts multiple knowledge chunks in a single database transaction.
 * Significantly faster than calling `insertKnowledgeChunk` in a loop
 * (avoids N round-trips; single BEGIN/COMMIT).
 *
 * @param {Array<{
 *   datasetSource: string,
 *   documentType:  string,
 *   contentText:   string,
 *   vectorArray:   number[]
 * }>} chunks - Array of chunk objects to insert.
 *
 * @returns {Promise<number>} The number of rows successfully inserted.
 * @throws {Error} Rolls back the entire transaction on any failure.
 *
 * @example
 * const chunks = ipcSections.map(section => ({
 *   datasetSource: 'IPC_1860',
 *   documentType:  'statute',
 *   contentText:   section.text,
 *   vectorArray:   section.embedding,
 * }));
 * const count = await bulkInsertKnowledgeChunks(chunks);
 * console.log(`Inserted ${count} IPC sections.`);
 */
const bulkInsertKnowledgeChunks = async (chunks) => {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error('[vectorModel] bulkInsertKnowledgeChunks: chunks array is empty or invalid.');
  }

  // Import the pool directly for manual transaction management.
  const { pool } = require('../connection');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let insertedCount = 0;

    for (const chunk of chunks) {
      const { datasetSource, documentType, contentText, vectorArray } = chunk;

      if (!Array.isArray(vectorArray) || vectorArray.length !== 3072) {
        // Roll back and surface a clear error if any chunk has a bad vector.
        throw new Error(
          `[vectorModel] bulkInsert: Chunk "${contentText?.substring(0, 40)}..." ` +
          `has invalid vectorArray length: ${vectorArray?.length}`
        );
      }

      await client.query(
        `INSERT INTO legal_knowledge_base
           (dataset_source, document_type, content_text, embedding)
         VALUES ($1, $2, $3, $4::halfvec)`,
        [datasetSource, documentType, contentText, JSON.stringify(vectorArray)]
      );

      insertedCount++;
    }

    await client.query('COMMIT');
    console.log(`[vectorModel] Bulk insert committed: ${insertedCount} chunks.`);
    return insertedCount;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[vectorModel] Bulk insert failed — transaction rolled back:', err.message);
    throw err;
  } finally {
    // CRITICAL: Always release the client back to the pool,
    // even if an error occurred. Failure to release causes pool exhaustion.
    client.release();
  }
};


// ---------------------------------------------------------------------------
// Module Exports
// ---------------------------------------------------------------------------

module.exports = {
  insertKnowledgeChunk,
  semanticSearch,
  bulkInsertKnowledgeChunks,
};
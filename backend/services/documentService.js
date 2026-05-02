'use strict';

/**
 * @file services/documentService.js
 * @description Orchestrates the complete document analysis pipeline.
 *
 * CACHING STRATEGY:
 *   - On every upload, SHA-256 hash the raw file bytes
 *   - Check Supabase user_documents for an existing row with that hash
 *   - If found, fetch stored clauses and return immediately (no Groq/Gemini calls)
 *   - If not found, run full pipeline and store hash alongside the result
 *
 * This means:
 *   - Same file uploaded by same user → instant cache hit from DB
 *   - Same file uploaded by different user → new analysis (intentional)
 */

const fs     = require('fs');
const crypto = require('crypto');
const { pool } = require('../db/connection');
const { semanticSearch } = require('../db/models/vectorModel');
const extractionService = require('./extractionService');
const geminiService     = require('./geminiService');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BATCH_SIZE     = 5;
const BATCH_DELAY_MS = 1000;

// ---------------------------------------------------------------------------
// Utility: Sleep
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Utility: Hash file content for cache key
// ---------------------------------------------------------------------------

const hashFile = (filePath) => {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
};

// ---------------------------------------------------------------------------
// Utility: Determine overall risk level
// ---------------------------------------------------------------------------

const determineOverallRiskLevel = (riskyClauses) => {
  if (!riskyClauses || riskyClauses.length === 0) return 'low';
  const hasLevel = (level) => riskyClauses.some(c => c.risk_level === level);
  if (hasLevel('critical')) return 'critical';
  if (hasLevel('high'))     return 'high';
  if (hasLevel('medium'))   return 'medium';
  return 'low';
};

// ---------------------------------------------------------------------------
// Utility: Fetch existing analysis from DB by doc_id
// ---------------------------------------------------------------------------

const fetchStoredAnalysis = async (docId) => {
  const docResult = await pool.query(
    `SELECT doc_id, document_name, risk_level, generated_summary, uploaded_at
     FROM user_documents
     WHERE doc_id = $1`,
    [docId]
  );

  if (docResult.rows.length === 0) return null;
  const doc = docResult.rows[0];

  const clausesResult = await pool.query(
    `SELECT clause_number, clause_text, is_risky, risk_level,
            issue, relevant_law, recommendation
     FROM document_clauses
     WHERE doc_id = $1
     ORDER BY clause_number ASC`,
    [docId]
  );

  const clauses        = clausesResult.rows;
  const riskyCount     = clauses.filter(c => c.is_risky).length;

  return {
    doc_id:             doc.doc_id,
    document_name:      doc.document_name,
    overall_risk_level: doc.risk_level,
    total_clauses:      clauses.length,
    risky_clauses:      riskyCount,
    summary:            doc.generated_summary,
    uploaded_at:        doc.uploaded_at,
    source:             'database_cache',
    analysis:           clauses,
  };
};

// ---------------------------------------------------------------------------
// Main: Analyze uploaded document
// ---------------------------------------------------------------------------

/**
 * Complete document analysis pipeline with content-hash caching.
 *
 * @param {string} filePath     - Path to the uploaded file
 * @param {string} mimetype     - File MIME type
 * @param {string} documentName - Human-readable document name
 * @param {string} userId       - User UUID who uploaded the document
 * @returns {Promise<Object>}   Analysis results
 */
const analyzeDocument = async (filePath, mimetype, documentName, userId) => {
  console.log(`[documentService] Starting analysis for ${documentName}`);

  try {
    // ===== STEP 0: Content Hash Cache Check =====
    console.log('[documentService] Step 0: Checking content hash cache...');
    const fileHash = hashFile(filePath);
    console.log(`[documentService] File hash: ${fileHash.substring(0, 16)}...`);

    // Check if this exact file content was already analyzed by this user
    const existingDoc = await pool.query(
      `SELECT doc_id FROM user_documents
       WHERE user_id = $1 AND file_hash = $2
       LIMIT 1`,
      [userId, fileHash]
    );

    if (existingDoc.rows.length > 0) {
      const cachedDocId = existingDoc.rows[0].doc_id;
      console.log(`[documentService] Cache HIT — returning stored analysis for doc ${cachedDocId}`);

      // Clean up uploaded file since we don't need it
      try { fs.unlinkSync(filePath); } catch (_) {}

      const stored = await fetchStoredAnalysis(cachedDocId);
      if (stored) return stored;
      // If fetch fails for some reason, fall through to re-analyze
      console.warn('[documentService] Cache hit but fetch failed — re-analyzing');
    } else {
      console.log('[documentService] Cache MISS — running full analysis');
    }

    // ===== STEP 1: Extract Text =====
    console.log('[documentService] Step 1: Extracting text...');
    const rawText = await extractionService.extractText(filePath, mimetype);
    console.log(`[documentService] Text extracted: ${rawText.length} characters`);

    // ===== STEP 2: Extract Clauses =====
    console.log('[documentService] Step 2: Extracting clauses...');
    const clauses = await geminiService.extractClauses(rawText);
    console.log(`[documentService] Clauses extracted: ${clauses.length} clauses`);

    if (!clauses || clauses.length === 0) {
      throw new Error('No clauses found in document');
    }

    // ===== STEP 3: Analyze Clauses in Batches =====
    console.log(`[documentService] Step 3: Analyzing ${clauses.length} clauses...`);
    const allAnalyses = [];

    for (let i = 0; i < clauses.length; i += BATCH_SIZE) {
      const batch = clauses.slice(i, i + BATCH_SIZE);

      const batchPromises = batch.map(async (clause) => {
        try {
          const embedding     = await geminiService.embedText(clause.clause_text);
          const searchResults = await semanticSearch(embedding, 5);
          const retrievedLaws = searchResults.map(r => r.content_text);
          const analysis      = await geminiService.analyzeClause(
            clause.clause_text,
            retrievedLaws
          );
          return { ...clause, ...analysis, retrieved_laws: retrievedLaws };
        } catch (err) {
          console.error(`[documentService] Failed clause ${clause.clause_number}:`, err.message);
          throw err;
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          allAnalyses.push(result.value);
        } else {
          console.warn(`[documentService] Batch error: ${result.reason?.message}`);
        }
      }

      const progress = Math.min(i + BATCH_SIZE, clauses.length);
      console.log(`[documentService] Analyzed ${progress}/${clauses.length} clauses`);

      if (i + BATCH_SIZE < clauses.length) await sleep(BATCH_DELAY_MS);
    }

    // ===== STEP 4: Filter + Risk Level =====
    console.log('[documentService] Step 4: Filtering risky clauses...');
    const riskyClauseAnalyses = allAnalyses.filter(c => c.is_risky === true);
    console.log(`[documentService] Risky clauses: ${riskyClauseAnalyses.length}/${allAnalyses.length}`);

    const overallRiskLevel = determineOverallRiskLevel(riskyClauseAnalyses);
    console.log(`[documentService] Overall risk level: ${overallRiskLevel}`);

    // ===== STEP 5: Generate Summary =====
    console.log('[documentService] Step 5: Generating summary...');
    const summary = riskyClauseAnalyses.length > 0
      ? await geminiService.generateSummary(riskyClauseAnalyses, documentName)
      : `${documentName} contains no significant legal risks.`;

    // ===== STEP 6: Save to Database (with file_hash) =====
    console.log('[documentService] Step 6: Saving to database...');

    // NOTE: If file_hash column does not exist yet, run this in Supabase SQL Editor:
    // ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS file_hash VARCHAR(64);
    // CREATE INDEX IF NOT EXISTS idx_user_documents_hash ON user_documents(user_id, file_hash);
    const saveResult = await pool.query(
      `INSERT INTO user_documents
         (user_id, document_name, raw_text, risk_level, generated_summary, file_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING doc_id`,
      [userId, documentName, rawText, overallRiskLevel, summary, fileHash]
    );

    const docId = saveResult.rows[0].doc_id;
    console.log(`[documentService] Document saved with ID: ${docId}`);

    // ===== STEP 7: Save Clause Analyses =====
    console.log('[documentService] Step 7: Saving clause analyses...');
    for (const clause of allAnalyses) {
      try {
        await pool.query(
          `INSERT INTO document_clauses
             (doc_id, clause_number, clause_text, is_risky, risk_level,
              issue, relevant_law, recommendation, retrieved_laws)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            docId,
            clause.clause_number,
            clause.clause_text,
            clause.is_risky,
            clause.is_risky ? clause.risk_level    : null,
            clause.is_risky ? clause.issue         : null,
            clause.is_risky ? clause.relevant_law  : null,
            clause.is_risky ? clause.recommendation: null,
            clause.retrieved_laws
              ? clause.retrieved_laws.join('\n\n---\n\n')
              : null,
          ]
        );
      } catch (err) {
        console.warn(`[documentService] Failed to save clause ${clause.clause_number}:`, err.message);
      }
    }
    console.log(`[documentService] Saved ${allAnalyses.length} clauses`);

    return {
      doc_id:             docId,
      document_name:      documentName,
      overall_risk_level: overallRiskLevel,
      total_clauses:      allAnalyses.length,
      risky_clauses:      riskyClauseAnalyses.length,
      summary,
      source:             'ai_api',
      analysis:           allAnalyses,
    };

  } catch (err) {
    console.error('[documentService] Analysis failed:', err.message);
    throw err;
  }
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { analyzeDocument };
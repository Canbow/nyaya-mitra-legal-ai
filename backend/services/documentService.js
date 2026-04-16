'use strict';

/**
 * @file services/documentService.js
 * @description Orchestrates the complete document analysis pipeline.
 *
 * Pipeline:
 *   1. Extract text from uploaded file
 *   2. Parse clauses/statements
 *   3. Analyze each clause against legal knowledge base
 *   4. Assess overall risk level
 *   5. Generate summary
 *   6. Persist to database
 */

const { pool } = require('../db/connection');
const { semanticSearch } = require('../db/models/vectorModel');
const { saveChatMessage } = require('../db/models/chatModel');
const extractionService = require('./extractionService');
const geminiService = require('./geminiService');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000; // ms between batches to respect rate limits

// ---------------------------------------------------------------------------
// Utility: Sleep
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Utility: Determine overall risk level
// ---------------------------------------------------------------------------

const determineOverallRiskLevel = (riskyClauses) => {
  if (!riskyClauses || riskyClauses.length === 0) return 'low';
  
  const hasLevel = (level) => riskyClauses.some(c => c.risk_level === level);
  
  if (hasLevel('critical')) return 'critical';
  if (hasLevel('high')) return 'high';
  if (hasLevel('medium')) return 'medium';
  return 'low';
};

// ---------------------------------------------------------------------------
// Main: Analyze uploaded document
// ---------------------------------------------------------------------------

/**
 * Complete document analysis pipeline.
 *
 * @param {string} filePath - Path to the uploaded file
 * @param {string} mimetype - File MIME type
 * @param {string} documentName - Human-readable document name
 * @param {string} userId - User UUID who uploaded the document
 * @returns {Promise<Object>} Analysis results with doc_id, risk levels, summary
 * @throws {Error} On any step failure
 *
 * @example
 * const result = await analyzeDocument(
 *   '/uploads/contract.pdf',
 *   'application/pdf',
 *   'Employment Agreement',
 *   'user-uuid-1234'
 * );
 * // Returns:
 * // {
 * //   doc_id: 'uuid-from-db',
 * //   document_name: 'Employment Agreement',
 * //   overall_risk_level: 'high',
 * //   total_clauses: 42,
 * //   risky_clauses: 5,
 * //   summary: 'This employment...',
 * //   analysis: [{ clause_number, is_risky, risk_level, ... }, ...]
 * // }
 */
const analyzeDocument = async (filePath, mimetype, documentName, userId) => {
  console.log(`[documentService] Starting analysis for ${documentName}`);
  
  try {
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
          // 3a. Embed the clause
          const embedding = await geminiService.embedText(clause.clause_text);
          
          // 3b. Search for relevant laws
          const searchResults = await semanticSearch(embedding, 5);
          
          // 3c. Extract law texts
          const retrievedLaws = searchResults.map(r => r.content_text);
          
          // 3d. Analyze the clause
          const analysis = await geminiService.analyzeClause(
            clause.clause_text,
            retrievedLaws
          );
          
          // 3e. Combine results
          return {
            ...clause,
            ...analysis,
            retrieved_laws: retrievedLaws,
          };
        } catch (err) {
          console.error(`[documentService] Failed to analyze clause ${clause.clause_number}:`, err.message);
          throw err;
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);
      
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          allAnalyses.push(result.value);
        } else {
          console.warn(`[documentService] Batch analysis failed: ${result.reason.message}`);
        }
      }

      const progress = Math.min(i + BATCH_SIZE, clauses.length);
      console.log(`[documentService] Analyzed ${progress}/${clauses.length} clauses`);

      // Wait between batches
      if (i + BATCH_SIZE < clauses.length) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    // ===== STEP 4: Filter Risky Clauses =====
    console.log('[documentService] Step 4: Filtering risky clauses...');
    const riskyClauseAnalyses = allAnalyses.filter(c => c.is_risky === true);
    console.log(`[documentService] Risky clauses: ${riskyClauseAnalyses.length}/${allAnalyses.length}`);

    // ===== STEP 5: Determine Overall Risk =====
    const overallRiskLevel = determineOverallRiskLevel(riskyClauseAnalyses);
    console.log(`[documentService] Overall risk level: ${overallRiskLevel}`);

    // ===== STEP 6: Generate Summary =====
    console.log('[documentService] Step 5: Generating summary...');
    const summary = riskyClauseAnalyses.length > 0
      ? await geminiService.generateSummary(riskyClauseAnalyses, documentName)
      : `${documentName} contains no significant legal risks.`;

    // ===== STEP 7: Save to Database =====
    console.log('[documentService] Step 6: Saving to database...');
    const saveResult = await pool.query(
      `INSERT INTO user_documents
        (user_id, document_name, raw_text, risk_level, generated_summary)
       VALUES
        ($1, $2, $3, $4, $5)
       RETURNING doc_id`,
      [userId, documentName, rawText, overallRiskLevel, summary]
    );

    const docId = saveResult.rows[0].doc_id;
    console.log(`[documentService] Document saved with ID: ${docId}`);

    // ===== Return Results =====
    return {
      doc_id: docId,
      document_name: documentName,
      overall_risk_level: overallRiskLevel,
      total_clauses: allAnalyses.length,
      risky_clauses: riskyClauseAnalyses.length,
      summary,
      analysis: allAnalyses,
    };
  } catch (err) {
    console.error('[documentService] Analysis failed:', err.message);
    throw err;
  }
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  analyzeDocument,
};

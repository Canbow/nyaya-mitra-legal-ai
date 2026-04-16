'use strict';

/**
 * @file services/geminiService.js
 * @description Gemini API integration service for embeddings and LLM tasks.
 *
 * Models Used:
 *   - gemini-embedding-001  (3072 dimensions)
 *   - gemini-2.0-flash      (text generation)
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const EMBEDDING_MODEL = 'gemini-embedding-001';
const GENERATION_MODEL = 'gemini-2.0-flash';

// ---------------------------------------------------------------------------
// Gemini Client
// ---------------------------------------------------------------------------

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ---------------------------------------------------------------------------
// Utility: Safely parse JSON from LLM response
// ---------------------------------------------------------------------------

const parseJsonResponse = (text) => {
  // Strip markdown code fences if present
  let cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[geminiService] JSON parse failed:', err.message);
    console.error('[geminiService] Raw response:', text.substring(0, 200));
    throw new Error(`Failed to parse LLM JSON response: ${err.message}`);
  }
};

// ---------------------------------------------------------------------------
// Embed a single text string
// ---------------------------------------------------------------------------

/**
 * Generates a 3072-dimensional embedding for a text string.
 *
 * @param {string} text - The text to embed
 * @returns {Promise<number[]>} Array of 3072 floats
 * @throws {Error} On API error
 *
 * @example
 * const vector = await embedText('Section 420 IPC');
 * console.log(vector.length);  // 3072
 */
const embedText = async (text) => {
  try {
    const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
    const result = await model.embedContent(text);
    
    if (!result.embedding || !result.embedding.values) {
      throw new Error('No embedding in response');
    }
    
    if (result.embedding.values.length !== 3072) {
      throw new Error(
        `Expected 3072 dimensions, got ${result.embedding.values.length}`
      );
    }
    
    return result.embedding.values;
  } catch (err) {
    throw new Error(`[embedText] Embedding failed: ${err.message}`);
  }
};

// ---------------------------------------------------------------------------
// Extract clauses from raw document text
// ---------------------------------------------------------------------------

/**
 * Parses a legal document and extracts individual clauses.
 *
 * Returns a JSON array of objects with `clause_number` and `clause_text`.
 *
 * @param {string} rawText - The full document text
 * @returns {Promise<Array>} Array of { clause_number, clause_text }
 * @throws {Error} On API error or invalid response
 *
 * @example
 * const clauses = await extractClauses(contractText);
 * // Output: [
 * //   { clause_number: 1, clause_text: 'Parties to the agreement...' },
 * //   { clause_number: 2, clause_text: 'Payment terms...' }
 * // ]
 */
const extractClauses = async (rawText) => {
  try {
    const model = genAI.getGenerativeModel({ model: GENERATION_MODEL });
    
    const prompt = `You are a legal document parser.
Extract every distinct clause, section, or meaningful statement from the following legal document text.
Return ONLY a valid JSON array with no explanation, no markdown, no preamble.
Each element must have exactly two fields:
  clause_number: sequential integer starting from 1
  clause_text: the exact text of that clause
If numbered clauses exist preserve that structure.
If continuous prose split by logical legal statements.

Document text:
${rawText}`;

    const response = await model.generateContent(prompt);
    const responseText = response.response.text();
    
    const clauses = parseJsonResponse(responseText);
    
    if (!Array.isArray(clauses)) {
      throw new Error('Expected array of clauses');
    }
    
    return clauses;
  } catch (err) {
    throw new Error(`[extractClauses] Clause extraction failed: ${err.message}`);
  }
};

// ---------------------------------------------------------------------------
// Analyze a single clause against retrieved laws
// ---------------------------------------------------------------------------

/**
 * Analyzes a clause for legal risks using retrieved relevant laws as context.
 *
 * Returns a JSON object with risk assessment and recommendations.
 *
 * @param {string} clauseText - The clause to analyze
 * @param {string[]} retrievedLaws - Array of relevant law texts
 * @returns {Promise<Object>} Risk analysis with fields:
 *   - is_risky: boolean
 *   - risk_level: 'low', 'medium', 'high', 'critical', or null
 *   - issue: string describing the problem (or null if not risky)
 *   - relevant_law: specific article/section that applies (or null)
 *   - recommendation: action to take (or null if not risky)
 * @throws {Error} On API error or invalid response
 */
const analyzeClause = async (clauseText, retrievedLaws) => {
  try {
    const model = genAI.getGenerativeModel({ model: GENERATION_MODEL });
    
    const lawsContext = retrievedLaws && retrievedLaws.length > 0
      ? retrievedLaws.join('\n\n---\n\n')
      : '(No relevant laws retrieved)';
    
    const prompt = `You are an expert Indian legal assistant.
Analyze the following clause from a legal document.

Clause: ${clauseText}

Relevant laws:
${lawsContext}

Respond ONLY with a valid JSON object with these fields:
  is_risky: true or false
  risk_level: low, medium, high, or critical (null if not risky)
  issue: one sentence describing the problem (null if not risky)
  relevant_law: specific article or section that applies (null if not risky)
  recommendation: what the user should do (null if not risky)`;

    const response = await model.generateContent(prompt);
    const responseText = response.response.text();
    
    const analysis = parseJsonResponse(responseText);
    
    // Validate response structure
    if (typeof analysis.is_risky !== 'boolean') {
      throw new Error('is_risky must be boolean');
    }
    
    return analysis;
  } catch (err) {
    throw new Error(`[analyzeClause] Clause analysis failed: ${err.message}`);
  }
};

// ---------------------------------------------------------------------------
// Generate document summary from clause analyses
// ---------------------------------------------------------------------------

/**
 * Generates a plain-language summary of risky clauses in a document.
 *
 * @param {Array} riskyClauseAnalyses - Array of clause analysis objects (only risky ones)
 * @param {string} documentName - Name of the document
 * @returns {Promise<string>} Plain text summary
 * @throws {Error} On API error
 *
 * @example
 * const summary = await generateSummary(riskyAnalyses, 'Employment Contract');
 * // Returns: "This employment contract contains 2 high-risk clauses..."
 */
const generateSummary = async (riskyClauseAnalyses, documentName) => {
  try {
    const model = genAI.getGenerativeModel({ model: GENERATION_MODEL });
    
    const clausesSummary = riskyClauseAnalyses
      .map(c => `- Clause ${c.clause_number}: ${c.issue} (Risk: ${c.risk_level})`)
      .join('\n');
    
    const prompt = `You are an expert Indian legal advisor.
Generate a concise executive summary (2-3 sentences) for a legal document with the following risky clauses:

Document: ${documentName}

Risky clauses found:
${clausesSummary}

Provide only the summary text, no preamble.`;

    const response = await model.generateContent(prompt);
    return response.response.text();
  } catch (err) {
    throw new Error(`[generateSummary] Summary generation failed: ${err.message}`);
  }
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  embedText,
  extractClauses,
  analyzeClause,
  generateSummary,
};

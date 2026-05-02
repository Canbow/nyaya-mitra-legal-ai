'use strict';

/**
 * @file services/geminiService.js
 * @description Gemini API integration service for embeddings and LLM tasks.
 *
 * Models Used:
 *   - gemini-embedding-001  (3072 dimensions)
 *   - gemini-2.0-flash-lite (text generation)
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const EMBEDDING_MODEL = 'gemini-embedding-001';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

// ---------------------------------------------------------------------------
// Gemini Client (for embeddings only)
// ---------------------------------------------------------------------------

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ---------------------------------------------------------------------------
// Groq Client (for text generation)
// ---------------------------------------------------------------------------

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const GROQ_FALLBACK_MODEL = 'llama-3.1-8b-instant'; // Smaller model with higher rate limits

// ---------------------------------------------------------------------------
// Utility: Handle rate limits with retry and fallback
// ---------------------------------------------------------------------------

const callGroqWithFallback = async (messages, temperature, maxTokens, isRateLimit = false) => {
  const model = isRateLimit ? GROQ_FALLBACK_MODEL : GROQ_MODEL;
  
  try {
    const response = await groq.chat.completions.create({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    });
    return response;
  } catch (err) {
    // If rate limited and not already using fallback, retry with fallback model
    if (err.status === 429 && !isRateLimit) {
      console.warn(`[Groq] Rate limit on ${GROQ_MODEL}, retrying with ${GROQ_FALLBACK_MODEL}`);
      // Wait briefly before retry
      await new Promise(resolve => setTimeout(resolve, 1000));
      return callGroqWithFallback(messages, temperature, maxTokens, true);
    }
    throw err;
  }
};

// ---------------------------------------------------------------------------
// Utility: Safely parse JSON from LLM response
// ---------------------------------------------------------------------------

const parseJsonResponse = (text) => {
  if (!text || typeof text !== 'string') {
    throw new Error(`Expected string response, got ${typeof text}`);
  }

  // Strip markdown code fences if present
  let cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  
  try {
    const parsed = JSON.parse(cleaned);
    return parsed;
  } catch (err) {
    console.error('[geminiService] JSON parse failed:', err.message);
    console.error('[geminiService] Cleaned text:', cleaned.substring(0, 500));
    console.error('[geminiService] Original text:', text.substring(0, 500));
    throw new Error(
      `Failed to parse LLM JSON response. Expected valid JSON object. ` +
      `Got: "${cleaned.substring(0, 100)}..."`
    );
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
    const response = await callGroqWithFallback(
      [
        {
          role: 'system',
          content: 'You are a legal document parser. Always respond with valid JSON only. No explanation, no markdown, no preamble.'
        },
        {
          role: 'user',
          content: `Extract every distinct clause, section, or meaningful 
statement from the following legal document text.

Return ONLY a valid JSON array.
Each element must have exactly two fields:
  "clause_number": sequential integer starting from 1
  "clause_text": the exact text of that clause

If numbered clauses exist preserve that structure.
If continuous prose split by logical legal statements.

Document text:
${rawText}`
        }
      ],
      0.1,
      4000
    );

    const raw = response.choices[0].message.content;
    
    // Safely parse JSON — strip markdown fences if present
    const cleaned = raw.replace(/```json|```/g, '').trim();
    
    try {
      const parsed = JSON.parse(cleaned);
      
      if (!Array.isArray(parsed)) {
        throw new Error('Expected array of clauses');
      }
      
      return parsed;
    } catch (err) {
      console.error('[extractClauses] Raw response:', raw.substring(0, 200));
      throw new Error('[extractClauses] Clause extraction failed: invalid JSON from Groq');
    }
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
    const lawsContext = retrievedLaws && retrievedLaws.length > 0
      ? retrievedLaws.join('\n\n')
      : 'No specific laws retrieved. Use your general knowledge of Indian law.';

    const response = await callGroqWithFallback(
      [
        {
          role: 'system',
          content: 'You are an expert Indian legal assistant. Always respond with valid JSON only. No explanation, no markdown, no preamble.'
        },
        {
          role: 'user',
          content: `Analyze the following clause from a legal document.

Clause: ${clauseText}

Relevant laws from knowledge base:
${lawsContext}

Respond ONLY with a valid JSON object with exactly these fields:
{
  "is_risky": true or false,
  "risk_level": "low" or "medium" or "high" or "critical" or null,
  "issue": "one sentence describing the problem" or null,
  "relevant_law": "specific article or section that applies" or null,
  "recommendation": "what the user should do about this" or null
}`
        }
      ],
      0.1,
      500
    );

    const raw = response.choices[0].message.content;
    const cleaned = raw.replace(/```json|```/g, '').trim();

    try {
      const analysis = JSON.parse(cleaned);
      
      // Ensure null fields are properly set for non-risky clauses
      if (!analysis.is_risky) {
        analysis.risk_level = null;
        analysis.issue = null;
        analysis.relevant_law = null;
        analysis.recommendation = null;
      }
      
      return analysis;
    } catch (err) {
      console.error('[analyzeClause] Raw response:', raw.substring(0, 200));
      // Return safe default instead of crashing entire pipeline
      return {
        is_risky: false,
        risk_level: null,
        issue: null,
        relevant_law: null,
        recommendation: null
      };
    }
  } catch (err) {
    // Return safe default instead of crashing entire pipeline
    console.error('[analyzeClause] Error:', err.message);
    return {
      is_risky: false,
      risk_level: null,
      issue: null,
      relevant_law: null,
      recommendation: null
    };
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
const generateSummary = async (allClauseAnalyses, documentName) => {
  try {
    const riskyCount = allClauseAnalyses.filter(c => c.is_risky).length;
    const totalCount = allClauseAnalyses.length;

    const riskyDetails = allClauseAnalyses
      .filter(c => c.is_risky)
      .map(c => `Clause ${c.clause_number}: ${c.issue}`)
      .join('\n');

    const response = await callGroqWithFallback(
      [
        {
          role: 'system',
          content: 'You are an expert Indian legal assistant who explains legal documents in simple language.'
        },
        {
          role: 'user',
          content: `Generate a plain language summary of this legal document analysis.

Document name: ${documentName}
Total clauses analyzed: ${totalCount}
Risky clauses found: ${riskyCount}

Risky clause details:
${riskyDetails || 'No risky clauses found.'}

Write a 3-4 sentence summary in simple English that a non-lawyer 
can understand. Mention the overall risk level and the most 
important issues found.`
        }
      ],
      0.3,
      300
    );

    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error('[generateSummary] Error:', err.message);
    throw new Error(`[generateSummary] Summary generation failed: ${err.message}`);
  }
};

// ---------------------------------------------------------------------------
// Generate chat response for conversational Q&A
// ---------------------------------------------------------------------------

/**
 * Generates a response to a user question using retrieved legal context.
 *
 * @param {string} userMessage - The user's question
 * @param {string[]} retrievedLaws - Array of relevant law texts
 * @param {Array} chatHistory - Recent chat history for context
 * @returns {Promise<string>} The AI response
 * @throws {Error} On API error
 */
const generateChatResponse = async (userMessage, retrievedLaws, chatHistory = []) => {
  try {
    const lawsContext = retrievedLaws && retrievedLaws.length > 0
      ? retrievedLaws.join('\n\n---\n\n')
      : 'No specific laws retrieved. Use your general knowledge of Indian law.';

    // Build conversation history for Groq
    const messages = [
      {
        role: 'system',
        content: `You are Nyaya-Mitra, an expert Indian legal assistant.
Answer questions based on the provided legal context.
If the context does not cover the question, use your general 
knowledge of Indian law but clearly state that.
Always respond in simple, clear English that a non-lawyer 
can understand.
Relevant laws from knowledge base:
${lawsContext}`
      }
    ];

    // Add last few chat history messages for context
    if (chatHistory && chatHistory.length > 0) {
      const recentHistory = chatHistory.slice(-3); // Last 3 messages
      recentHistory.forEach(h => {
        messages.push({ role: 'user', content: h.query_text });
        messages.push({ role: 'assistant', content: h.ai_response });
      });
    }

    // Add current user message
    messages.push({
      role: 'user',
      content: userMessage
    });

    const response = await callGroqWithFallback(messages, 0.3, 1000);

    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error('[generateChatResponse] Error:', err.message);
    throw new Error(`[generateChatResponse] Chat response generation failed: ${err.message}`);
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
  generateChatResponse,
};

'use strict';

/**
 * @file routes/chatRoutes.js
 * @description API routes for conversational legal Q&A with RAG.
 *
 * POST /api/chat
 *   - Send a question, get AI response with relevant legal context
 *
 * GET /api/chat/history/:userId
 *   - Retrieve conversation history for a user
 */

const express = require('express');
const { semanticSearch } = require('../db/models/vectorModel');
const { saveChatMessage, getChatHistory } = require('../db/models/chatModel');
const geminiService = require('../services/geminiService');

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = express.Router();

// ---------------------------------------------------------------------------
// POST /api/chat
// ---------------------------------------------------------------------------

/**
 * Send a question and receive an AI response grounded in legal knowledge.
 *
 * RAG Pipeline:
 *   1. Embed user's message using Gemini embeddings
 *   2. Search legal_knowledge_base for top-5 relevant chunks
 *   3. Inject retrieved laws into prompt
 *   4. Call Gemini LLM for response
 *   5. Save Q&A to chat_history
 *
 * Request Body:
 *   {
 *     "user_id": "uuid-of-user",
 *     "message": "What is Section 420 IPC?"
 *   }
 *
 * Response (200 - OK):
 *   {
 *     "response": "Section 420 of the Indian Penal Code...",
 *     "message_id": "uuid-from-db",
 *     "relevant_laws": [
 *       "Section 420 states...",
 *       "Related case law: ..."
 *     ]
 *   }
 *
 * Response (400 - Bad Request):
 *   { "error": "user_id and message are required" }
 *
 * Response (500 - Server Error):
 *   { "error": "Chat processing error: ..." }
 */
router.post('/', async (req, res) => {
  try {
    const { user_id, message } = req.body;

    // Validate request
    if (!user_id || !message) {
      return res.status(400).json({
        error: 'user_id and message are required',
      });
    }

    console.log(`[chatRoutes] User ${user_id}: ${message.substring(0, 50)}...`);

    // ===== STEP 1: Embed the message =====
    const embedding = await geminiService.embedText(message);

    // ===== STEP 2: Search for relevant laws =====
    const searchResults = await semanticSearch(embedding, 5);
    const retrievedLaws = searchResults.map(r => r.content_text);

    // ===== STEP 3: Build prompt with context =====
    const lawsContext = retrievedLaws.length > 0
      ? retrievedLaws.join('\n\n---\n\n')
      : '(No relevant laws found in knowledge base)';

    const systemPrompt = `You are Nyaya-Mitra, an expert Indian legal assistant. 
You help users understand Indian laws and their rights.
Respond based on the retrieved legal knowledge below, cite specific sections and articles.
Be concise but comprehensive.
If you don't know, say so clearly.`;

    const userPrompt = `Using the following Indian laws as reference:

RETRIEVED LEGAL KNOWLEDGE:
${lawsContext}

USER QUESTION:
${message}

Provide a response citing relevant articles and sections.`;

    // ===== STEP 4: Get Gemini response =====
    const genAI = require('@google/generative-ai').GoogleGenerativeAI;
    const client = new genAI(process.env.GEMINI_API_KEY);
    const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const response = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: systemPrompt + '\n\n' + userPrompt }],
        },
      ],
    });

    const aiResponse = response.response.text();

    // ===== STEP 5: Save to chat history =====
    const savedMessage = await saveChatMessage(user_id, message, aiResponse);

    // ===== Return response =====
    return res.status(200).json({
      response: aiResponse,
      message_id: savedMessage.message_id,
      timestamp: savedMessage.timestamp,
      relevant_laws: retrievedLaws,
    });
  } catch (err) {
    console.error('[chatRoutes] Chat error:', err.message);
    return res.status(500).json({
      error: `Chat processing error: ${err.message}`,
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/chat/history/:userId
// ---------------------------------------------------------------------------

/**
 * Retrieve recent chat history for a user.
 *
 * Query Parameters:
 *   - limit: number of messages to retrieve (default: 10)
 *
 * Response (200 - OK):
 *   [
 *     {
 *       "message_id": "uuid",
 *       "user_id": "uuid",
 *       "query_text": "What is Section 420?",
 *       "ai_response": "Section 420 IPC deals with...",
 *       "timestamp": "2026-04-12T10:30:45Z"
 *     },
 *     ...
 *   ]
 *
 * Response (400 - Bad Request):
 *   { "error": "Invalid user_id format" }
 *
 * Response (500 - Server Error):
 *   { "error": "Failed to retrieve history: ..." }
 */
router.get('/history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = Math.min(parseInt(req.query.limit || '10', 10), 100); // Max 100

    if (!userId) {
      return res.status(400).json({
        error: 'userId is required',
      });
    }

    console.log(`[chatRoutes] Fetching history for ${userId} (limit: ${limit})`);

    // Get chat history
    const history = await getChatHistory(userId, limit);

    return res.status(200).json(history);
  } catch (err) {
    console.error('[chatRoutes] History fetch error:', err.message);
    return res.status(500).json({
      error: `Failed to retrieve history: ${err.message}`,
    });
  }
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = router;

'use strict';

/**
 * @file routes/documentRoutes.js
 * @description API routes for document upload and analysis.
 *
 * POST /api/documents/upload
 *   - Upload a legal document (PDF or DOCX)
 *   - Extract text, parse clauses, analyze risks
 *   - Return comprehensive analysis results
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { analyzeDocument } = require('../services/documentService');
const { cache } = require('../services/documentCacheService');
const { pool } = require('../db/connection');

// ---------------------------------------------------------------------------
// Multer Configuration
// ---------------------------------------------------------------------------

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Use timestamp to avoid collisions
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedMimes = [
    'application/pdf',
    'application/x-pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/docx',
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type not allowed: ${file.mimetype}. Only PDF and DOCX are supported.`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = express.Router();

// ---------------------------------------------------------------------------
// POST /api/documents/upload
// ---------------------------------------------------------------------------

/**
 * Upload and analyze a legal document.
 *
 * Request:
 *   - Content-Type: multipart/form-data
 *   - Form fields:
 *     * file: the PDF or DOCX file
 *     * user_id: UUID of the user uploading the document
 *
 * Response (202 - OK):
 *   {
 *     doc_id: "uuid",
 *     document_name: "filename.pdf",
 *     overall_risk_level: "high",
 *     total_clauses: 42,
 *     risky_clauses: 5,
 *     summary: "This document contains several high-risk clauses...",
 *     analysis: [...]
 *   }
 *
 * Response (400 - Bad Request):
 *   { error: "user_id is required" }
 *
 * Response (422 - Unprocessable):
 *   { error: "Could not extract text. File may be a scanned document." }
 *
 * Response (500 - Server Error):
 *   { error: "Processing error: ..." }
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    // ===== Validate Request =====
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { user_id } = req.body;
    if (!user_id) {
      // Clean up uploaded file
      if (req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ error: 'user_id is required' });
    }

    // ===== Analyze Document =====
    console.log(`[documentRoutes] Uploading: ${req.file.originalname} for user ${user_id}`);

    const result = await analyzeDocument(
      req.file.path,
      req.file.mimetype,
      req.file.originalname,
      user_id
    );

    // ===== Return Results =====
    return res.status(202).json(result);
  } catch (err) {
    // Clean up uploaded file on error
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupErr) {
        console.warn(`Failed to cleanup file: ${cleanupErr.message}`);
      }
    }

    console.error('[documentRoutes] Error:', err.message);

    // Determine appropriate status code
    if (
      err.message.includes('Could not extract text') ||
      err.message.includes('scanned document')
    ) {
      return res.status(422).json({ error: err.message });
    }

    if (err.message.includes('No clauses found')) {
      return res.status(422).json({ error: err.message });
    }

    return res.status(500).json({ error: `Processing error: ${err.message}` });
  }
});

// ---------------------------------------------------------------------------
// GET /api/documents/cache/stats
// ---------------------------------------------------------------------------

/**
 * Get document cache statistics.
 *
 * Response (200 - OK):
 *   {
 *     size: 42,
 *     maxSize: 1000,
 *     ttlSeconds: 3600
 *   }
 */
router.get('/cache/stats', (req, res) => {
  const stats = cache.getStats();
  return res.status(200).json(stats);
});

// ---------------------------------------------------------------------------
// POST /api/documents/cache/clear
// ---------------------------------------------------------------------------

/**
 * Clear the entire document cache.
 *
 * Response (200 - OK):
 *   { message: "Cache cleared" }
 */
router.post('/cache/clear', (req, res) => {
  cache.clear();
  return res.status(200).json({ message: 'Document cache cleared' });
});

// ---------------------------------------------------------------------------
// GET /api/documents/:docId
// ---------------------------------------------------------------------------

/**
 * Retrieve a previously analyzed document with all its clause details.
 *
 * Response (200 - OK):
 *   {
 *     doc_id: "uuid",
 *     document_name: "filename.pdf",
 *     overall_risk_level: "high",
 *     total_clauses: 42,
 *     risky_clauses: 5,
 *     summary: "This document contains...",
 *     uploaded_at: "ISO timestamp",
 *     clauses: [
 *       {
 *         clause_id: "uuid",
 *         clause_number: 1,
 *         clause_text: "...",
 *         is_risky: true,
 *         risk_level: "high",
 *         issue: "...",
 *         relevant_law: "...",
 *         recommendation: "..."
 *       },
 *       ...
 *     ]
 *   }
 *
 * Response (404 - Not Found):
 *   { error: "Document not found" }
 */
router.get('/:docId', async (req, res) => {
  try {
    const { docId } = req.params;

    // Check cache first
    const cached = cache.get(docId);
    if (cached) {
      console.log(`[documentRoutes] Cache hit for document ${docId}`);
      return res.status(200).json(cached);
    }

    // Fetch from database
    const docResult = await pool.query(
      `SELECT doc_id, user_id, document_name, risk_level, generated_summary, uploaded_at
       FROM user_documents
       WHERE doc_id = $1`,
      [docId]
    );

    if (docResult.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const document = docResult.rows[0];

    // Fetch all clauses for this document
    const clausesResult = await pool.query(
      `SELECT clause_id, clause_number, clause_text, is_risky, risk_level, issue, relevant_law, recommendation
       FROM document_clauses
       WHERE doc_id = $1
       ORDER BY clause_number ASC`,
      [docId]
    );

    const clauses = clausesResult.rows;

    // Count risky clauses
    const riskyClauseCount = clauses.filter(c => c.is_risky).length;

    const response = {
      doc_id: document.doc_id,
      document_name: document.document_name,
      overall_risk_level: document.risk_level,
      total_clauses: clauses.length,
      risky_clauses: riskyClauseCount,
      summary: document.generated_summary,
      uploaded_at: document.uploaded_at,
      clauses: clauses.map(c => ({
        clause_id: c.clause_id,
        clause_number: c.clause_number,
        clause_text: c.clause_text,
        is_risky: c.is_risky,
        risk_level: c.risk_level,
        issue: c.issue,
        relevant_law: c.relevant_law,
        recommendation: c.recommendation,
      })),
    };

    // Cache the result
    cache.set(docId, response);

    return res.status(200).json(response);
  } catch (err) {
    console.error('[documentRoutes] Error fetching document:', err.message);
    return res.status(500).json({ error: `Failed to retrieve document: ${err.message}` });
  }
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = router;

'use strict';

/**
 * @file services/extractionService.js
 * @description Text extraction service for uploaded legal documents.
 *
 * Supports:
 *   - PDF via pdf-parse
 *   - DOCX via mammoth
 *
 * Usage:
 *   const raw = await extractText('/path/to/file.pdf', 'application/pdf');
 */

const fs = require('fs');
const path = require('path');
const PDFParse = require('pdf-parse');
const mammoth = require('mammoth');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MIN_EXTRACTED_LENGTH = 100; // characters

// ---------------------------------------------------------------------------
// Extract text from PDF
// ---------------------------------------------------------------------------

const extractFromPDF = async (filePath) => {
  const buffer = fs.readFileSync(filePath);
  const pdfData = await PDFParse(buffer);
  return pdfData.text;
};

// ---------------------------------------------------------------------------
// Extract text from DOCX
// ---------------------------------------------------------------------------

const extractFromDOCX = async (filePath) => {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
};

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

/**
 * Extracts text from an uploaded file.
 *
 * @param {string} filePath - Full path to the uploaded file
 * @param {string} mimetype - MIME type of the file
 * @returns {Promise<string>} Extracted text
 * @throws {Error} If text extraction fails or result is too short
 *
 * @example
 * const text = await extractText('/uploads/contract.pdf', 'application/pdf');
 * console.log(text.length);  // Output: 5240
 */
const extractText = async (filePath, mimetype) => {
  try {
    let text;

    if (mimetype === 'application/pdf' || mimetype === 'application/x-pdf') {
      text = await extractFromPDF(filePath);
    } else if (
      mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimetype === 'application/docx'
    ) {
      text = await extractFromDOCX(filePath);
    } else {
      throw new Error(`Unsupported file type: ${mimetype}`);
    }

    if (!text || text.trim().length < MIN_EXTRACTED_LENGTH) {
      throw new Error(
        'Could not extract text. File may be a scanned document. ' +
        `Extracted length: ${text?.length || 0} characters. ` +
        `Minimum required: ${MIN_EXTRACTED_LENGTH} characters.`
      );
    }

    return text;
  } catch (err) {
    throw new Error(`Text extraction failed: ${err.message}`);
  } finally {
    // Always delete temp file, even on error
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (cleanupErr) {
      console.warn(`Failed to delete temp file ${filePath}: ${cleanupErr.message}`);
    }
  }
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  extractText,
};

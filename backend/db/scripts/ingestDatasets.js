'use strict';

/**
 * @file db/scripts/ingestDatasets.js
 * @description One-time ingestion script for Nyaya-Mitra legal knowledge base.
 *
 * Processes all four datasets and stores them in legal_knowledge_base table:
 *   1. ipc_sections.csv       — Indian Penal Code sections (filtered to relevant chapters)
 *   2. A187209.pdf            — Indian Contract Act 1872
 *   3. A1882-04.pdf           — Transfer of Property Act 1882
 *   4. CPA2019.pdf            — Consumer Protection Act 2019
 *
 * USAGE:
 *   node -r dotenv/config db/scripts/ingestDatasets.js
 *
 * IMPORTANT:
 *   - Run this ONCE on a fresh database.
 *   - Each run checks for duplicates using dataset_source to avoid re-inserting.
 *   - Embedding calls are batched (5 at a time) to avoid Gemini rate limits.
 */

require('dotenv').config();

const fs      = require('fs');
const path    = require('path');
const PDFParse = require('pdf-parse');
const { parse } = require('csv-parse/sync');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { pool } = require('../connection');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DATASETS_DIR = path.resolve(__dirname, '../../datasets');

const FILES = {
  ipc:        path.join(DATASETS_DIR, 'ipc_sections.csv'),
  contract:   path.join(DATASETS_DIR, 'A187209.pdf'),
  property:   path.join(DATASETS_DIR, 'A1882-04.pdf'),
  consumer:   path.join(DATASETS_DIR, 'CPA2019.pdf'),
};

// Gemini embedding model — confirmed 3072 dimensions, matches halfvec(3072) schema
const EMBEDDING_MODEL = 'gemini-embedding-001';

// Batch size for parallel embedding calls — keep at 5 to respect Gemini rate limits
const BATCH_SIZE = 5;

// Minimum text length for a chunk to be worth embedding
const MIN_CHUNK_LENGTH = 50;

// IPC sections relevant to contract/document analysis (Chapters XVII and XVIII)
// Theft, extortion, cheating, criminal breach of trust, forgery, fraud
const IPC_RELEVANT_RANGE = { min: 378, max: 489 };

// ---------------------------------------------------------------------------
// Gemini Client
// ---------------------------------------------------------------------------

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });

// ---------------------------------------------------------------------------
// Utility: Sleep to respect rate limits between batches
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Utility: Embed a single text chunk with retry on rate limit error
// ---------------------------------------------------------------------------

const embedText = async (text, retries = 3) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await embeddingModel.embedContent(text);
      return result.embedding.values;
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`    ⚠ Embed attempt ${attempt} failed: ${err.message}. Retrying in 5s...`);
      await sleep(5000);
    }
  }
};

// ---------------------------------------------------------------------------
// Utility: Insert a single chunk into legal_knowledge_base
// ---------------------------------------------------------------------------

const insertChunk = async (client, datasetSource, documentType, contentText, vectorArray) => {
  await client.query(
    `INSERT INTO legal_knowledge_base
       (dataset_source, document_type, content_text, embedding)
     VALUES ($1, $2, $3, $4::halfvec)
     ON CONFLICT DO NOTHING`,
    [
      datasetSource,
      documentType,
      contentText,
      JSON.stringify(vectorArray),
    ]
  );
};

// ---------------------------------------------------------------------------
// Utility: Process chunks in batches — embed + insert in parallel groups
// ---------------------------------------------------------------------------

const processBatches = async (client, chunks, datasetSource, documentType) => {
  let inserted = 0;
  let skipped  = 0;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);

    // Embed all chunks in this batch in parallel
    const embedResults = await Promise.allSettled(
      batch.map(text => embedText(text))
    );

    // Insert successfully embedded chunks
    for (let j = 0; j < batch.length; j++) {
      const result = embedResults[j];
      if (result.status === 'fulfilled') {
        await insertChunk(client, datasetSource, documentType, batch[j], result.value);
        inserted++;
      } else {
        console.warn(`    ⚠ Skipped chunk: ${result.reason?.message}`);
        skipped++;
      }
    }

    const progress = Math.min(i + BATCH_SIZE, chunks.length);
    console.log(`    → Processed ${progress}/${chunks.length} chunks...`);

    // Pause between batches to respect Gemini rate limits (60 requests/minute)
    if (i + BATCH_SIZE < chunks.length) {
      await sleep(1200);
    }
  }

  return { inserted, skipped };
};

// ---------------------------------------------------------------------------
// DATASET 1: IPC CSV
// ---------------------------------------------------------------------------

const ingestIPC = async (client) => {
  console.log('\n📖 Processing IPC sections CSV...');

  const raw = fs.readFileSync(FILES.ipc, 'utf8');

  // Parse CSV — detect header names automatically
  const records = parse(raw, {
    columns: true,           // use first row as column names
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  console.log(`   Total rows in CSV: ${records.length}`);

  const chunks = [];

  for (const row of records) {
    // Get values regardless of exact column name casing
    const keys        = Object.keys(row);
    const descKey     = keys.find(k => k.toLowerCase().includes('description')) || keys[0];
    const offenseKey  = keys.find(k => k.toLowerCase().includes('offense'))    || keys[1];
    const punishKey   = keys.find(k => k.toLowerCase().includes('punish'))     || keys[2];
    const sectionKey  = keys.find(k => k.toLowerCase().includes('section'))    || keys[3];

    const sectionRaw  = (row[sectionKey] || '').trim();
    const description = (row[descKey]    || '').trim();
    const offense     = (row[offenseKey] || '').trim();
    const punishment  = (row[punishKey]  || '').trim();

    // Skip rows with missing critical data
    if (!sectionRaw || !description || description === 'nan') continue;

    // Extract section number from "IPC_140" → 140
    const match = sectionRaw.match(/(\d+)/);
    if (!match) continue;
    const sectionNum = parseInt(match[1], 10);

    // Filter to only relevant chapters (cheating, fraud, forgery)
    if (sectionNum < IPC_RELEVANT_RANGE.min || sectionNum > IPC_RELEVANT_RANGE.max) continue;

    // Build a rich chunk combining all fields for better semantic search
    const chunkText = [
      `Section: ${sectionRaw}`,
      offense     ? `Offense: ${offense}`         : '',
      description ? `Description: ${description}` : '',
      punishment  ? `Punishment: ${punishment}`   : '',
    ].filter(Boolean).join('\n');

    if (chunkText.length >= MIN_CHUNK_LENGTH) {
      chunks.push(chunkText);
    }
  }

  console.log(`   Relevant sections (${IPC_RELEVANT_RANGE.min}–${IPC_RELEVANT_RANGE.max}): ${chunks.length}`);

  const { inserted, skipped } = await processBatches(client, chunks, 'IPC_1860', 'statute');
  console.log(`   ✅ IPC done — inserted: ${inserted}, skipped: ${skipped}`);
  return inserted;
};

// ---------------------------------------------------------------------------
// Utility: Extract text from PDF using pdf-parse 1.1.1
// ---------------------------------------------------------------------------

const extractPdfText = async (filePath) => {
  const buffer = fs.readFileSync(filePath);
  const pdfData = await PDFParse(buffer);
  return pdfData.text;
};

// ---------------------------------------------------------------------------
// PDF Section Splitter
// Splits extracted PDF text into individual sections using number+dot pattern
// Handles: "10. Title" / "10.Title" / "10. (1) Content" / "Section 10."
// ---------------------------------------------------------------------------

const splitIntoSections = (text) => {
  // Normalize whitespace — PDFs often have irregular spacing
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')       // collapse multiple spaces
    .replace(/\n{3,}/g, '\n\n');   // collapse multiple blank lines

  // Split on pattern: newline followed by a number and a dot
  // Covers: "10." "10.—" "10. " at start of a line
  // We use a lookahead so the number itself is kept with its section
  const sections = normalized
    .split(/\n(?=\d{1,3}[\.\-—]\s)/)
    .map(s => s.trim())
    .filter(s => s.length >= MIN_CHUNK_LENGTH);

  return sections;
};

// ---------------------------------------------------------------------------
// DATASET 2: Indian Contract Act PDF
// ---------------------------------------------------------------------------

const ingestContractAct = async (client) => {
  console.log('\n📖 Processing Indian Contract Act 1872 PDF...');

  const text = await extractPdfText(FILES.contract);
  console.log(`   Extracted ${text.length} characters from PDF`);

  const sections = splitIntoSections(text);
  console.log(`   Sections found: ${sections.length}`);

  const { inserted, skipped } = await processBatches(
    client, sections, 'Indian_Contract_Act_1872', 'statute'
  );
  console.log(`   ✅ Contract Act done — inserted: ${inserted}, skipped: ${skipped}`);
  return inserted;
};

// ---------------------------------------------------------------------------
// DATASET 3: Transfer of Property Act PDF
// ---------------------------------------------------------------------------

const ingestPropertyAct = async (client) => {
  console.log('\n📖 Processing Transfer of Property Act 1882 PDF...');

  const text = await extractPdfText(FILES.property);
  console.log(`   Extracted ${text.length} characters from PDF`);

  const sections = splitIntoSections(text);
  console.log(`   Sections found: ${sections.length}`);

  const { inserted, skipped } = await processBatches(
    client, sections, 'Transfer_of_Property_Act_1882', 'statute'
  );
  console.log(`   ✅ Property Act done — inserted: ${inserted}, skipped: ${skipped}`);
  return inserted;
};

// ---------------------------------------------------------------------------
// DATASET 4: Consumer Protection Act PDF
// ---------------------------------------------------------------------------

const ingestConsumerAct = async (client) => {
  console.log('\n📖 Processing Consumer Protection Act 2019 PDF...');

  const text = await extractPdfText(FILES.consumer);
  console.log(`   Extracted ${text.length} characters from PDF`);

  const sections = splitIntoSections(text);
  console.log(`   Sections found: ${sections.length}`);

  const { inserted, skipped } = await processBatches(
    client, sections, 'Consumer_Protection_Act_2019', 'statute'
  );
  console.log(`   ✅ Consumer Act done — inserted: ${inserted}, skipped: ${skipped}`);
  return inserted;
};

// ---------------------------------------------------------------------------
// Utility: Check if a dataset was already ingested
// ---------------------------------------------------------------------------

const isAlreadyIngested = async (client, datasetSource) => {
  const { rows } = await client.query(
    'SELECT COUNT(*) as count FROM legal_knowledge_base WHERE dataset_source = $1',
    [datasetSource]
  );
  return parseInt(rows[0].count, 10) > 0;
};

// ---------------------------------------------------------------------------
// MAIN: Run all ingestion steps
// ---------------------------------------------------------------------------

const main = async () => {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║   Nyaya-Mitra — Legal Knowledge Base Ingestion  ║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log(`\nEmbedding model : ${EMBEDDING_MODEL}`);
  console.log(`Batch size      : ${BATCH_SIZE}`);
  console.log(`Datasets dir    : ${DATASETS_DIR}\n`);

  // Verify all dataset files exist before starting
  console.log('Checking dataset files...');
  for (const [name, filePath] of Object.entries(FILES)) {
    if (!fs.existsSync(filePath)) {
      console.error(`❌ Missing file: ${filePath}`);
      console.error(`   Please place the file in the datasets/ folder and retry.`);
      process.exit(1);
    }
    const size = (fs.statSync(filePath).size / 1024).toFixed(1);
    console.log(`   ✅ ${name}: ${path.basename(filePath)} (${size} KB)`);
  }

  const client = await pool.connect();
  let totalInserted = 0;

  try {
    await client.query('BEGIN');

    // --- IPC ---
    if (await isAlreadyIngested(client, 'IPC_1860')) {
      console.log('\n⏭  IPC_1860 already ingested — skipping.');
    } else {
      totalInserted += await ingestIPC(client);
    }

    // --- Indian Contract Act ---
    if (await isAlreadyIngested(client, 'Indian_Contract_Act_1872')) {
      console.log('\n⏭  Indian Contract Act already ingested — skipping.');
    } else {
      totalInserted += await ingestContractAct(client);
    }

    // --- Transfer of Property Act ---
    if (await isAlreadyIngested(client, 'Transfer_of_Property_Act_1882')) {
      console.log('\n⏭  Transfer of Property Act already ingested — skipping.');
    } else {
      totalInserted += await ingestPropertyAct(client);
    }

    // --- Consumer Protection Act ---
    if (await isAlreadyIngested(client, 'Consumer_Protection_Act_2019')) {
      console.log('\n⏭  Consumer Protection Act already ingested — skipping.');
    } else {
      totalInserted += await ingestConsumerAct(client);
    }

    await client.query('COMMIT');

    console.log('\n╔════════════════════════════════════════════╗');
    console.log(`║  ✅ Ingestion complete!                      ║`);
    console.log(`║  Total chunks inserted: ${String(totalInserted).padEnd(20)}║`);
    console.log('╚════════════════════════════════════════════╝');

    // Final count in database
    const { rows } = await client.query(
      `SELECT dataset_source, COUNT(*) as chunks
       FROM legal_knowledge_base
       GROUP BY dataset_source
       ORDER BY dataset_source`
    );
    console.log('\nDatabase summary:');
    rows.forEach(r => console.log(`   ${r.dataset_source}: ${r.chunks} chunks`));

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Ingestion failed — transaction rolled back.');
    console.error(err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
};

main();
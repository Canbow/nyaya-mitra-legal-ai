require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { semanticSearch } = require('./db/models/vectorModel');

const app = express();
app.use(cors());
app.use(express.json());

const authRoutes = require('./routes/authRoutes');
app.use('/api/auth', authRoutes);

// Import route modules
const documentRoutes = require('./routes/documentRoutes');
const chatRoutes = require('./routes/chatRoutes');

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- HEALTH CHECK ENDPOINT ---
app.get('/', (req, res) => {
    res.send("<h2>🟢 Nyaya-Mitra Legal Server is Live and Running!</h2>");
});

// --- THE CHAT API ENDPOINT WITH RAG PIPELINE (Inline / Flutter fallback) ---
/**
 * RAG Pipeline Flow:
 *   1. User sends question
 *   2. Embed question using Gemini embeddings API
 *   3. Search database for relevant legal knowledge using semantic similarity
 *   4. Inject retrieved context into prompt
 *   5. Send augmented prompt to Gemini LLM
 *   6. Return grounded response to user
 */
app.post('/api/chat', async (req, res, next) => {
    // If request contains 'question' (as expected by Flutter/inline schema), handle here
    if (req.body && req.body.question) {
        try {
            const userQuestion = req.body.question;
            console.log(`Flutter asked: "${userQuestion}"`);

            // ===== STEP 1: Embed the user's question =====
            const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
            console.log("[RAG] Generating embedding for question...");
            
            const embeddingResult = await model.embedContent(userQuestion);
            const queryVector = embeddingResult.embedding.values;
            
            if (!queryVector || queryVector.length !== 3072) {
                throw new Error(`Invalid embedding dimensions: ${queryVector?.length}`);
            }
            console.log(`[RAG] Embedding complete (3072 dimensions)`);

            // ===== STEP 2: Search database for relevant legal context =====
            console.log("[RAG] Searching legal knowledge base...");
            const searchResults = await semanticSearch(queryVector, 5);
            console.log(`[RAG] Found ${searchResults.length} relevant legal chunks`);

            // ===== STEP 3: Build the augmented prompt with retrieved context =====
            let lawsContext = '';
            let retrievedLaws = [];
            
            if (searchResults.length > 0) {
                retrievedLaws = searchResults.map((r, idx) => ({
                    rank: idx + 1,
                    source: r.dataset_source,
                    score: r.similarity_score,
                    content: r.content_text
                }));

                lawsContext = searchResults
                    .map((r, idx) => `[${idx + 1}] (Source: ${r.dataset_source}, Score: ${r.similarity_score.toFixed(4)})\n${r.content_text}`)
                    .join('\n\n---\n\n');
            } else {
                lawsContext = '(No relevant laws found in the knowledge base)';
            }

            console.log("[RAG] Building augmented prompt with legal context...");

            // ===== STEP 4: Create the augmented prompt =====
            const systemPrompt = `You are Nyaya-Mitra, an expert Indian Legal Assistant powered by RAG (Retrieval-Augmented Generation). 
Your task is to answer legal questions based STRICTLY on the retrieved Indian legal knowledge provided below.
Rules:
- Always cite specific sections, articles, and sources
- If the retrieved context covers the question, use it as the foundation of your answer
- If the retrieved context does NOT cover the question, state this clearly and explain what information would be needed
- Keep explanations simple and accessible (8th-grade level English)
- Be conservative: when in doubt, recommend consulting a qualified lawyer
- Format your response with clear sections and bullet points for readability`;

            const userPrompt = `RETRIEVED LEGAL CONTEXT (from Indian Laws Database):
${lawsContext}

USER QUESTION:
${userQuestion}

INSTRUCTIONS:
1. Analyze the question in light of the retrieved legal context above
2. Provide a comprehensive answer that cites the relevant sections
3. If the context is insufficient, explain what additional information would help
4. Conclude with practical guidance or next steps if applicable`;

            // ===== STEP 5: Get the answer from Gemini with augmented context =====
            console.log("[RAG] Calling Gemini LLM with augmented prompt...");
            const generationModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            
            const result = await generationModel.generateContent({
                contents: [
                    {
                        role: 'user',
                        parts: [{ text: userPrompt }]
                    }
                ],
                systemInstruction: systemPrompt
            });

            const aiAnswer = result.response.text();
            console.log("[RAG] Answer generated successfully!");

            // ===== STEP 6: Send response back to Flutter =====
            res.json({ 
                answer: aiAnswer,
                retrievedLaws: retrievedLaws,
                contextUsed: searchResults.length > 0
            });
            console.log("Response sent back to Flutter with RAG context!");

        } catch (error) {
            console.error("[RAG] API Error:", error.message);
            console.error(error.stack);
            res.status(500).json({ 
                error: "Something went wrong on the server.",
                details: error.message 
            });
        }
    } else {
        // Fallback to standard chatRoutes (which expects user_id and message)
        next();
    }
});

// --- REGISTER ROUTES ---
app.use('/api/documents', documentRoutes);
app.use('/api/chat', chatRoutes);

// --- DOCUMENT UPLOAD ENDPOINT WITH RAG ANALYSIS ---
/**
 * RAG-Enhanced Document Analysis:
 *   1. Extract text from uploaded document (PDF/Image/Text)
 *   2. Embed the document to retrieve relevant legal context
 *   3. Analyze the document against retrieved legal requirements
 *   4. Flag clauses that violate the law with evidence
 */
app.post('/api/upload', async (req, res) => {
    try {
        const { fileName, fileType, contentBase64 } = req.body;
        console.log(`[UPLOAD] Processing file: ${fileName} (${fileType})`);

        // ===== STEP 1: Decode and extract text from document =====
        const buffer = Buffer.from(contentBase64, 'base64');
        let extractedText = '';

        if (fileType.toLowerCase().includes('pdf')) {
            // Parse PDF
            const pdfParse = require('pdf-parse');
            const data = await pdfParse(buffer);
            extractedText = data.text;
        } else if (['jpg', 'jpeg', 'png'].includes(fileType.toLowerCase())) {
            // For images, use Tesseract.js (simplified - in production, use a proper OCR service)
            // Note: Tesseract.js is client-side, for server-side, consider using tesseract-ocr
            extractedText = 'Image OCR not fully implemented in this demo. Using sample text.';
        } else {
            extractedText = buffer.toString('utf-8'); // For text files
        }

        console.log(`[UPLOAD] Extracted ${extractedText.length} characters from document`);

        // ===== STEP 2: Embed the document to find relevant laws =====
        console.log("[UPLOAD] Embedding document for RAG context...");
        const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
        const embeddingResult = await embeddingModel.embedContent(extractedText.substring(0, 5000));
        const docVector = embeddingResult.embedding.values;

        // ===== STEP 3: Search for relevant legal context =====
        console.log("[UPLOAD] Searching database for relevant legal requirements...");
        const searchResults = await semanticSearch(docVector, 10); // Get top 10 relevant laws
        console.log(`[UPLOAD] Found ${searchResults.length} relevant legal references`);

        // Build legal context string
        let legalContext = '';
        if (searchResults.length > 0) {
            legalContext = searchResults
                .map((r, idx) => `[${idx + 1}] ${r.dataset_source}: ${r.content_text}`)
                .join('\n\n');
        } else {
            legalContext = '(No specific legal requirements found in knowledge base)';
        }

        // ===== STEP 4: Analyze document with legal context =====
        console.log("[UPLOAD] Analyzing document against legal requirements...");
        const analysisModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        
        const systemPrompt = `You are Nyaya-Mitra, a legal document analyzer. Your task is to:
1. Identify all key clauses in the contract
2. Compare each clause against the relevant Indian laws provided
3. Flag any clauses that violate or conflict with legal requirements
4. Provide risk assessment based on legal violations
5. Explain issues in simple, accessible language`;

        const analysisPrompt = `RELEVANT LEGAL REQUIREMENTS (from Indian Laws Database):
${legalContext}

CONTRACT TEXT TO ANALYZE:
${extractedText.substring(0, 10000)}

Please analyze this contract and return a JSON object with:
{
  "riskScore": number 0-100 (higher = more violations),
  "summary": "Overall assessment of the contract",
  "clauses": [
    {
      "title": "Clause title",
      "legalText": "The clause from the contract",
      "simpleText": "Simple explanation",
      "riskLevel": "high/medium/low",
      "violation": "What law it violates (if any)",
      "recommendation": "What should be changed"
    }
  ],
  "redFlags": [
    {
      "title": "Red flag title",
      "description": "Why this is problematic",
      "relevantLaw": "Which law it violates"
    }
  ]
}`;

        const result = await analysisModel.generateContent({
            contents: [
                {
                    role: 'user',
                    parts: [{ text: analysisPrompt }]
                }
            ],
            systemInstruction: systemPrompt
        });

        const analysisResponse = result.response.text();
        console.log("[UPLOAD] Analysis complete!");

        // ===== STEP 5: Parse and return analysis =====
        let analysisData;
        try {
            // Extract JSON from the response
            const jsonMatch = analysisResponse.match(/\{[\s\S]*\}/);
            analysisData = jsonMatch ? JSON.parse(jsonMatch[0]) : {
                riskScore: 50,
                summary: 'Document analyzed but structure could not be parsed',
                clauses: [{
                    title: 'Document Analysis',
                    legalText: extractedText.substring(0, 200),
                    simpleText: 'Document was processed successfully.',
                    riskLevel: 'medium',
                    violation: 'Unknown',
                    recommendation: 'Review with qualified legal counsel'
                }],
                redFlags: []
            };
        } catch (e) {
            console.error("[UPLOAD] JSON parsing error:", e.message);
            analysisData = {
                riskScore: 50,
                summary: 'Document uploaded and analyzed',
                clauses: [{
                    title: 'Document Analysis',
                    legalText: extractedText.substring(0, 200),
                    simpleText: 'Document was processed. Please review detailed analysis.',
                    riskLevel: 'medium',
                    violation: 'Analysis pending',
                    recommendation: 'Consult with legal counsel'
                }],
                redFlags: []
            };
        }

        res.json({
            answer: `File ${fileName} uploaded and analyzed successfully.`,
            documentName: fileName,
            ragContextUsed: searchResults.length > 0,
            relevantLawsCount: searchResults.length,
            ...analysisData
        });
        console.log("[UPLOAD] Response sent to frontend!");

    } catch (error) {
        console.error('[UPLOAD] Error:', error.message);
        console.error(error.stack);
        res.status(500).json({ 
            error: 'Upload processing failed.',
            details: error.message 
        });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Nyaya-Mitra Backend running on http://localhost:${PORT}`);
});

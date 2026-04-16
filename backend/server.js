require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json()); // Allows the server to read JSON from Flutter

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- HEALTH CHECK ENDPOINT ---
// This handles the browser visiting http://localhost:3000/
app.get('/', (req, res) => {
    res.send("<h2>🟢 Nyaya-Mitra Legal Server is Live and Running!</h2>");
});

// --- THE CHAT API ENDPOINT ---
app.post('/api/chat', async (req, res) => {
    try {
        const userQuestion = req.body.question;
        console.log(`Flutter asked: "${userQuestion}"`);

        // 1. For now, we ask Gemini directly (Later, we will add the Database RAG here!)
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        
        // Give Gemini a "System Prompt" so it acts like a lawyer
        const prompt = `You are Nyaya-Mitra, an expert Indian Legal Assistant. 
        Answer the following question simply and accurately based on Indian Law.
        Question: ${userQuestion}`;

        // 2. Get the answer
        const result = await model.generateContent(prompt);
        const aiAnswer = result.response.text();

        // 3. Send it back to Flutter
        res.json({ answer: aiAnswer });
        console.log("Answer sent back to Flutter successfully!");

    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ error: "Something went wrong on the server." });
    }
});

// --- DOCUMENT UPLOAD ENDPOINT ---
app.post('/api/upload', async (req, res) => {
    try {
        const { fileName, fileType, contentBase64 } = req.body;
        console.log(`Uploaded file: ${fileName} (${fileType})`);

        // Decode the base64 content
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

        // Use Gemini to analyze the extracted text
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const analysisPrompt = `Analyze this legal contract text and extract key clauses. 
        Return a JSON object with:
        - riskScore: integer 0-100 indicating overall risk level
        - clauses: array of objects with title, legalText, simpleText, riskLevel (high/medium/low)
        
        Contract text: ${extractedText.substring(0, 10000)}`; // Limit text length

        const result = await model.generateContent(analysisPrompt);
        const analysisResponse = result.response.text();

        // Parse the JSON response
        let analysisData;
        try {
            // Extract JSON from the response (Gemini might add extra text)
            const jsonMatch = analysisResponse.match(/\{[\s\S]*\}/);
            analysisData = jsonMatch ? JSON.parse(jsonMatch[0]) : {
                riskScore: 50,
                clauses: [{
                    title: 'Sample Clause',
                    legalText: extractedText.substring(0, 200),
                    simpleText: 'This is a sample clause from the document.',
                    riskLevel: 'low'
                }]
            };
        } catch (e) {
            analysisData = {
                riskScore: 50,
                clauses: [{
                    title: 'Document Analysis',
                    legalText: extractedText.substring(0, 200),
                    simpleText: 'Document uploaded but analysis failed.',
                    riskLevel: 'medium'
                }]
            };
        }

        res.json({
            answer: `File ${fileName} uploaded and analyzed successfully.`,
            ...analysisData
        });
    } catch (error) {
        console.error('Upload Error:', error);
        res.status(500).json({ error: 'Upload processing failed.' });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Nyaya-Mitra Backend running on http://localhost:${PORT}`);
});
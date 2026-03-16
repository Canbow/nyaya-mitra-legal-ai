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

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Nyaya-Mitra Backend running on http://localhost:${PORT}`);
});
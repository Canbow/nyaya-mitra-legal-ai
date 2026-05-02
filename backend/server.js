require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const authRoutes = require('./routes/authRoutes');
app.use('/api/auth', authRoutes);

// Import route modules
const documentRoutes = require('./routes/documentRoutes');
const chatRoutes = require('./routes/chatRoutes');

// --- HEALTH CHECK ENDPOINT ---
app.get('/', (req, res) => {
    res.send("<h2>🟢 Nyaya-Mitra Legal Server is Live and Running!</h2>");
});

// --- REGISTER ROUTES ---
app.use('/api/documents', documentRoutes);
app.use('/api/chat', chatRoutes);

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Nyaya-Mitra Backend running on http://localhost:${PORT}`);
});
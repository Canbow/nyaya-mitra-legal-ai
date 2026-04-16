// server.js
'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { testConnection } = require('./db');
const documentRoutes = require('./routes/documentRoutes');
const chatRoutes = require('./routes/chatRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse incoming JSON request bodies
app.use(express.json());

// Enable CORS for cross-origin requests from frontend
app.use(cors());

// Basic health check route — visit http://localhost:3000/ to confirm it's alive
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Nyaya-Mitra API is running',
    timestamp: new Date().toISOString(),
  });
});

// Mount API routes
app.use('/api/documents', documentRoutes);
app.use('/api/chat', chatRoutes);

// Start the server only after confirming DB is reachable
const startServer = async () => {
  try {
    await testConnection(); // Will throw and exit if DB is unreachable
    app.listen(PORT, () => {
      console.log(`✅ Nyaya-Mitra server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Failed to connect to database. Server not started.');
    console.error(err.message);
    process.exit(1); // Exit cleanly so you see the error, not a crash dump
  }
};

startServer();
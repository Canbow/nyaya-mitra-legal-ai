'use strict';

const express = require('express');
const router  = express.Router();
const { query } = require('../db/connection');
const crypto  = require('crypto');

const hashPassword = (password) =>
  crypto.createHash('sha256').update(password).digest('hex');

// POST /api/auth/guest
router.post('/guest', async (req, res) => {
  try {
    const guestName  = `Guest_${Date.now()}`;
    const guestEmail = `guest_${Date.now()}@nyayamitra.app`;

    const result = await query(
      `INSERT INTO users (name, email, preferred_language)
       VALUES ($1, $2, 'english')
       RETURNING user_id, name, email`,
      [guestName, guestEmail]
    );

    const user = result.rows[0];
    return res.status(201).json({
      user_id: user.user_id,
      name: user.name,
    });
  } catch (err) {
    console.error('[authRoutes] Guest error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  // ... rest of register route
});

// POST /api/auth/login  
router.post('/login', async (req, res) => {
  // ... rest of login route
});

module.exports = router;
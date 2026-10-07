const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const validator = require('validator');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/schema');
const config = require('../utils/config');
const { loginLimiter } = require('../middleware/rateLimiter');
const { authenticateUser } = require('../middleware/auth');

router.post('/register', loginLimiter, async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing required fields' });
  if (!validator.isEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const db = getDb();
  const normalizedEmail = email.trim().toLowerCase();
  const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existingUser) return res.status(400).json({ error: 'Email already registered. Please login.' });

  try {
    const password_hash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    const cleanName = validator.escape(name.trim());
    
    db.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)').run(id, cleanName, normalizedEmail, password_hash);
    
    const token = jwt.sign({ id, email: normalizedEmail, name: cleanName, role: 'user' }, config.JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { 
      httpOnly: true, 
      secure: process.env.NODE_ENV === 'production', 
      sameSite: 'lax', 
      maxAge: 7 * 24 * 3600000 
    });
    
    res.status(201).json({ success: true, user: { id, name: cleanName, email: normalizedEmail } });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Internal server error during registration' });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Please enter both email and password' });

  const db = getDb();
  const normalizedEmail = email.trim().toLowerCase();
  
  try {
    const user = db.prepare('SELECT id, name, email, password_hash FROM users WHERE email = ?').get(normalizedEmail);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ id: user.id, email: user.email, name: user.name, role: 'user' }, config.JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { 
      httpOnly: true, 
      secure: process.env.NODE_ENV === 'production', 
      sameSite: 'lax', 
      maxAge: 7 * 24 * 3600000 
    });
    
    res.json({ success: true, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

router.get('/me', authenticateUser, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, name, email, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

module.exports = router;

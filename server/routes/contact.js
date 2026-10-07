const express = require('express');
const router = express.Router();
const validator = require('validator');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/schema');
const { contactLimiter } = require('../middleware/rateLimiter');

router.post('/', contactLimiter, (req, res) => {
  const { name, email, message } = req.body;
  
  if (!name || !email || !message) return res.status(400).json({ error: 'All fields are required' });
  if (!validator.isEmail(email)) return res.status(400).json({ error: 'Invalid email address' });
  
  const db = getDb();
  try {
    db.prepare('INSERT INTO contact_messages (id, name, email, message) VALUES (?, ?, ?, ?)').run(
      uuidv4(), validator.escape(name), email, validator.escape(message)
    );
    res.json({ success: true, message: 'Your message has been sent successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit contact message' });
  }
});

module.exports = router;

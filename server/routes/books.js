const express = require('express');
const router = express.Router();
const { getDb } = require('../db/schema');
const { apiLimiter } = require('../middleware/rateLimiter');

// GET /api/books - list all published books
router.get('/', apiLimiter, (req, res) => {
  const { category, search } = req.query;
  const db = getDb();
  
  let query = 'SELECT id, title, slug, price, short_description, description, cover_image, category, rating FROM books WHERE is_published = 1';
  const params = [];

  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }
  
  if (search) {
    query += ' AND (title LIKE ? OR description LIKE ? OR category LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY created_at ASC';

  try {
    const books = db.prepare(query).all(...params);
    res.json(books);
  } catch (err) {
    console.error('Books fetch error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/books/:slug - get single book by slug or id
router.get('/:slug', apiLimiter, (req, res) => {
  const db = getDb();
  const param = req.params.slug;
  try {
    const book = db.prepare('SELECT * FROM books WHERE (slug = ? OR id = ?) AND is_published = 1').get(param, param);
    if (!book) return res.status(404).json({ error: 'Book not found' });
    
    if (book.what_you_learn) book.what_you_learn = JSON.parse(book.what_you_learn);
    if (book.topics) book.topics = JSON.parse(book.topics);
    delete book.google_drive_url;
    
    res.json(book);
  } catch (err) {
    console.error('Book fetch error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;

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

// Helper to securely link a verified order to a customer account
function linkVerifiedOrder(db, customerId, orderId, downloadToken) {
  if (!orderId || !downloadToken) return false;
  try {
    const order = db.prepare("SELECT * FROM orders WHERE id = ? AND status = 'paid'").get(orderId);
    if (order && order.download_token && order.download_token.trim() === downloadToken.trim()) {
      db.prepare('UPDATE orders SET customer_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(customerId, order.id);
      db.prepare('UPDATE download_access SET customer_id = ? WHERE order_id = ?').run(customerId, order.id);
      return true;
    }
  } catch (e) {
    console.error('Error linking verified order:', e);
  }
  return false;
}

// POST /api/auth/register - Optional customer registration
router.post('/register', loginLimiter, async (req, res) => {
  const { name, email, password, order_id, download_token } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing required fields' });
  if (!validator.isEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const db = getDb();
  const normalizedEmail = email.trim().toLowerCase();
  const cleanName = validator.escape(name.trim());

  try {
    const existingUser = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(normalizedEmail);
    
    // If account already exists with a password, ask user to log in
    if (existingUser && existingUser.password_hash) {
      return res.status(400).json({ error: 'An account with this email already exists. Please Sign In.' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    let userId = existingUser ? existingUser.id : uuidv4();

    if (existingUser) {
      // User was created during guest checkout; now registering with password
      db.prepare('UPDATE users SET name = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(cleanName, password_hash, userId);
    } else {
      db.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
        .run(userId, cleanName, normalizedEmail, password_hash);
    }

    // If order details provided, securely associate the order
    if (order_id && download_token) {
      linkVerifiedOrder(db, userId, order_id, download_token);
    }

    const token = jwt.sign({ id: userId, email: normalizedEmail, name: cleanName, role: 'user' }, config.JWT_SECRET, { expiresIn: '14d' });
    res.cookie('token', token, { 
      httpOnly: true, 
      secure: config.NODE_ENV === 'production', 
      sameSite: 'lax', 
      maxAge: 14 * 24 * 3600000 
    });
    
    res.status(201).json({ success: true, user: { id: userId, name: cleanName, email: normalizedEmail } });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Internal server error during registration' });
  }
});

// POST /api/auth/login - Optional customer sign in
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password, order_id, download_token } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Please enter both email and password' });

  const db = getDb();
  const normalizedEmail = email.trim().toLowerCase();
  
  try {
    const user = db.prepare('SELECT id, name, email, password_hash FROM users WHERE email = ?').get(normalizedEmail);
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // If order details provided, securely associate the order
    if (order_id && download_token) {
      linkVerifiedOrder(db, user.id, order_id, download_token);
    }

    const token = jwt.sign({ id: user.id, email: user.email, name: user.name, role: 'user' }, config.JWT_SECRET, { expiresIn: '14d' });
    res.cookie('token', token, { 
      httpOnly: true, 
      secure: config.NODE_ENV === 'production', 
      sameSite: 'lax', 
      maxAge: 14 * 24 * 3600000 
    });
    
    res.json({ success: true, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// POST /api/auth/logout - Sign out customer
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

// GET /api/auth/me - Current customer profile
router.get('/me', authenticateUser, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, name, email, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ success: true, user });
});

// POST /api/auth/link-order - Securely link verified order to logged-in customer account
router.post('/link-order', authenticateUser, (req, res) => {
  const { order_id, download_token } = req.body;
  if (!order_id || !download_token) {
    return res.status(400).json({ error: 'Missing order_id or download_token' });
  }

  const db = getDb();
  const linked = linkVerifiedOrder(db, req.user.id, order_id, download_token);
  if (!linked) {
    return res.status(400).json({ error: 'Could not verify or link this order' });
  }

  res.json({ success: true, message: 'Order successfully saved to your account library!' });
});

// GET /api/auth/my-books - Secure Customer Library / Purchases
router.get('/my-books', authenticateUser, (req, res) => {
  const db = getDb();
  const books = db.prepare(`
    SELECT DISTINCT 
      b.id, 
      b.title, 
      b.slug, 
      b.cover_image, 
      b.category, 
      b.short_description,
      b.google_drive_url, 
      d.granted_at,
      o.id as order_id,
      o.download_token
    FROM download_access d 
    JOIN books b ON d.book_id = b.id 
    JOIN orders o ON d.order_id = o.id
    WHERE d.customer_id = ? AND o.status = 'paid'
    ORDER BY d.granted_at DESC
  `).all(req.user.id);

  const formattedBooks = books.map(b => ({
    id: b.id,
    title: b.title,
    slug: b.slug,
    cover_image: b.cover_image,
    category: b.category,
    short_description: b.short_description,
    google_drive_url: b.google_drive_url || null,
    granted_at: b.granted_at,
    order_id: b.order_id,
    download_url: `/api/orders/${b.order_id}/download/${b.id}?token=${b.download_token}`
  }));

  res.json({
    success: true,
    books: formattedBooks
  });
});

module.exports = router;

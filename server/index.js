require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const applySecurity = require('./middleware/security');
const { getDb } = require('./db/schema');
const config = require('./utils/config');
const { apiLimiter } = require('./middleware/rateLimiter');

// Initialize database early
getDb();

// Ensure upload directory exists for cover uploads
const fs = require('fs');
const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'covers');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const app = express();

// Trust reverse proxy in production (e.g. Nginx, Cloudflare, Render, Railway, AWS)
if (config.TRUST_PROXY) {
  app.set('trust proxy', 1);
}

// Apply security headers and CORS
applySecurity(app);

// Health check endpoint for uptime monitoring & container health probes
app.get(['/health', '/api/health'], (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    environment: config.NODE_ENV
  });
});

// Webhook requires raw body for signature verification
app.use('/api/payment/webhook', express.raw({ type: 'application/json' }));

// Apply parsers to all other routes
app.use((req, res, next) => {
  if (req.originalUrl === '/api/payment/webhook') {
    return next();
  }
  express.json({ limit: '10mb' })(req, res, (err) => {
    if (err) return next(err);
    express.urlencoded({ extended: true })(req, res, next);
  });
});

app.use(cookieParser());

// Static file serving from public/ directory with cache control
app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    // Aggressive caching for images and static fonts in public/uploads/covers and assets
    if (filePath.match(/\.(webp|png|jpe?g|svg|ico|gif|woff2?|ttf|eot)$/i)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable'); // 30 days
    } else if (filePath.match(/\.(css|js)$/i)) {
      res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day
    }
  }
}));

// Mount API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/books', require('./routes/books'));
app.use('/api/payment', require('./routes/payment'));
app.use('/api/download', require('./routes/download'));
app.use('/api/library', require('./routes/download'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/contact', require('./routes/contact'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/admin', require('./routes/admin'));

// Public API routes for bundles, reviews, categories (mounted separately)
const { getDb: getBundleDb } = require('./db/schema');

app.get('/api/bundles', apiLimiter, (req, res) => {
  const db = getDb();
  try {
    const bundles = db.prepare('SELECT id, title, slug, description, price FROM bundles WHERE is_active = 1').all();
    res.json(bundles);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/bundles/:slug', apiLimiter, (req, res) => {
  const db = getDb();
  try {
    const bundle = db.prepare('SELECT * FROM bundles WHERE (slug = ? OR id = ?) AND is_active = 1').get(req.params.slug, req.params.slug);
    if (!bundle) return res.status(404).json({ error: 'Bundle not found' });
    
    const bookIds = JSON.parse(bundle.books || '[]');
    if (bookIds.length > 0) {
      const placeholders = bookIds.map(() => '?').join(',');
      bundle.bookDetails = db.prepare(`SELECT id, title, slug, price, short_description, cover_image, category FROM books WHERE id IN (${placeholders})`).all(...bookIds);
    } else {
      bundle.bookDetails = [];
    }
    
    res.json(bundle);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/categories', apiLimiter, (req, res) => {
  const db = getDb();
  try {
    const categories = db.prepare('SELECT category, COUNT(*) as count FROM books WHERE is_published = 1 GROUP BY category').all();
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/reviews', apiLimiter, (req, res) => {
  const db = getDb();
  try {
    const reviews = db.prepare('SELECT name, rating, review, created_at FROM reviews WHERE is_published = 1 ORDER BY created_at DESC').all();
    res.json(reviews);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// My books route (moved here for proper mounting)
app.get('/api/my-books', require('./middleware/auth').authenticateUser, (req, res) => {
  const db = getDb();
  const books = db.prepare(`
    SELECT DISTINCT b.id, b.title, b.slug, b.cover_image, b.category, d.granted_at 
    FROM download_access d 
    JOIN books b ON d.book_id = b.id 
    JOIN orders o ON d.order_id = o.id
    WHERE d.customer_id = ? AND o.status = 'paid'
    ORDER BY d.granted_at DESC
  `).all(req.user.id);
  res.json(books);
});

// Generic error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'An unexpected error occurred' });
});

// SPA catch-all for admin routes -> serve admin.html
app.get('/admin*', (req, res) => {
  const file = path.join(__dirname, '..', 'public', 'admin.html');
  res.sendFile(file, (err) => {
    if (err) res.status(404).send('Admin panel not found.');
  });
});

// SPA catch-all for all other routes -> serve index.html
app.get('*', (req, res) => {
  const file = path.join(__dirname, '..', 'public', 'index.html');
  res.sendFile(file, (err) => {
    if (err) res.status(404).send('Frontend not found.');
  });
});

// Export and Start Server
if (require.main === module) {
  app.listen(config.PORT, () => {
    console.log(`CodeLibrary server running at http://localhost:${config.PORT}`);
    console.log(`Admin panel: http://localhost:${config.PORT}/admin`);
  });
}

module.exports = app;

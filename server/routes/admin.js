const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const OTPAuth = require('otpauth');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/schema');
const config = require('../utils/config');
const { authenticateAdmin } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimiter');
const { createDatabaseBackup, listBackups, BACKUP_DIR } = require('../utils/backup');

// Helper to save base64 cover image to public/uploads/covers/
function saveBase64CoverImage(dataUrl, bookId) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  if (!dataUrl.startsWith('data:image/')) return dataUrl; // Already a URL or path

  try {
    const matches = dataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
    if (!matches) return null;

    let ext = matches[1].replace('jpeg', 'jpg').replace('+xml', '');
    if (ext === 'svg') ext = 'svg';
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');

    const uploadDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'covers');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const safeId = bookId ? String(bookId).replace(/[^a-zA-Z0-9_-]/g, '') : uuidv4();
    const cleanFilename = `cover_${safeId}_${Date.now()}.${ext}`;
    const filePath = path.join(uploadDir, cleanFilename);

    fs.writeFileSync(filePath, buffer);
    return `/uploads/covers/${cleanFilename}`;
  } catch (err) {
    console.error('Error saving base64 cover image:', err);
    return null;
  }
}

// Helper to log actions
function logAudit(db, admin_id, action, entity, entity_id, details, ip) {
  try {
    db.prepare('INSERT INTO audit_logs (id, admin_id, action, entity, entity_id, details, ip) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(uuidv4(), admin_id || 'system', action, entity, entity_id || '', JSON.stringify(details || {}), ip || '127.0.0.1');
  } catch (err) {
    console.error('Audit log failed', err);
  }
}

// Admin Login
router.post('/login', loginLimiter, async (req, res) => {
  const { username, email, password, totp_code } = req.body;
  const loginIdentifier = (email || username || '').trim();
  
  if (!loginIdentifier || !password) {
    return res.status(400).json({ error: 'Please enter both username/email and password' });
  }

  const db = getDb();
  try {
    const admin = db.prepare('SELECT * FROM admins WHERE email = ? OR username = ?').get(loginIdentifier, loginIdentifier);
    if (!admin) return res.status(401).json({ error: 'Invalid admin credentials' });

    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid admin credentials' });

    if (admin.totp_enabled) {
      if (!totp_code) {
        return res.status(401).json({ error: 'Two-factor authentication code required', require_2fa: true });
      }
      
      const totp = new OTPAuth.TOTP({
        issuer: 'CodeLibrary',
        label: admin.email,
        secret: OTPAuth.Secret.fromBase32(admin.totp_secret)
      });
      
      const delta = totp.validate({ token: totp_code.trim(), window: 1 });
      if (delta === null) {
        return res.status(401).json({ error: 'Invalid 2FA code', require_2fa: true });
      }
    }

    const token = jwt.sign(
      { id: admin.id, email: admin.email, username: admin.username, role: 'admin' }, 
      config.JWT_SECRET, 
      { expiresIn: '12h' }
    );
    
    res.cookie('admin_token', token, { 
      httpOnly: true, 
      secure: process.env.NODE_ENV === 'production', 
      sameSite: 'lax', 
      maxAge: 12 * 3600000 
    });
    
    logAudit(db, admin.id, 'LOGIN', 'ADMIN', admin.id, { email: admin.email }, req.ip);
    res.json({ success: true, admin: { id: admin.id, email: admin.email, username: admin.username, totp_enabled: !!admin.totp_enabled } });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Internal server error during admin login' });
  }
});

// Admin Logout
router.post('/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.json({ success: true });
});

// Protect all following routes with admin authentication
router.use(authenticateAdmin);

// Admin Profile
router.get('/me', (req, res) => {
  const db = getDb();
  const admin = db.prepare('SELECT id, email, username, totp_enabled FROM admins WHERE id = ?').get(req.admin.id);
  if (!admin) return res.status(404).json({ error: 'Admin account not found' });
  res.json({ id: admin.id, email: admin.email, username: admin.username, totp_enabled: !!admin.totp_enabled });
});

// 2FA Management
router.get('/2fa/status', (req, res) => {
  const db = getDb();
  const admin = db.prepare('SELECT totp_enabled FROM admins WHERE id = ?').get(req.admin.id);
  res.json({ enabled: !!(admin && admin.totp_enabled) });
});

router.post('/setup-2fa', async (req, res) => {
  const db = getDb();
  const secret = new OTPAuth.Secret({ size: 20 });
  const secretBase32 = secret.base32;
  
  const totp = new OTPAuth.TOTP({
    issuer: 'CodeLibrary',
    label: req.admin.email,
    secret: secret
  });
  
  db.prepare('UPDATE admins SET totp_secret = ? WHERE id = ?').run(secretBase32, req.admin.id);
  
  try {
    const dataUrl = await QRCode.toDataURL(totp.toString());
    res.json({ qr_code: dataUrl, secret: secretBase32 });
  } catch (err) {
    console.error('QR Code error:', err);
    res.status(500).json({ error: 'Failed to generate 2FA QR code' });
  }
});

router.post('/verify-2fa', (req, res) => {
  const { totp_code, code } = req.body;
  const tokenToVerify = (totp_code || code || '').trim();
  const db = getDb();
  const admin = db.prepare('SELECT totp_secret FROM admins WHERE id = ?').get(req.admin.id);
  
  if (!admin || !admin.totp_secret) {
    return res.status(400).json({ error: '2FA has not been initiated' });
  }

  const totp = new OTPAuth.TOTP({
    issuer: 'CodeLibrary',
    label: req.admin.email,
    secret: OTPAuth.Secret.fromBase32(admin.totp_secret)
  });
  
  const delta = totp.validate({ token: tokenToVerify, window: 1 });
  if (delta !== null) {
    db.prepare('UPDATE admins SET totp_enabled = 1 WHERE id = ?').run(req.admin.id);
    logAudit(db, req.admin.id, 'ENABLE_2FA', 'ADMIN', req.admin.id, {}, req.ip);
    res.json({ success: true, message: '2FA successfully enabled' });
  } else {
    res.status(400).json({ error: 'Invalid 6-digit verification code' });
  }
});

router.post('/disable-2fa', (req, res) => {
  const { totp_code, code } = req.body;
  const tokenToVerify = (totp_code || code || '').trim();
  const db = getDb();
  const admin = db.prepare('SELECT totp_secret, totp_enabled FROM admins WHERE id = ?').get(req.admin.id);
  
  if (!admin || !admin.totp_enabled) {
    return res.json({ success: true, message: '2FA is already disabled' });
  }

  const totp = new OTPAuth.TOTP({
    issuer: 'CodeLibrary',
    label: req.admin.email,
    secret: OTPAuth.Secret.fromBase32(admin.totp_secret)
  });
  
  const delta = totp.validate({ token: tokenToVerify, window: 1 });
  if (delta !== null) {
    db.prepare('UPDATE admins SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(req.admin.id);
    logAudit(db, req.admin.id, 'DISABLE_2FA', 'ADMIN', req.admin.id, {}, req.ip);
    res.json({ success: true, message: '2FA successfully disabled' });
  } else {
    res.status(400).json({ error: 'Invalid 6-digit verification code' });
  }
});

// Dashboard Analytics
router.get('/dashboard', (req, res) => {
  const db = getDb();
  try {
    const total_sales = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'paid'").get().count;
    const total_orders = db.prepare("SELECT COUNT(*) as count FROM orders").get().count;
    const total_customers = db.prepare("SELECT COUNT(*) as count FROM users").get().count;
    const revenue = db.prepare("SELECT SUM(amount) as total FROM orders WHERE status = 'paid'").get().total || 0;
    const total_ebooks_sold = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'paid' AND order_type = 'book'").get().count;
    const bundle_sales = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'paid' AND order_type = 'bundle'").get().count;

    // Monthly revenue (current month)
    const monthly_revenue = db.prepare(`
      SELECT SUM(amount) as total 
      FROM orders 
      WHERE status = 'paid' AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
    `).get().total || revenue;

    // Recent orders with customer and product details
    const recentOrdersRaw = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 20').all();
    const recentOrders = recentOrdersRaw.map(o => {
      let customerName = 'Guest';
      if (o.customer_id) {
        const u = db.prepare('SELECT name, email FROM users WHERE id = ?').get(o.customer_id);
        if (u) customerName = u.name || u.email;
      }
      let productName = o.order_type === 'bundle' ? 'Complete Programming Bundle' : 'eBook';
      if (o.order_type === 'book') {
        const b = db.prepare('SELECT title FROM books WHERE id = ?').get(o.product_id);
        if (b) productName = b.title;
      }
      return {
        id: o.id,
        customer: customerName,
        customerName: customerName,
        product: productName,
        productName: productName,
        amount: o.amount,
        status: o.status === 'paid' ? 'Paid' : (o.status === 'failed' ? 'Failed' : 'Pending'),
        paymentId: o.razorpay_payment_id || '-',
        createdAt: o.created_at
      };
    });

    // Helper to calculate chart metrics
    const getChartMetrics = (timeframe = '6m') => {
      let query = '';
      let params = [];

      if (timeframe === '30d') {
        // Daily for the last 30 days
        const raw = db.prepare(`
          SELECT strftime('%Y-%m-%d', created_at) as raw_date, 
                 strftime('%d %b', created_at) as label, 
                 SUM(amount) as total 
          FROM orders 
          WHERE status = 'paid' AND created_at >= datetime('now', '-30 days')
          GROUP BY raw_date 
          ORDER BY raw_date ASC
        `).all();

        if (raw.length > 0) {
          return {
            labels: raw.map(r => r.label),
            values: raw.map(r => r.total / 100)
          };
        }
        // Fallback placeholder days if no recent orders
        const now = new Date();
        const labels = [];
        const values = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date(now.getTime() - i * 86400000);
          labels.push(d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }));
          values.push(0);
        }
        if (revenue > 0) values[values.length - 1] = revenue / 100;
        return { labels, values };
      }

      let limit = 6;
      if (timeframe === '12m') limit = 12;
      if (timeframe === 'all') limit = 48;

      const chartRaw = db.prepare(`
        SELECT strftime('%Y-%m', created_at) as raw_month, 
               strftime('%b %Y', created_at) as label, 
               SUM(amount) as total 
        FROM orders 
        WHERE status = 'paid' 
        GROUP BY raw_month 
        ORDER BY raw_month ASC 
        LIMIT ?
      `).all(limit);

      if (chartRaw.length > 0) {
        return {
          labels: chartRaw.map(r => r.label || r.raw_month),
          values: chartRaw.map(r => r.total / 100)
        };
      }

      // Default last 6 months
      const defaultLabels = [];
      const defaultValues = [];
      const d = new Date();
      for (let i = 5; i >= 0; i--) {
        const past = new Date(d.getFullYear(), d.getMonth() - i, 1);
        defaultLabels.push(past.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }));
        defaultValues.push(0);
      }
      if (revenue > 0) defaultValues[defaultValues.length - 1] = revenue / 100;
      return { labels: defaultLabels, values: defaultValues };
    };

    const timeframe = req.query.timeframe || '6m';
    const chartData = getChartMetrics(timeframe);

    // List of months with sales for selector
    const availableMonths = db.prepare(`
      SELECT DISTINCT strftime('%Y-%m', created_at) as month_val, 
             strftime('%B %Y', created_at) as month_name 
      FROM orders 
      WHERE status = 'paid' 
      ORDER BY month_val DESC
    `).all();

    res.json({
      total_sales,
      total_orders,
      total_customers,
      revenue,
      total_ebooks_sold,
      bundle_sales,
      monthly_revenue,
      stats: {
        totalSales: revenue,
        totalOrders: total_orders,
        totalCustomers: total_customers,
        ebooksSold: total_ebooks_sold,
        bundleSales: bundle_sales,
        monthlyRevenue: monthly_revenue
      },
      recentOrders,
      chartData,
      availableMonths
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({ error: 'Database error fetching dashboard metrics' });
  }
});

// Dedicated Chart Data Route with timeframe & month selection
router.get('/dashboard/chart', (req, res) => {
  const db = getDb();
  const { timeframe, month } = req.query;

  try {
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      // Daily breakdown for a specific month
      const dailyRaw = db.prepare(`
        SELECT strftime('%Y-%m-%d', created_at) as raw_date, 
               strftime('%d %b', created_at) as label, 
               SUM(amount) as total 
        FROM orders 
        WHERE status = 'paid' AND strftime('%Y-%m', created_at) = ?
        GROUP BY raw_date 
        ORDER BY raw_date ASC
      `).all(month);

      if (dailyRaw.length > 0) {
        return res.json({
          labels: dailyRaw.map(r => r.label),
          values: dailyRaw.map(r => r.total / 100),
          title: `Revenue Trend (${month})`
        });
      }

      return res.json({
        labels: [`01 ${month}`, `15 ${month}`, `30 ${month}`],
        values: [0, 0, 0],
        title: `Revenue Trend (${month})`
      });
    }

    if (timeframe === '30d') {
      const raw = db.prepare(`
        SELECT strftime('%Y-%m-%d', created_at) as raw_date, 
               strftime('%d %b', created_at) as label, 
               SUM(amount) as total 
        FROM orders 
        WHERE status = 'paid' AND created_at >= datetime('now', '-30 days')
        GROUP BY raw_date 
        ORDER BY raw_date ASC
      `).all();

      return res.json({
        labels: raw.map(r => r.label),
        values: raw.map(r => r.total / 100),
        title: 'Revenue Trend (Last 30 Days)'
      });
    }

    let limit = 6;
    if (timeframe === '12m') limit = 12;
    if (timeframe === 'all') limit = 48;

    const chartRaw = db.prepare(`
      SELECT strftime('%Y-%m', created_at) as raw_month, 
             strftime('%b %Y', created_at) as label, 
             SUM(amount) as total 
      FROM orders 
      WHERE status = 'paid' 
      GROUP BY raw_month 
      ORDER BY raw_month ASC 
      LIMIT ?
    `).all(limit);

    return res.json({
      labels: chartRaw.map(r => r.label || r.raw_month),
      values: chartRaw.map(r => r.total / 100),
      title: 'Revenue Trend (₹)'
    });
  } catch (err) {
    console.error('Chart route error:', err);
    res.status(500).json({ error: 'Failed to fetch chart data' });
  }
});

router.get('/dashboard/recent-orders', (req, res) => {
  const db = getDb();
  try {
    const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 20').all();
    const result = orders.map(o => {
      let customerName = 'Guest';
      if (o.customer_id) {
        const u = db.prepare('SELECT name, email FROM users WHERE id = ?').get(o.customer_id);
        if (u) customerName = u.name || u.email;
      }
      let productName = o.order_type === 'bundle' ? 'Complete Programming Bundle' : 'eBook';
      if (o.order_type === 'book') {
        const b = db.prepare('SELECT title FROM books WHERE id = ?').get(o.product_id);
        if (b) productName = b.title;
      }
      return {
        id: o.id,
        customer: customerName,
        customerName: customerName,
        product: productName,
        productName: productName,
        amount: o.amount,
        status: o.status === 'paid' ? 'Paid' : (o.status === 'failed' ? 'Failed' : 'Pending'),
        paymentId: o.razorpay_payment_id || '-',
        createdAt: o.created_at
      };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch recent orders' });
  }
});

// Books Management
router.get('/books', (req, res) => {
  const db = getDb();
  try {
    const books = db.prepare('SELECT * FROM books ORDER BY created_at ASC').all();
    const formatted = books.map(b => ({
      ...b,
      status: b.is_published ? 'Published' : 'Draft',
      cover: b.cover_image,
      filename: b.ebook_filename,
      shortDescription: b.short_description,
      whatYouWillLearn: b.what_you_learn ? JSON.parse(b.what_you_learn) : [],
      topics: b.topics ? JSON.parse(b.topics) : []
    }));
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: 'Database error fetching books' });
  }
});

// Upload cover image directly
router.post('/books/upload-cover', (req, res) => {
  const { image, bookId } = req.body;
  if (!image) return res.status(400).json({ error: 'No image data provided' });

  const savedPath = saveBase64CoverImage(image, bookId);
  if (!savedPath) {
    return res.status(400).json({ error: 'Failed to process image. Must be a valid image (PNG, JPG, WebP, SVG).' });
  }

  if (bookId) {
    const db = getDb();
    db.prepare('UPDATE books SET cover_image = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(savedPath, bookId);
    logAudit(db, req.admin.id, 'UPLOAD_COVER', 'BOOK', bookId, { cover_image: savedPath }, req.ip);
  }

  res.json({ success: true, url: savedPath, message: 'Cover image uploaded successfully' });
});

router.post('/books', (req, res) => {
  const db = getDb();
  const { title, slug, price, description, short_description, shortDescription, what_you_learn, whatYouWillLearn, topics, category, cover_image, cover, is_published, status, ebook_filename, filename, google_drive_url, google_drive_link, gdrive_url } = req.body;
  
  if (!title || !slug || !price) {
    return res.status(400).json({ error: 'Title, slug, and price are required' });
  }

  const id = uuidv4();
  const finalShortDesc = short_description || shortDescription || '';
  const finalDesc = description || '';
  const finalCategory = category || 'programming-languages';
  const finalDriveUrl = (google_drive_url !== undefined ? google_drive_url : (google_drive_link !== undefined ? google_drive_link : (gdrive_url !== undefined ? gdrive_url : ''))) || '';
  
  let rawCover = cover_image || cover || '';
  let finalCover = rawCover.startsWith('data:image/') ? (saveBase64CoverImage(rawCover, id) || '') : rawCover;
  
  const finalFilename = ebook_filename || filename || `${slug}.pdf`;
  const finalPublished = (is_published === 1 || is_published === true || status === 'Published') ? 1 : 0;
  const learnArray = Array.isArray(what_you_learn) ? what_you_learn : (Array.isArray(whatYouWillLearn) ? whatYouWillLearn : []);
  const topicsArray = Array.isArray(topics) ? topics : [];

  try {
    db.prepare(`
      INSERT INTO books (id, title, slug, price, description, short_description, what_you_learn, topics, category, cover_image, is_published, ebook_filename, google_drive_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, title, slug, parseInt(price, 10), finalDesc, finalShortDesc,
      JSON.stringify(learnArray), JSON.stringify(topicsArray),
      finalCategory, finalCover, finalPublished, finalFilename, finalDriveUrl
    );
    
    logAudit(db, req.admin.id, 'CREATE', 'BOOK', id, { title, slug, price, cover_image: finalCover, google_drive_url: finalDriveUrl }, req.ip);
    res.json({ success: true, id, cover_image: finalCover, google_drive_url: finalDriveUrl, message: 'Book created successfully' });
  } catch (err) {
    console.error('Create book error:', err);
    res.status(500).json({ error: 'Failed to create book: ' + (err.message || 'database error') });
  }
});

router.put('/books/:id', (req, res) => {
  const db = getDb();
  const { title, slug, price, description, short_description, shortDescription, what_you_learn, whatYouWillLearn, topics, category, cover_image, cover, is_published, status, ebook_filename, filename, google_drive_url, google_drive_link, gdrive_url } = req.body;
  
  const existing = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Book not found' });

  const finalTitle = title !== undefined ? title : existing.title;
  const finalSlug = slug !== undefined ? slug : existing.slug;
  const finalPrice = price !== undefined ? parseInt(price, 10) : existing.price;
  const finalShortDesc = short_description || shortDescription || existing.short_description;
  const finalDesc = description !== undefined ? description : existing.description;
  const finalCategory = category || existing.category;
  const finalDriveUrl = (google_drive_url !== undefined ? google_drive_url : (google_drive_link !== undefined ? google_drive_link : (gdrive_url !== undefined ? gdrive_url : existing.google_drive_url))) || '';
  
  let rawCover = (cover_image !== undefined ? cover_image : (cover !== undefined ? cover : existing.cover_image)) || '';
  let finalCover = rawCover.startsWith('data:image/') ? (saveBase64CoverImage(rawCover, req.params.id) || existing.cover_image) : rawCover;
  
  const finalFilename = ebook_filename || filename || existing.ebook_filename;
  
  let finalPublished = existing.is_published;
  if (is_published !== undefined) finalPublished = (is_published === 1 || is_published === true) ? 1 : 0;
  if (status !== undefined) finalPublished = (status === 'Published') ? 1 : 0;

  const learnArray = what_you_learn || whatYouWillLearn || (existing.what_you_learn ? JSON.parse(existing.what_you_learn) : []);
  const topicsArray = topics || (existing.topics ? JSON.parse(existing.topics) : []);

  try {
    db.prepare(`
      UPDATE books SET 
        title = ?, slug = ?, price = ?, description = ?, short_description = ?, 
        what_you_learn = ?, topics = ?, category = ?, cover_image = ?, 
        is_published = ?, ebook_filename = ?, google_drive_url = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(
      finalTitle, finalSlug, finalPrice, finalDesc, finalShortDesc,
      JSON.stringify(learnArray), JSON.stringify(topicsArray),
      finalCategory, finalCover, finalPublished, finalFilename, finalDriveUrl,
      req.params.id
    );
    
    logAudit(db, req.admin.id, 'UPDATE', 'BOOK', req.params.id, { title: finalTitle, price: finalPrice, cover_image: finalCover, google_drive_url: finalDriveUrl }, req.ip);
    res.json({ success: true, cover_image: finalCover, google_drive_url: finalDriveUrl, message: 'Book updated successfully' });
  } catch (err) {
    console.error('Update book error:', err);
    res.status(500).json({ error: 'Failed to update book: ' + (err.message || 'database error') });
  }
});

router.delete('/books/:id', (req, res) => {
  const db = getDb();
  try {
    db.prepare('UPDATE books SET is_published = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
    logAudit(db, req.admin.id, 'DEACTIVATE', 'BOOK', req.params.id, {}, req.ip);
    res.json({ success: true, message: 'Book deactivated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to deactivate book' });
  }
});

// Bundles Management
router.get('/bundles', (req, res) => {
  const db = getDb();
  try {
    const bundles = db.prepare('SELECT * FROM bundles ORDER BY created_at DESC').all();
    const formatted = bundles.map(b => {
      const bookIds = b.books ? JSON.parse(b.books) : [];
      let bookTitles = [];
      if (bookIds.length > 0) {
        const placeholders = bookIds.map(() => '?').join(',');
        const booksList = db.prepare(`SELECT title FROM books WHERE id IN (${placeholders})`).all(...bookIds);
        bookTitles = booksList.map(bk => bk.title);
      }
      return {
        id: b.id,
        name: b.title,
        title: b.title,
        slug: b.slug,
        description: b.description,
        price: b.price,
        status: b.is_active ? 'Active' : 'Inactive',
        is_active: b.is_active,
        books: bookTitles,
        bookIds: bookIds
      };
    });
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: 'Database error fetching bundles' });
  }
});

router.put('/bundles/:id', (req, res) => {
  const db = getDb();
  const { price, books, is_active, status } = req.body;
  
  const existing = db.prepare('SELECT * FROM bundles WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Bundle not found' });

  const finalPrice = price !== undefined ? parseInt(price, 10) : existing.price;
  let finalActive = existing.is_active;
  if (is_active !== undefined) finalActive = (is_active === 1 || is_active === true) ? 1 : 0;
  if (status !== undefined) finalActive = (status === 'Active') ? 1 : 0;
  const finalBooks = books !== undefined ? JSON.stringify(books) : existing.books;

  try {
    db.prepare('UPDATE bundles SET price = ?, books = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      finalPrice, finalBooks, finalActive, req.params.id
    );
    logAudit(db, req.admin.id, 'UPDATE', 'BUNDLE', req.params.id, { price: finalPrice, is_active: finalActive }, req.ip);
    res.json({ success: true, message: 'Bundle updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update bundle' });
  }
});

// Orders Management
router.get('/orders', (req, res) => {
  const db = getDb();
  const { status } = req.query;
  try {
    let query = 'SELECT * FROM orders';
    const params = [];
    if (status) {
      query += ' WHERE status = ?';
      params.push(status.toLowerCase());
    }
    query += ' ORDER BY created_at DESC LIMIT 100';
    
    const orders = db.prepare(query).all(...params);
    const formatted = orders.map(o => {
      let customerName = 'Guest';
      let customerEmail = '';
      if (o.customer_id) {
        const u = db.prepare('SELECT name, email FROM users WHERE id = ?').get(o.customer_id);
        if (u) {
          customerName = u.name || u.email;
          customerEmail = u.email;
        }
      }
      let productName = o.order_type === 'bundle' ? 'Complete Programming Bundle' : 'eBook';
      if (o.order_type === 'book') {
        const b = db.prepare('SELECT title FROM books WHERE id = ?').get(o.product_id);
        if (b) productName = b.title;
      }
      return {
        id: o.id,
        customer: customerName,
        customerName: customerName,
        customerEmail: customerEmail,
        product: productName,
        productName: productName,
        amount: o.amount,
        status: o.status === 'paid' ? 'Paid' : (o.status === 'failed' ? 'Failed' : 'Pending'),
        paymentId: o.razorpay_payment_id || '-',
        createdAt: o.created_at
      };
    });
    res.json(formatted);
  } catch (err) {
    console.error('Orders fetch error:', err);
    res.status(500).json({ error: 'Database error fetching orders' });
  }
});

router.get('/orders/:id', (req, res) => {
  const db = getDb();
  try {
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!o) return res.status(404).json({ error: 'Order not found' });
    
    let customerName = 'Guest';
    let customerEmail = '';
    if (o.customer_id) {
      const u = db.prepare('SELECT name, email FROM users WHERE id = ?').get(o.customer_id);
      if (u) {
        customerName = u.name || u.email;
        customerEmail = u.email;
      }
    }
    let productName = o.order_type === 'bundle' ? 'Complete Programming Bundle' : 'eBook';
    if (o.order_type === 'book') {
      const b = db.prepare('SELECT title FROM books WHERE id = ?').get(o.product_id);
      if (b) productName = b.title;
    }
    
    res.json({
      id: o.id,
      customer: customerName,
      customerName: customerName,
      customerEmail: customerEmail,
      product: productName,
      productName: productName,
      amount: o.amount,
      status: o.status === 'paid' ? 'Paid' : (o.status === 'failed' ? 'Failed' : 'Pending'),
      paymentId: o.razorpay_payment_id || 'N/A',
      razorpay_order_id: o.razorpay_order_id,
      createdAt: o.created_at
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch order details' });
  }
});

router.put('/orders/:id/status', (req, res) => {
  const db = getDb();
  const { status } = req.body;
  const normalizedStatus = (status || '').toLowerCase();
  
  if (!['pending', 'paid', 'failed', 'refunded', 'cancelled'].includes(normalizedStatus)) {
    return res.status(400).json({ error: 'Invalid order status' });
  }

  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    db.prepare('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(normalizedStatus, req.params.id);
    
    // If transitioning to paid, grant download access if not already granted
    if (normalizedStatus === 'paid') {
      if (order.order_type === 'book') {
        db.prepare('INSERT OR IGNORE INTO download_access (id, customer_id, book_id, order_id) VALUES (?, ?, ?, ?)').run(
          uuidv4(), order.customer_id, order.product_id, order.id
        );
      } else if (order.order_type === 'bundle') {
        const bundle = db.prepare('SELECT books FROM bundles WHERE id = ?').get(order.product_id);
        if (bundle) {
          const bookIds = JSON.parse(bundle.books || '[]');
          const stmt = db.prepare('INSERT OR IGNORE INTO download_access (id, customer_id, book_id, order_id) VALUES (?, ?, ?, ?)');
          for (const bid of bookIds) {
            stmt.run(uuidv4(), order.customer_id, bid, order.id);
          }
        }
      }
    }
    
    logAudit(db, req.admin.id, 'UPDATE_STATUS', 'ORDER', req.params.id, { status: normalizedStatus }, req.ip);
    res.json({ success: true, message: 'Order status updated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

// Customer Management
router.get('/customers', (req, res) => {
  const db = getDb();
  try {
    const users = db.prepare('SELECT id, name, email, created_at FROM users ORDER BY created_at DESC LIMIT 100').all();
    const formatted = users.map(u => {
      const orderCount = db.prepare('SELECT COUNT(*) as count FROM orders WHERE customer_id = ?').get(u.id).count;
      const totalSpent = db.prepare("SELECT SUM(amount) as total FROM orders WHERE customer_id = ? AND status = 'paid'").get(u.id).total || 0;
      const downloads = db.prepare('SELECT COUNT(*) as count FROM download_access WHERE customer_id = ?').get(u.id).count;
      
      return {
        id: u.id,
        name: u.name || 'User',
        email: u.email,
        orderCount,
        totalSpent,
        purchases: downloads,
        createdAt: u.created_at
      };
    });
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: 'Database error fetching customers' });
  }
});

router.get('/customers/:id', (req, res) => {
  const db = getDb();
  try {
    const u = db.prepare('SELECT id, name, email, created_at FROM users WHERE id = ?').get(req.params.id);
    if (!u) return res.status(404).json({ error: 'Customer not found' });
    
    const orderCount = db.prepare('SELECT COUNT(*) as count FROM orders WHERE customer_id = ?').get(u.id).count;
    const totalSpent = db.prepare("SELECT SUM(amount) as total FROM orders WHERE customer_id = ? AND status = 'paid'").get(u.id).total || 0;
    const purchases = db.prepare(`
      SELECT b.title, b.category, d.granted_at 
      FROM download_access d 
      JOIN books b ON d.book_id = b.id 
      WHERE d.customer_id = ?
    `).all(u.id);
    
    const orders = db.prepare('SELECT id, amount, status, created_at FROM orders WHERE customer_id = ? ORDER BY created_at DESC').all(u.id);

    res.json({
      id: u.id,
      name: u.name || 'User',
      email: u.email,
      orderCount,
      totalSpent,
      createdAt: u.created_at,
      purchases,
      orders
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch customer details' });
  }
});

// Contact Messages
router.get('/contacts', (req, res) => {
  const db = getDb();
  try {
    const contacts = db.prepare('SELECT * FROM contact_messages ORDER BY created_at DESC').all();
    const formatted = contacts.map(c => ({
      id: c.id,
      name: c.name,
      email: c.email,
      message: c.message,
      status: c.is_read ? 'Read' : 'Unread',
      createdAt: c.created_at
    }));
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: 'Database error fetching messages' });
  }
});

router.put('/contacts/:id/read', (req, res) => {
  const db = getDb();
  try {
    db.prepare('UPDATE contact_messages SET is_read = 1 WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Message marked as read' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update message status' });
  }
});

// Audit Logs
router.get('/audit-logs', (req, res) => {
  const db = getDb();
  try {
    const logs = db.prepare(`
      SELECT a.*, adm.email as adminEmail 
      FROM audit_logs a 
      LEFT JOIN admins adm ON a.admin_id = adm.id 
      ORDER BY a.created_at DESC 
      LIMIT 100
    `).all();
    
    const formatted = logs.map(l => ({
      id: l.id,
      adminEmail: l.adminEmail || 'Admin',
      action: l.action,
      entity: l.entity,
      details: l.details || '',
      ipAddress: l.ip || '127.0.0.1',
      createdAt: l.created_at
    }));
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: 'Database error fetching audit logs' });
  }
});

// ==========================================
// Discount / Coupon Code Management
// ==========================================
router.get('/coupons', (req, res) => {
  const db = getDb();
  try {
    const coupons = db.prepare(`
      SELECT c.*, 
             (SELECT COUNT(*) FROM coupon_usages u WHERE u.coupon_id = c.id) as real_usage_count,
             (SELECT COALESCE(SUM(u.discount_amount), 0) FROM coupon_usages u WHERE u.coupon_id = c.id) as total_discount_given
      FROM coupons c
      ORDER BY c.created_at DESC
    `).all();

    res.json(coupons);
  } catch (err) {
    console.error('Fetch coupons error:', err);
    res.status(500).json({ error: 'Failed to fetch coupons' });
  }
});

router.get('/coupons/stats', (req, res) => {
  const db = getDb();
  try {
    const total_coupons = db.prepare('SELECT COUNT(*) as count FROM coupons').get().count;
    const active_coupons = db.prepare('SELECT COUNT(*) as count FROM coupons WHERE is_active = 1').get().count;
    const total_uses = db.prepare('SELECT COUNT(*) as count FROM coupon_usages').get().count;
    const total_discount_given = db.prepare('SELECT COALESCE(SUM(discount_amount), 0) as total FROM coupon_usages').get().total;

    res.json({
      total_coupons,
      active_coupons,
      total_uses,
      total_discount_given,
      totalCoupons: total_coupons,
      activeCoupons: active_coupons,
      totalUses: total_uses,
      totalDiscountGiven: total_discount_given
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch coupon metrics' });
  }
});

router.get('/coupons/:id', (req, res) => {
  const db = getDb();
  try {
    const coupon = db.prepare('SELECT * FROM coupons WHERE id = ?').get(req.params.id);
    if (!coupon) return res.status(404).json({ error: 'Coupon not found' });

    const usages = db.prepare(`
      SELECT u.*, usr.email as customer_email, usr.name as customer_name
      FROM coupon_usages u
      LEFT JOIN users usr ON u.customer_id = usr.id
      WHERE u.coupon_id = ?
      ORDER BY u.used_at DESC
      LIMIT 50
    `).all(coupon.id);

    res.json({ coupon, usages });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch coupon details' });
  }
});

router.post('/coupons', (req, res) => {
  const db = getDb();
  const { 
    code, 
    discount_type, 
    discount_value, 
    min_order_amount, 
    max_discount_amount, 
    start_date, 
    expiry_date, 
    usage_limit, 
    per_customer_limit, 
    is_active 
  } = req.body;

  if (!code || !discount_value) {
    return res.status(400).json({ error: 'Coupon code and discount value are required' });
  }

  const normalizedCode = code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,20}$/.test(normalizedCode)) {
    return res.status(400).json({ error: 'Coupon code must be 3-20 characters alphanumeric (letters, numbers, hyphens)' });
  }

  const existing = db.prepare('SELECT id FROM coupons WHERE code = ?').get(normalizedCode);
  if (existing) {
    return res.status(400).json({ error: `Coupon code "${normalizedCode}" already exists` });
  }

  const type = discount_type === 'fixed' ? 'fixed' : 'percentage';
  const val = parseInt(discount_value, 10);
  if (isNaN(val) || val <= 0) {
    return res.status(400).json({ error: 'Invalid discount value' });
  }
  if (type === 'percentage' && val > 100) {
    return res.status(400).json({ error: 'Percentage discount cannot exceed 100%' });
  }

  const id = uuidv4();
  const minAmount = min_order_amount ? parseInt(min_order_amount, 10) : 0;
  const maxDiscount = max_discount_amount ? parseInt(max_discount_amount, 10) : null;
  const uLimit = usage_limit ? parseInt(usage_limit, 10) : null;
  const perCustomer = per_customer_limit ? parseInt(per_customer_limit, 10) : 1;
  const activeState = is_active !== undefined ? (is_active ? 1 : 0) : 1;

  try {
    db.prepare(`
      INSERT INTO coupons (id, code, discount_type, discount_value, min_order_amount, max_discount_amount, start_date, expiry_date, usage_limit, per_customer_limit, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, normalizedCode, type, val, minAmount, maxDiscount, 
      start_date || new Date().toISOString(), 
      expiry_date || null, 
      uLimit, perCustomer, activeState
    );

    logAudit(db, req.admin.id, 'CREATE_COUPON', 'COUPON', id, { code: normalizedCode, type, val }, req.ip);
    res.status(201).json({ success: true, message: `Coupon "${normalizedCode}" created successfully`, id, code: normalizedCode, discount_type: type, discount_value: val, is_active: activeState });
  } catch (err) {
    console.error('Create coupon error:', err);
    res.status(500).json({ error: 'Failed to create coupon' });
  }
});

router.put('/coupons/:id', (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { 
    discount_type, 
    discount_value, 
    min_order_amount, 
    max_discount_amount, 
    start_date, 
    expiry_date, 
    usage_limit, 
    per_customer_limit, 
    is_active 
  } = req.body;

  const coupon = db.prepare('SELECT * FROM coupons WHERE id = ?').get(id);
  if (!coupon) return res.status(404).json({ error: 'Coupon not found' });

  const type = discount_type || coupon.discount_type;
  const val = discount_value !== undefined ? parseInt(discount_value, 10) : coupon.discount_value;
  if (type === 'percentage' && val > 100) {
    return res.status(400).json({ error: 'Percentage discount cannot exceed 100%' });
  }

  const minAmount = min_order_amount !== undefined ? parseInt(min_order_amount, 10) : coupon.min_order_amount;
  const maxDiscount = max_discount_amount !== undefined ? (max_discount_amount ? parseInt(max_discount_amount, 10) : null) : coupon.max_discount_amount;
  const uLimit = usage_limit !== undefined ? (usage_limit ? parseInt(usage_limit, 10) : null) : coupon.usage_limit;
  const perCustomer = per_customer_limit !== undefined ? parseInt(per_customer_limit, 10) : coupon.per_customer_limit;
  const activeState = is_active !== undefined ? (is_active ? 1 : 0) : coupon.is_active;

  try {
    db.prepare(`
      UPDATE coupons 
      SET discount_type = ?, discount_value = ?, min_order_amount = ?, max_discount_amount = ?, 
          start_date = ?, expiry_date = ?, usage_limit = ?, per_customer_limit = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      type, val, minAmount, maxDiscount,
      start_date || coupon.start_date,
      expiry_date !== undefined ? (expiry_date || null) : coupon.expiry_date,
      uLimit, perCustomer, activeState, id
    );

    logAudit(db, req.admin.id, 'UPDATE_COUPON', 'COUPON', id, { code: coupon.code }, req.ip);
    res.json({ success: true, message: `Coupon "${coupon.code}" updated successfully`, id, code: coupon.code, discount_type: type, discount_value: val, is_active: activeState });
  } catch (err) {
    console.error('Update coupon error:', err);
    res.status(500).json({ error: 'Failed to update coupon' });
  }
});

router.patch('/coupons/:id/toggle', (req, res) => {
  const db = getDb();
  const { id } = req.params;
  try {
    const coupon = db.prepare('SELECT id, code, is_active FROM coupons WHERE id = ?').get(id);
    if (!coupon) return res.status(404).json({ error: 'Coupon not found' });

    const nextState = coupon.is_active ? 0 : 1;
    db.prepare('UPDATE coupons SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(nextState, id);

    logAudit(db, req.admin.id, 'TOGGLE_COUPON', 'COUPON', id, { code: coupon.code, is_active: nextState }, req.ip);
    res.json({ success: true, is_active: !!nextState, message: `Coupon "${coupon.code}" is now ${nextState ? 'Active' : 'Inactive'}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to toggle coupon status' });
  }
});

router.delete('/coupons/:id', (req, res) => {
  const db = getDb();
  const { id } = req.params;
  try {
    const coupon = db.prepare('SELECT id, code FROM coupons WHERE id = ?').get(id);
    if (!coupon) return res.status(404).json({ error: 'Coupon not found' });

    // Delete usage records and coupon
    db.prepare('DELETE FROM coupon_usages WHERE coupon_id = ?').run(id);
    db.prepare('DELETE FROM coupons WHERE id = ?').run(id);

    logAudit(db, req.admin.id, 'DELETE_COUPON', 'COUPON', id, { code: coupon.code }, req.ip);
    res.json({ success: true, message: `Coupon "${coupon.code}" deleted successfully` });
  } catch (err) {
    console.error('Delete coupon error:', err);
    res.status(500).json({ error: 'Failed to delete coupon' });
  }
});

// Database Backup Management Endpoints (Admin Only)
router.get('/backups', (req, res) => {
  try {
    const backups = listBackups();
    res.json({ success: true, backups });
  } catch (err) {
    console.error('List backups error:', err);
    res.status(500).json({ error: 'Failed to list database backups' });
  }
});

router.post('/backups', (req, res) => {
  const db = getDb();
  try {
    const backup = createDatabaseBackup({ tag: 'admin_manual' });
    logAudit(db, req.admin.id, 'CREATE_BACKUP', 'DATABASE', backup.filename, { size: backup.sizeFormatted }, req.ip);
    res.json({ success: true, message: 'Database backup created successfully', backup });
  } catch (err) {
    console.error('Create backup error:', err);
    res.status(500).json({ error: 'Failed to create database backup: ' + err.message });
  }
});

router.get('/backups/download/:filename', (req, res) => {
  const db = getDb();
  const filename = path.basename(req.params.filename);
  if (!filename.endsWith('.sqlite') && !filename.endsWith('.db') && !filename.endsWith('.bak')) {
    return res.status(400).json({ error: 'Invalid backup file format' });
  }

  const filePath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Backup file not found' });
  }

  logAudit(db, req.admin.id, 'DOWNLOAD_BACKUP', 'DATABASE', filename, {}, req.ip);
  res.download(filePath, filename);
});

// ===================================================
// Contact & Social Media Settings Endpoints (Admin Only)
// ===================================================
router.get('/settings/contact', (req, res) => {
  const db = getDb();
  try {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    res.json({ success: true, settings });
  } catch (err) {
    console.error('Fetch contact settings error:', err);
    res.status(500).json({ error: 'Failed to fetch contact settings' });
  }
});

router.put('/settings/contact', (req, res) => {
  const db = getDb();
  const validator = require('validator');
  const allowedKeys = [
    'contact_phone', 'contact_whatsapp', 'whatsapp_message', 'support_email', 'business_email', 'contact_address',
    'social_whatsapp_enabled', 'social_whatsapp_url',
    'social_instagram_enabled', 'social_instagram_url',
    'social_facebook_enabled', 'social_facebook_url',
    'social_youtube_enabled', 'social_youtube_url',
    'social_twitter_enabled', 'social_twitter_url',
    'social_telegram_enabled', 'social_telegram_url',
    'social_linkedin_enabled', 'social_linkedin_url',
    'social_pinterest_enabled', 'social_pinterest_url',
    'social_discord_enabled', 'social_discord_url'
  ];

  try {
    const payload = req.body || {};

    // Validate emails if provided
    if (payload.support_email && payload.support_email.trim() && !validator.isEmail(payload.support_email.trim())) {
      return res.status(400).json({ error: 'Please enter a valid Support Email address' });
    }
    if (payload.business_email && payload.business_email.trim() && !validator.isEmail(payload.business_email.trim())) {
      return res.status(400).json({ error: 'Please enter a valid Business Email address' });
    }

    // Validate social URLs if provided
    const socialUrlKeys = [
      'social_whatsapp_url', 'social_instagram_url', 'social_facebook_url', 'social_youtube_url',
      'social_twitter_url', 'social_telegram_url', 'social_linkedin_url', 'social_pinterest_url', 'social_discord_url'
    ];

    for (const key of socialUrlKeys) {
      const urlVal = (payload[key] || '').trim();
      if (urlVal && !urlVal.startsWith('https://') && !urlVal.startsWith('http://') && !urlVal.startsWith('tg://') && !urlVal.startsWith('wa.me/')) {
        return res.status(400).json({ error: `Invalid URL format for ${key.replace('social_', '').replace('_url', '')}. Must start with https://` });
      }
    }

    const upsertStmt = db.prepare(`
      INSERT INTO settings (key, value, updated_at) 
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `);

    const updatedSettings = {};

    for (const key of allowedKeys) {
      if (payload[key] !== undefined) {
        let val = payload[key];
        if (typeof val === 'boolean') {
          val = val ? '1' : '0';
        } else if (val === null || val === undefined) {
          val = '';
        } else {
          val = String(val).trim();
        }
        upsertStmt.run(key, val);
        updatedSettings[key] = val;
      }
    }

    logAudit(db, req.admin.id, 'UPDATE_SETTINGS', 'SETTINGS', 'contact_social', { updated_keys: Object.keys(updatedSettings) }, req.ip);

    res.json({
      success: true,
      message: 'Contact & social media settings saved successfully',
      settings: updatedSettings
    });
  } catch (err) {
    console.error('Update contact settings error:', err);
    res.status(500).json({ error: 'Failed to update contact settings: ' + err.message });
  }
});

module.exports = router;

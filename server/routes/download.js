const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { getDb } = require('../db/schema');
const config = require('../utils/config');

// Helper to check user/admin authentication from cookie if available
function getSessionUser(req) {
  const token = req.cookies.token || req.cookies.admin_token;
  if (!token) return null;
  try {
    return jwt.verify(token, config.JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// Core protected download delivery handler
async function handleDownloadDelivery(req, res) {
  const db = getDb();
  const rawBookId = req.params.bookId || req.params.id;
  const rawOrderId = req.params.orderId || req.query.order_id || req.query.orderId;
  const rawToken = req.query.token || req.headers['x-download-token'];
  const sessionUser = getSessionUser(req);

  if (!rawBookId) {
    return res.status(400).json({ error: 'Book ID is required' });
  }

  const book = db.prepare('SELECT id, title, slug, ebook_filename, google_drive_url FROM books WHERE id = ? OR slug = ?').get(rawBookId, rawBookId);
  if (!book) {
    return res.status(404).json({ error: 'Book not found' });
  }

  let isAuthorized = false;

  // 1. Validate by Order ID + Download Token (No customer login required)
  if (rawOrderId && rawToken) {
    const order = db.prepare("SELECT * FROM orders WHERE id = ? AND status = 'paid'").get(rawOrderId);
    if (order && order.download_token && order.download_token === rawToken.trim()) {
      // Verify that this book is part of the order
      if (order.order_type === 'book' && (order.product_id === book.id || order.product_id === book.slug)) {
        isAuthorized = true;
      } else if (order.order_type === 'bundle') {
        const bundle = db.prepare("SELECT books FROM bundles WHERE (id = ? OR slug = ? OR ? = 'bundle')").get(order.product_id, order.product_id, order.product_id);
        if (bundle) {
          const bIds = JSON.parse(bundle.books || '[]');
          if (bIds.includes(book.id) || bIds.includes(book.slug)) {
            isAuthorized = true;
          }
        }
      } else {
        // Check items_json or download_access table
        let itemsList = [];
        try { itemsList = order.items_json ? JSON.parse(order.items_json) : []; } catch (e) {}
        
        const hasItem = itemsList.some(item => {
          if (item.id === book.id || item.slug === book.slug) return true;
          if (item.type === 'bundle' && item.books) {
            const bList = Array.isArray(item.books) ? item.books : (typeof item.books === 'string' ? JSON.parse(item.books) : []);
            return bList.includes(book.id) || bList.includes(book.slug);
          }
          return false;
        });

        if (hasItem) {
          isAuthorized = true;
        } else {
          const accessRecord = db.prepare('SELECT id FROM download_access WHERE order_id = ? AND book_id = ?').get(order.id, book.id);
          if (accessRecord) isAuthorized = true;
        }
      }
    }
  }

  // 2. Validate by Authenticated Session (Customer or Admin)
  if (!isAuthorized && sessionUser) {
    if (sessionUser.role === 'admin') {
      isAuthorized = true; // Admin can preview downloads
    } else {
      const access = db.prepare(`
        SELECT d.id 
        FROM download_access d 
        JOIN orders o ON d.order_id = o.id 
        WHERE d.customer_id = ? AND d.book_id = ? AND o.status = 'paid'
      `).get(sessionUser.id, book.id);
      if (access) isAuthorized = true;
    }
  }

  // If not authenticated or missing valid token
  if (!isAuthorized) {
    if (!rawOrderId && !rawToken && !sessionUser) {
      return res.status(401).json({ error: 'Unauthorized. A valid download token or session is required.' });
    }
    return res.status(403).json({ error: 'Access denied. You have not purchased this eBook or your download token is invalid.' });
  }

  const driveUrl = (book.google_drive_url || '').trim();
  const localFilename = (book.ebook_filename || '').trim();
  const localDir = path.isAbsolute(config.EBOOK_STORAGE_PATH || './ebooks')
    ? (config.EBOOK_STORAGE_PATH || './ebooks')
    : path.join(__dirname, '..', '..', config.EBOOK_STORAGE_PATH || './ebooks');
  const localPath = localFilename ? path.join(localDir, localFilename) : null;
  const hasLocalFile = localPath && fs.existsSync(localPath);

  // Determine if local file is a real uploaded eBook or just a small dummy file
  let isRealLocalFile = false;
  if (hasLocalFile) {
    try {
      const stats = fs.statSync(localPath);
      // Dummy sample files generated in seed are ~1KB. Real eBooks are >15KB
      if (stats.size > 15000) {
        isRealLocalFile = true;
      }
    } catch (e) {}
  }

  if (!driveUrl && !isRealLocalFile) {
    return res.status(404).json({
      success: false,
      error: 'eBook PDF is being prepared. Please contact support@codelibrary.in.'
    });
  }

  // If JSON request, return endpoint URL without exposing raw Google Drive URL
  const isJsonRequest = (req.headers.accept && req.headers.accept.includes('application/json') && !req.headers.accept.includes('text/html')) ||
                        req.query.json === '1' || req.query.format === 'json' || req.xhr;

  if (isJsonRequest) {
    const downloadEndpoint = rawOrderId && rawToken
      ? `/api/orders/${rawOrderId}/download/${book.id}?token=${rawToken}`
      : `/api/library/books/${book.id}/download`;

    return res.json({
      success: true,
      delivery_type: 'secure_download',
      download_url: downloadEndpoint,
      title: book.title
    });
  }

  // 1. PRIMARY SOURCE: Deliver configured Google Drive URL / External Link if set
  if (driveUrl) {
    const isFolder = driveUrl.includes('/folders/');
    const fileIdMatch = driveUrl.match(/(?:\/file\/d\/|\/d\/|id=)([a-zA-Z0-9_-]{20,})/);
    const fileId = fileIdMatch ? fileIdMatch[1] : null;

    if (fileId && !isFolder) {
      const directDownloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);

        const upstreamRes = await fetch(directDownloadUrl, {
          signal: controller.signal,
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        clearTimeout(timeout);

        const contentType = (upstreamRes.headers.get('content-type') || '').toLowerCase();
        if (upstreamRes.ok && (contentType.includes('application/pdf') || contentType.includes('application/octet-stream') || contentType.includes('binary'))) {
          const arrayBuffer = await upstreamRes.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          // Verify it is a valid PDF
          if (buffer.length > 4 && buffer.slice(0, 4).toString() === '%PDF') {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${book.slug || 'ebook'}.pdf"`);
            res.setHeader('Content-Length', buffer.length);
            res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            return res.send(buffer);
          }
        }
      } catch (proxyErr) {
        console.warn('[Google Drive Stream Notice - Redirecting]:', proxyErr.message);
      }
    }

    // Direct redirect to the Google Drive file or folder URL
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    return res.redirect(302, driveUrl);
  }

  // 2. SECONDARY SOURCE: Deliver real local file if present and no Google Drive link is set
  if (isRealLocalFile) {
    try {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${book.slug || 'ebook'}.pdf"`);
      res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      const stream = fs.createReadStream(localPath);
      return stream.pipe(res);
    } catch (streamErr) {
      console.error('Local file stream error:', streamErr);
    }
  }

  return res.status(404).json({
    success: false,
    error: 'eBook PDF is being updated. Please contact support.'
  });
}

// Download routes
router.get('/:orderId/:bookId', handleDownloadDelivery);
router.get('/:bookId', handleDownloadDelivery);
router.get('/:bookId/download', handleDownloadDelivery);
router.get('/books/:bookId/download', handleDownloadDelivery);
router.get('/books/:bookId', handleDownloadDelivery);

module.exports = router;

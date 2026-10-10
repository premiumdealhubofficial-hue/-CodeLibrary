const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { getDb } = require('../db/schema');
const config = require('../utils/config');

// In-memory cache for resolved Google Drive folder PDFs: folderId -> { result, cachedAt }
const folderPdfCache = new Map();

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

// Parse PDF files listed inside a public Google Drive folder HTML
function extractPdfFilesFromDriveFolderHtml(html) {
  const unescaped = html
    .replace(/\\x22/g, '"')
    .replace(/\\x5b/g, '[')
    .replace(/\\x5d/g, ']')
    .replace(/\\\//g, '/');

  const results = [];
  
  // Primary pattern: "FILE_ID",["FOLDER_ID"],"FILENAME.pdf","application/pdf"
  const fileRegex = /"([a-zA-Z0-9_-]{25,})",\s*\["([a-zA-Z0-9_-]{25,})"\],\s*"([^"]+?\.[a-zA-Z0-9]+)"/g;
  let match;
  while ((match = fileRegex.exec(unescaped)) !== null) {
    const fileId = match[1];
    const folderId = match[2];
    const filename = match[3];
    if (filename.toLowerCase().endsWith('.pdf') && !results.some(r => r.fileId === fileId)) {
      results.push({ fileId, folderId, filename });
    }
  }

  // Secondary pattern: "FILE_ID",null,"FILENAME.pdf" or ["FILE_ID",...,"FILENAME.pdf"]
  const fileRegex2 = /"([a-zA-Z0-9_-]{25,})",\s*(?:null|\[[^\]]*\]),\s*"([^"]+?\.pdf)"/gi;
  while ((match = fileRegex2.exec(unescaped)) !== null) {
    const fileId = match[1];
    const filename = match[2];
    if (!results.some(r => r.fileId === fileId)) {
      results.push({ fileId, filename });
    }
  }

  // Tertiary pattern: ["FILENAME.pdf",null,1] or similar
  const fileRegex3 = /\["([a-zA-Z0-9_-]{28,})"[^\]]*?"([^"]*?\.pdf)"/gi;
  while ((match = fileRegex3.exec(unescaped)) !== null) {
    const fileId = match[1];
    const filename = match[2];
    if (!results.some(r => r.fileId === fileId)) {
      results.push({ fileId, filename });
    }
  }

  return results;
}

// Match best PDF inside a multi-file folder based on eBook title and slug keywords
function matchBestPdfForBook(files, book) {
  if (!files || files.length === 0) return null;
  if (files.length === 1) return files[0];

  const titleWords = (book.title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1);

  const slugWords = (book.slug || '')
    .toLowerCase()
    .split('-')
    .filter(w => w.length > 1);

  const allKeywords = Array.from(new Set([...titleWords, ...slugWords]));

  let bestFile = null;
  let bestScore = -1;

  for (const file of files) {
    const fn = file.filename.toLowerCase();
    let score = 0;

    // Keyword matching
    for (const kw of allKeywords) {
      if (fn.includes(kw)) score += 10;
    }

    // Prefer comprehensive notes / handwritten notes over single quiz files
    if (fn.includes('handwritten') || fn.includes('notes') || fn.includes('complete') || fn.includes('hand written')) {
      score += 5;
    }
    if (fn.includes('interview') || fn.includes('qna') || fn.includes('questions')) {
      score += 2;
    }

    if (score > bestScore) {
      bestScore = score;
      bestFile = file;
    }
  }

  return bestFile || files[0];
}

// Resolve Google Drive folder link to exact PDF file ID and filename
async function resolveDriveFolderToPdf(folderUrl, book) {
  const folderMatch = folderUrl.match(/\/folders\/([a-zA-Z0-9_-]{20,})/);
  const folderId = folderMatch ? folderMatch[1] : null;

  if (folderId && folderPdfCache.has(folderId)) {
    const cached = folderPdfCache.get(folderId);
    if (Date.now() - cached.cachedAt < 15 * 60 * 1000) { // 15 min TTL
      return cached.result;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  const res = await fetch(folderUrl, {
    signal: controller.signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    }
  });
  clearTimeout(timeout);

  if (!res.ok) {
    throw new Error(`Failed to access Google Drive folder (HTTP ${res.status})`);
  }

  const html = await res.text();
  const pdfs = extractPdfFilesFromDriveFolderHtml(html);
  
  if (pdfs.length === 0) {
    return null;
  }

  const matched = matchBestPdfForBook(pdfs, book);
  if (folderId && matched) {
    folderPdfCache.set(folderId, { result: matched, cachedAt: Date.now() });
  }

  return matched;
}

// Fetch real PDF binary buffer directly from Google Drive
async function fetchPdfBufferFromDrive(fileId) {
  const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  const res = await fetch(directUrl, {
    signal: controller.signal,
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    }
  });
  clearTimeout(timeout);

  if (!res.ok) {
    throw new Error(`Google Drive download failed with HTTP ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Validate that it is a valid PDF
  if (buffer.length < 100 || buffer.slice(0, 4).toString() !== '%PDF') {
    // Check if Google returned a virus scan confirmation HTML page for large files (>25MB)
    const htmlText = buffer.toString('utf8');
    const confirmMatch = htmlText.match(/href="(\/uc\?export=download&amp;id=[^"]+&amp;confirm=[^"&]+)/);
    if (confirmMatch) {
      const confirmUrl = 'https://drive.google.com' + confirmMatch[1].replace(/&amp;/g, '&');
      const confirmRes = await fetch(confirmUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        }
      });
      const confirmArrayBuffer = await confirmRes.arrayBuffer();
      const confirmBuf = Buffer.from(confirmArrayBuffer);
      if (confirmBuf.length > 100 && confirmBuf.slice(0, 4).toString() === '%PDF') {
        return confirmBuf;
      }
    }
    throw new Error('Downloaded file is not a valid PDF document');
  }

  return buffer;
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

  // Determine if local file is a real uploaded eBook or just a small dummy seed file
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

  // 1. PRIMARY SOURCE: Deliver configured Google Drive URL / Folder / File
  if (driveUrl) {
    const isFolder = driveUrl.includes('/folders/');
    let targetFileId = null;
    let targetFilename = `${book.slug || 'ebook'}.pdf`;

    if (isFolder) {
      try {
        const matched = await resolveDriveFolderToPdf(driveUrl, book);
        if (matched) {
          targetFileId = matched.fileId;
          targetFilename = matched.filename || targetFilename;
        } else {
          return res.status(404).json({
            success: false,
            error: 'No valid PDF found in the configured Google Drive folder. Please contact support.'
          });
        }
      } catch (folderErr) {
        console.warn('[Drive Folder Resolution Error - Redirecting to folder]:', folderErr.message);
        res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        return res.redirect(302, driveUrl);
      }
    } else {
      const fileIdMatch = driveUrl.match(/(?:\/file\/d\/|\/d\/|id=)([a-zA-Z0-9_-]{20,})/);
      targetFileId = fileIdMatch ? fileIdMatch[1] : null;
    }

    if (targetFileId) {
      try {
        const buffer = await fetchPdfBufferFromDrive(targetFileId);
        
        // Clean attachment filename
        const safeFilename = targetFilename.replace(/[^\w\s.-]/gi, '_');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
        res.setHeader('Content-Length', buffer.length);
        res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        return res.send(buffer);
      } catch (streamErr) {
        console.warn('[Direct Drive PDF Fetch Notice - Fallback]:', streamErr.message);
        // If streaming failed and it was a direct file or folder, fallback to 302 redirect
        res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        return res.redirect(302, driveUrl);
      }
    }

    // Direct redirect if file ID could not be determined
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

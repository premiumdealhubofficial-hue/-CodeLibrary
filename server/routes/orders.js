const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getDb } = require('../db/schema');
const config = require('../utils/config');

// Helper to check admin authentication from cookie
function isAdmin(req) {
  const token = req.cookies.admin_token;
  if (!token) return false;
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    return decoded && decoded.role === 'admin';
  } catch (e) {
    return false;
  }
}

// GET /api/orders/:id/invoice - Render and download printable HTML invoice
router.get('/:id/invoice', (req, res) => {
  const db = getDb();
  const orderId = req.params.id;
  const token = req.query.token;

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) {
    return res.status(404).send('<h2>Order Not Found</h2><p>The requested order does not exist.</p>');
  }

  // Authorize by download token or admin session
  const tokenValid = token && order.download_token && token.trim() === order.download_token.trim();
  const adminAuthorized = isAdmin(req);

  if (!tokenValid && !adminAuthorized) {
    return res.status(403).send('<h2>Access Denied</h2><p>Invalid or missing invoice authorization token.</p>');
  }

  if (order.status !== 'paid') {
    return res.status(400).send('<h2>Invoice Unavailable</h2><p>Invoice is only available for completed and verified payments.</p>');
  }

  // Resolve purchased items
  let itemsList = [];
  try {
    itemsList = order.items_json ? JSON.parse(order.items_json) : [];
  } catch (e) {
    itemsList = [];
  }

  if (itemsList.length === 0) {
    if (order.order_type === 'book') {
      const b = db.prepare('SELECT title, price, category FROM books WHERE id = ? OR slug = ?').get(order.product_id, order.product_id);
      if (b) itemsList.push({ title: b.title, price: order.original_amount || order.amount, type: 'book' });
    } else if (order.order_type === 'bundle') {
      const bundle = db.prepare('SELECT title, price FROM bundles WHERE id = ? OR slug = ?').get(order.product_id, order.product_id);
      itemsList.push({ title: bundle ? bundle.title : 'Complete Programming Bundle', price: order.original_amount || order.amount, type: 'bundle' });
    }
  }

  const dateFormatted = new Date(order.created_at || Date.now()).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const subtotalRupees = ((order.original_amount || order.amount) / 100).toFixed(2);
  const discountRupees = ((order.discount_amount || 0) / 100).toFixed(2);
  const totalRupees = (order.amount / 100).toFixed(2);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice #${order.id.substring(0, 8).toUpperCase()} — CodeLibrary</title>
  <style>
    :root {
      --primary: #2563eb;
      --text: #1e293b;
      --text-muted: #64748b;
      --border: #e2e8f0;
      --bg: #ffffff;
      --card-bg: #f8fafc;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: var(--text);
      background-color: #f1f5f9;
      padding: 2rem 1rem;
      line-height: 1.5;
    }
    .invoice-wrapper {
      max-width: 800px;
      margin: 0 auto;
      background: var(--bg);
      border-radius: 12px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.06);
      border: 1px solid var(--border);
      padding: 3rem;
    }
    .invoice-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid var(--border);
      padding-bottom: 2rem;
      margin-bottom: 2rem;
    }
    .brand-logo {
      font-size: 1.75rem;
      font-weight: 800;
      color: var(--primary);
      letter-spacing: -0.5px;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .brand-tagline {
      font-size: 0.875rem;
      color: var(--text-muted);
      margin-top: 0.25rem;
    }
    .invoice-title-block {
      text-align: right;
    }
    .invoice-title {
      font-size: 2rem;
      font-weight: 900;
      color: var(--text);
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .badge-paid {
      display: inline-block;
      background: #10b981;
      color: #ffffff;
      font-size: 0.75rem;
      font-weight: 700;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      text-transform: uppercase;
      margin-top: 0.5rem;
      letter-spacing: 0.5px;
    }
    .invoice-meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2rem;
      margin-bottom: 2.5rem;
    }
    .meta-box h4 {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
    }
    .meta-box p {
      font-size: 0.95rem;
      color: var(--text);
      margin-bottom: 0.25rem;
    }
    .meta-box p strong {
      font-weight: 600;
    }
    .table-container {
      margin-bottom: 2rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }
    th {
      background: var(--card-bg);
      font-size: 0.8rem;
      text-transform: uppercase;
      color: var(--text-muted);
      padding: 0.85rem 1rem;
      border-bottom: 1px solid var(--border);
    }
    td {
      padding: 1rem;
      border-bottom: 1px solid var(--border);
      font-size: 0.95rem;
    }
    .text-right { text-align: right; }
    .invoice-summary {
      display: flex;
      justify-content: flex-end;
      margin-top: 1.5rem;
    }
    .summary-table {
      width: 320px;
    }
    .summary-row {
      display: flex;
      justify-content: space-between;
      padding: 0.5rem 0;
      font-size: 0.95rem;
      color: var(--text);
    }
    .summary-row.total {
      border-top: 2px solid var(--border);
      margin-top: 0.5rem;
      padding-top: 0.75rem;
      font-size: 1.25rem;
      font-weight: 800;
      color: var(--primary);
    }
    .discount-text {
      color: #10b981;
      font-weight: 600;
    }
    .invoice-footer {
      border-top: 1px solid var(--border);
      margin-top: 3rem;
      padding-top: 1.5rem;
      text-align: center;
      color: var(--text-muted);
      font-size: 0.85rem;
    }
    .actions-bar {
      max-width: 800px;
      margin: 1.5rem auto 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: var(--primary);
      color: #fff;
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      font-size: 0.95rem;
      border: none;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.9; }
    .btn-secondary {
      background: #475569;
    }
    @media print {
      body { background: #fff; padding: 0; }
      .invoice-wrapper { box-shadow: none; border: none; padding: 0; }
      .actions-bar { display: none !important; }
    }
  </style>
</head>
<body>

  <div class="invoice-wrapper">
    <div class="invoice-header">
      <div>
        <div class="brand-logo">
          <span>&lt;/&gt;</span> CodeLibrary
        </div>
        <p class="brand-tagline">Premium Programming eBooks & Guides</p>
      </div>
      <div class="invoice-title-block">
        <div class="invoice-title">INVOICE</div>
        <span class="badge-paid">Payment Verified</span>
      </div>
    </div>

    <div class="invoice-meta-grid">
      <div class="meta-box">
        <h4>Billed To:</h4>
        <p><strong>${escapeHtml(order.customer_name || 'Customer')}</strong></p>
        <p>${escapeHtml(order.customer_email || 'Email on file')}</p>
        ${order.customer_phone ? `<p>Phone: ${escapeHtml(order.customer_phone)}</p>` : ''}
      </div>
      <div class="meta-box" style="text-align: right;">
        <h4>Invoice Details:</h4>
        <p><strong>Invoice #:</strong> INV-${order.id.substring(0, 8).toUpperCase()}</p>
        <p><strong>Order ID:</strong> ${order.id}</p>
        <p><strong>Date:</strong> ${dateFormatted}</p>
        ${order.razorpay_payment_id ? `<p><strong>Payment ID:</strong> ${escapeHtml(order.razorpay_payment_id)}</p>` : ''}
      </div>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Item Description</th>
            <th class="text-right">Price</th>
          </tr>
        </thead>
        <tbody>
          ${itemsList.map((item, idx) => `
            <tr>
              <td>${idx + 1}</td>
              <td>
                <strong>${escapeHtml(item.title || 'Programming eBook')}</strong>
                <span style="font-size: 0.8rem; color: var(--text-muted); display: block;">Digital eBook Download (PDF)</span>
              </td>
              <td class="text-right">₹${((item.price || 0) / 100).toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="invoice-summary">
      <div class="summary-table">
        <div class="summary-row">
          <span>Subtotal:</span>
          <span>₹${subtotalRupees}</span>
        </div>
        ${order.discount_amount > 0 ? `
          <div class="summary-row discount-text">
            <span>Coupon Discount (${escapeHtml(order.coupon_code || 'OFFER')}):</span>
            <span>-₹${discountRupees}</span>
          </div>
        ` : ''}
        <div class="summary-row total">
          <span>Amount Paid:</span>
          <span>₹${totalRupees}</span>
        </div>
      </div>
    </div>

    <div class="invoice-footer">
      <p>Thank you for learning with CodeLibrary! We wish you happy coding and success in your tech career.</p>
      <p style="margin-top: 0.35rem;">Need support? Contact us at <strong>support@codelibrary.in</strong></p>
    </div>
  </div>

  <div class="actions-bar">
    <a href="/" class="btn btn-secondary">&larr; Back to CodeLibrary</a>
    <button onclick="window.print()" class="btn">🖨️ Print / Save as PDF</button>
  </div>

</body>
</html>`;

  res.send(html);
});

// GET /api/orders/:orderId/download/:bookId - Direct download proxy
router.get('/:orderId/download/:bookId', (req, res, next) => {
  req.url = `/${req.params.orderId}/${req.params.bookId}`;
  return require('./download')(req, res, next);
});

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = router;

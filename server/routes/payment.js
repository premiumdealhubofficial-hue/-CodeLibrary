const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const validator = require('validator');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/schema');
const config = require('../utils/config');

// Helper to check logged-in customer session
function getAuthenticatedUserFromCookie(req) {
  if (req.cookies && req.cookies.token) {
    try {
      return jwt.verify(req.cookies.token, config.JWT_SECRET);
    } catch (e) {
      return null;
    }
  }
  return null;
}

// Helper to validate coupon and calculate discount strictly server-side
function validateAndCalculateDiscount(db, couponCode, subtotal, customerId = null, customerEmail = null) {
  if (!couponCode || typeof couponCode !== 'string') {
    return { valid: false, error: 'Please enter a coupon code' };
  }

  const normalizedCode = couponCode.trim().toUpperCase();
  const coupon = db.prepare('SELECT * FROM coupons WHERE code = ?').get(normalizedCode);

  if (!coupon) {
    return { valid: false, error: 'Invalid coupon code' };
  }

  if (!coupon.is_active) {
    return { valid: false, error: 'This coupon code is currently inactive/disabled' };
  }

  const now = new Date();
  if (coupon.start_date && new Date(coupon.start_date) > now) {
    return { valid: false, error: 'This coupon is not yet active' };
  }

  if (coupon.expiry_date && new Date(coupon.expiry_date) < now) {
    return { valid: false, error: 'This coupon code has expired' };
  }

  if (coupon.usage_limit && coupon.used_count >= coupon.usage_limit) {
    return { valid: false, error: 'This coupon code has reached its global usage limit' };
  }

  if (coupon.min_order_amount && subtotal < coupon.min_order_amount) {
    const minRupees = (coupon.min_order_amount / 100).toFixed(0);
    return { valid: false, error: `Minimum order amount of ₹${minRupees} required to use this coupon` };
  }

  // Per customer limit check (by customerId or customerEmail)
  if (coupon.per_customer_limit) {
    let usageCount = 0;
    if (customerId) {
      usageCount = db.prepare('SELECT COUNT(*) as count FROM coupon_usages WHERE coupon_id = ? AND customer_id = ?').get(coupon.id, customerId).count;
    } else if (customerEmail) {
      const u = db.prepare('SELECT id FROM users WHERE email = ?').get(customerEmail.trim().toLowerCase());
      if (u) {
        usageCount = db.prepare('SELECT COUNT(*) as count FROM coupon_usages WHERE coupon_id = ? AND customer_id = ?').get(coupon.id, u.id).count;
      }
    }
    if (usageCount >= coupon.per_customer_limit) {
      return { valid: false, error: `This coupon code has already been used the maximum allowed times (${coupon.per_customer_limit})` };
    }
  }

  let discount = 0;
  if (coupon.discount_type === 'percentage') {
    discount = Math.round((subtotal * coupon.discount_value) / 100);
    if (coupon.max_discount_amount && discount > coupon.max_discount_amount) {
      discount = coupon.max_discount_amount;
    }
  } else {
    // Fixed amount discount in paise
    discount = Math.min(coupon.discount_value, subtotal);
  }

  const finalAmount = Math.max(0, subtotal - discount);

  return {
    valid: true,
    coupon,
    discount_amount: discount,
    subtotal,
    final_amount: finalAmount
  };
}

// POST /api/payment/validate-coupon - Customer coupon validation (No login required)
router.post('/validate-coupon', (req, res) => {
  const { code, coupon_code, items, product_type, product_id, email, customer_email, totalAmount, amount, subtotal: passedSubtotal } = req.body;
  const couponQueryCode = (code || coupon_code || '').trim();
  const db = getDb();
  let subtotal = 0;

  try {
    if (product_type === 'book') {
      const book = db.prepare('SELECT price FROM books WHERE (id = ? OR slug = ?) AND is_published = 1').get(product_id, product_id);
      if (book) subtotal = book.price;
    } else if (product_type === 'bundle') {
      const bundle = db.prepare('SELECT price FROM bundles WHERE (id = ? OR slug = ?) AND is_active = 1').get(product_id, product_id);
      if (bundle) subtotal = bundle.price;
    } else if (items && Array.isArray(items) && items.length > 0) {
      for (const item of items) {
        if (item.type === 'bundle') {
          const b = db.prepare("SELECT price FROM bundles WHERE (id = ? OR slug = ? OR ? = 'bundle') AND is_active = 1").get(item.id, item.id, item.id);
          if (b) subtotal += b.price;
          else if (item.price) subtotal += Number(item.price);
        } else {
          const bk = db.prepare('SELECT price FROM books WHERE (id = ? OR slug = ?) AND is_published = 1').get(item.id, item.id);
          if (bk) subtotal += bk.price;
          else if (item.price) subtotal += Number(item.price);
        }
      }
    } else if (passedSubtotal || totalAmount || amount) {
      subtotal = Number(passedSubtotal || totalAmount || amount);
    }

    if (subtotal <= 0) {
      return res.status(400).json({ valid: false, error: 'Cart is empty or invalid', message: 'Cart is empty or invalid' });
    }

    const checkEmail = (email || customer_email || '').trim();
    const result = validateAndCalculateDiscount(db, couponQueryCode, subtotal, null, checkEmail);

    if (!result.valid) {
      return res.json({ valid: false, success: false, error: result.error, message: result.error });
    }

    res.json({
      valid: true,
      success: true,
      code: result.coupon.code,
      discount_type: result.coupon.discount_type,
      discount_value: result.coupon.discount_value,
      discount_amount: result.discount_amount,
      subtotal: result.subtotal,
      final_amount: result.final_amount,
      coupon: {
        id: result.coupon.id,
        code: result.coupon.code,
        discount_type: result.coupon.discount_type,
        discount_value: result.coupon.discount_value,
        max_discount_amount: result.coupon.max_discount_amount
      }
    });
  } catch (err) {
    console.error('Coupon validation error:', err);
    res.status(500).json({ valid: false, error: 'Failed to validate coupon' });
  }
});

// Helper to resolve effective Razorpay credentials (DB settings override or Environment variables)
function getEffectiveRazorpayConfig(db) {
  let dbKeyId = null;
  let dbKeySecret = null;
  let dbWebhookSecret = null;

  if (db) {
    try {
      const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('razorpay_key_id', 'razorpay_key_secret', 'razorpay_webhook_secret', 'razorpay_live_key_id', 'razorpay_live_key_secret')").all();
      const map = {};
      rows.forEach(r => { map[r.key] = (r.value || '').trim(); });

      if (map.razorpay_live_key_id && map.razorpay_live_key_secret) {
        dbKeyId = map.razorpay_live_key_id;
        dbKeySecret = map.razorpay_live_key_secret;
      } else if (map.razorpay_key_id && map.razorpay_key_secret) {
        dbKeyId = map.razorpay_key_id;
        dbKeySecret = map.razorpay_key_secret;
      }
      dbWebhookSecret = map.razorpay_webhook_secret || null;
    } catch (e) {
      // Ignore DB error
    }
  }

  // If DB settings contain non-placeholder credentials, they take precedence
  if (dbKeyId && dbKeySecret && !dbKeyId.includes('xxxx') && !dbKeyId.includes('placeholder')) {
    const mode = dbKeyId.startsWith('rzp_live_') ? 'live' : (dbKeyId.startsWith('rzp_test_') ? 'test' : 'custom');
    return {
      keyId: dbKeyId,
      keySecret: dbKeySecret,
      webhookSecret: dbWebhookSecret || config.RAZORPAY_WEBHOOK_SECRET,
      mode,
      source: 'database',
      isConfigured: true
    };
  }

  // Otherwise use environment configuration
  const envKey = config.RAZORPAY_KEY_ID;
  const envSecret = config.RAZORPAY_KEY_SECRET;
  const isEnvConfigured = Boolean(
    envKey && 
    envSecret && 
    !envKey.includes('xxxx') && 
    !envKey.includes('placeholder') && 
    !envSecret.includes('your_razorpay')
  );
  const envMode = config.RAZORPAY_MODE || (envKey ? (envKey.startsWith('rzp_live_') ? 'live' : (envKey.startsWith('rzp_test_') ? 'test' : 'custom')) : 'not_configured');

  return {
    keyId: envKey || null,
    keySecret: envSecret || null,
    webhookSecret: config.RAZORPAY_WEBHOOK_SECRET || null,
    mode: envMode,
    source: 'environment',
    isConfigured: isEnvConfigured
  };
}

// POST /api/payment/create-order - Create payment order (No login required)
router.post('/create-order', async (req, res) => {
  const { product_type, product_id, items, coupon_code, couponCode, customer_name, customer_email, customer_phone, name, email, phone, customer } = req.body;
  const db = getDb();
  let subtotal = 0;
  let orderDescription = 'CodeLibrary Purchase';

  // Customer details extraction
  const cleanName = (customer_name || name || (customer && customer.name) || 'Customer').trim();
  const cleanEmail = (customer_email || email || (customer && customer.email) || '').trim().toLowerCase();
  const cleanPhone = (customer_phone || phone || (customer && customer.phone) || '').trim();
  const couponToApply = (coupon_code || couponCode || (customer && customer.coupon_code) || '').trim();

  if (cleanEmail && !validator.isEmail(cleanEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address' });
  }

  try {
    let resolvedItems = [];

    if (items && Array.isArray(items) && items.length > 0) {
      let calculatedAmount = 0;
      for (const item of items) {
        const itemType = (item.type || '').toLowerCase();
        const itemId = String(item.id || item.slug || '').trim();
        if (itemType === 'bundle' || item.is_bundle || itemId === 'bundle' || itemId === 'complete-programming-bundle') {
          const b = db.prepare("SELECT id, title, slug, price, books FROM bundles WHERE (id = ? OR slug = ? OR lower(slug) = lower(?) OR ? = 'bundle') AND is_active = 1").get(itemId, itemId, itemId, itemId);
          if (b) {
            calculatedAmount += b.price;
            resolvedItems.push({ id: b.id, title: b.title, slug: b.slug, price: b.price, type: 'bundle', books: b.books });
          } else if (item.price) {
            calculatedAmount += Number(item.price);
            resolvedItems.push({ id: item.id || 'bundle', title: item.title || 'Complete Programming Bundle', slug: item.slug || 'complete-programming-bundle', price: Number(item.price), type: 'bundle' });
          }
        } else {
          const bk = db.prepare('SELECT id, title, slug, price, cover_image, category FROM books WHERE (id = ? OR slug = ? OR lower(slug) = lower(?)) AND is_published = 1').get(itemId, itemId, itemId);
          if (bk) {
            calculatedAmount += bk.price;
            resolvedItems.push({ id: bk.id, title: bk.title, slug: bk.slug, price: bk.price, type: 'book', cover_image: bk.cover_image });
          } else {
            const fallbackBk = db.prepare('SELECT id, title, slug, price, cover_image, category FROM books WHERE (id = ? OR slug = ? OR lower(slug) = lower(?))').get(itemId, itemId, itemId);
            if (fallbackBk) {
              calculatedAmount += fallbackBk.price;
              resolvedItems.push({ id: fallbackBk.id, title: fallbackBk.title, slug: fallbackBk.slug, price: fallbackBk.price, type: 'book', cover_image: fallbackBk.cover_image });
            } else if (item.price) {
              calculatedAmount += Number(item.price);
              resolvedItems.push(item);
            }
          }
        }
      }
      subtotal = calculatedAmount;
      orderDescription = resolvedItems.length === 1 ? (resolvedItems[0].type === 'bundle' ? resolvedItems[0].title : `eBook: ${resolvedItems[0].title}`) : `CodeLibrary Cart (${resolvedItems.length} items)`;
    } else if (product_type === 'bundle' || product_id === 'bundle' || product_id === 'complete-programming-bundle') {
      const bundle = db.prepare("SELECT id, title, slug, price, books FROM bundles WHERE (id = ? OR slug = ? OR lower(slug) = lower(?) OR ? = 'bundle') AND is_active = 1").get(product_id, product_id, product_id, product_id);
      if (!bundle) return res.status(404).json({ error: 'Bundle not found or unavailable' });
      subtotal = bundle.price;
      orderDescription = bundle.title;
      resolvedItems.push({ id: bundle.id, title: bundle.title, slug: bundle.slug, price: bundle.price, type: 'bundle', books: bundle.books });
    } else if (product_type === 'book' || product_id) {
      const book = db.prepare('SELECT id, title, slug, price, cover_image, category FROM books WHERE (id = ? OR slug = ? OR lower(slug) = lower(?)) AND is_published = 1').get(product_id, product_id, product_id);
      if (!book) return res.status(404).json({ error: 'Book not found or unavailable' });
      subtotal = book.price;
      orderDescription = `eBook: ${book.title}`;
      resolvedItems.push({ id: book.id, title: book.title, slug: book.slug, price: book.price, type: 'book', cover_image: book.cover_image });
    } else {
      return res.status(400).json({ error: 'Invalid product specifications or empty cart' });
    }

    if (subtotal <= 0) {
      return res.status(400).json({ error: 'Invalid order amount' });
    }

    let finalAmount = subtotal;
    let discountAmount = 0;
    let appliedCouponCode = null;

    // Find or assign customer in users table for database referential integrity
    const loggedInUser = getAuthenticatedUserFromCookie(req);
    let customerId = null;

    if (loggedInUser && loggedInUser.id) {
      customerId = loggedInUser.id;
    } else {
      // Guest Checkout: Link to guest record or create one, never exposing password-protected account history
      const customerEmailToSave = cleanEmail || `guest_${Date.now()}_${Math.floor(Math.random() * 1000)}@guest.codelibrary.in`;
      const existingUser = db.prepare('SELECT id, name, password_hash FROM users WHERE email = ?').get(customerEmailToSave);
      
      if (existingUser && !existingUser.password_hash) {
        customerId = existingUser.id;
        if (cleanName && cleanName !== existingUser.name) {
          db.prepare('UPDATE users SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(cleanName, customerId);
        }
      } else if (!existingUser) {
        customerId = uuidv4();
        db.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)').run(
          customerId, cleanName || 'Customer', customerEmailToSave, null
        );
      } else {
        // Email belongs to a registered account with password, but checkout is unauthenticated (guest)
        // Assign a distinct guest customer ID to prevent unauthorized order linking
        customerId = uuidv4();
        const guestEmailAlias = `guest_${Date.now()}_${customerId.substring(0, 8)}@guest.codelibrary.in`;
        db.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)').run(
          customerId, cleanName || 'Customer', guestEmailAlias, null
        );
      }
    }

    // Validate and apply coupon if provided
    if (couponToApply) {
      const couponValidation = validateAndCalculateDiscount(db, couponToApply, subtotal, customerId, cleanEmail);
      if (!couponValidation.valid) {
        return res.status(400).json({ error: couponValidation.error });
      }
      finalAmount = couponValidation.final_amount;
      discountAmount = couponValidation.discount_amount;
      appliedCouponCode = couponValidation.coupon.code;
    }

    const order_id = uuidv4();
    const downloadToken = crypto.randomBytes(24).toString('hex');
    const finalProductId = product_id || (resolvedItems.length > 0 ? resolvedItems[0].id : 'cart');
    const finalProductType = product_type || (resolvedItems.length === 1 ? resolvedItems[0].type : 'cart');
    const itemsJson = JSON.stringify(resolvedItems);

    let rzp_order_id = `order_test_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const rzpConfig = getEffectiveRazorpayConfig(db);

    if (rzpConfig.isConfigured) {
      try {
        const Razorpay = require('razorpay');
        const rzp = new Razorpay({ key_id: rzpConfig.keyId, key_secret: rzpConfig.keySecret });
        const rzpOrder = await rzp.orders.create({
          amount: finalAmount,
          currency: 'INR',
          receipt: order_id.replace(/-/g, '').substring(0, 40),
          notes: {
            customer_name: cleanName || 'Customer',
            customer_email: cleanEmail || 'customer@example.com',
            customer_phone: cleanPhone || '',
            product_type: finalProductType,
            product_id: String(finalProductId),
            coupon_code: appliedCouponCode || 'none'
          }
        });
        if (rzpOrder && rzpOrder.id) {
          rzp_order_id = rzpOrder.id;
        } else {
          throw new Error('No order ID received from payment gateway');
        }
      } catch (rzpErr) {
        console.error('Razorpay order creation error:', rzpErr.error || rzpErr.message || rzpErr);
        const errMsg = (rzpErr.error && rzpErr.error.description) ? rzpErr.error.description : (rzpErr.message || 'Payment gateway initialization failed');
        return res.status(500).json({ error: errMsg });
      }
    }

    db.prepare(`
      INSERT INTO orders (id, customer_id, customer_name, customer_email, customer_phone, items_json, download_token, order_type, product_id, amount, status, razorpay_order_id, coupon_code, discount_amount, original_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
    `).run(order_id, customerId, cleanName, cleanEmail, cleanPhone, itemsJson, downloadToken, finalProductType, finalProductId, finalAmount, rzp_order_id, appliedCouponCode, discountAmount, subtotal);

    res.json({
      order_id,
      db_order_id: order_id,
      amount: finalAmount,
      subtotal,
      discount_amount: discountAmount,
      coupon_code: appliedCouponCode,
      currency: 'INR',
      description: orderDescription,
      customer_name: cleanName,
      customer_email: cleanEmail,
      customer_phone: cleanPhone,
      razorpay_key_id: rzpConfig.keyId || null,
      razorpay_order_id: rzp_order_id
    });
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ error: 'Failed to create payment order' });
  }
});

// GET /api/payment/config-status - Safe payment gateway diagnostics (No secrets exposed)
router.get('/config-status', (req, res) => {
  const db = getDb();
  const rzpConfig = getEffectiveRazorpayConfig(db);
  const detectedEnvVars = Object.keys(process.env).filter(k => (k.includes('RAZORPAY') || k.includes('RZP')) && !k.includes('NPM_'));

  res.json({
    mode: rzpConfig.mode,
    key_prefix: rzpConfig.keyId ? rzpConfig.keyId.substring(0, 8) + '...' : null,
    key_length: rzpConfig.keyId ? rzpConfig.keyId.length : 0,
    is_live_mode: rzpConfig.mode === 'live',
    is_test_mode: rzpConfig.mode === 'test',
    is_configured: rzpConfig.isConfigured,
    has_matching_secret: Boolean(rzpConfig.keySecret),
    source: rzpConfig.source,
    detected_env_vars: detectedEnvVars,
    environment: config.NODE_ENV
  });
});

// Helper to validate gateway payment entity properties
function validateGatewayPayment(payment, order, expectedRzpOrderId) {
  if (!payment || typeof payment !== 'object') {
    return { valid: false, error: 'Payment details could not be retrieved from payment gateway' };
  }
  // 1. Must be 'captured' - reject missing or non-captured status
  if (!payment.status || typeof payment.status !== 'string' || payment.status.trim() !== 'captured') {
    return {
      valid: false,
      error: `Payment is not completed (status: ${payment.status || 'missing'}). Only captured payments are accepted.`
    };
  }
  // 2. Exact Razorpay order ID match - reject missing or mismatched order_id
  if (!payment.order_id || typeof payment.order_id !== 'string' || payment.order_id.trim() !== expectedRzpOrderId) {
    return { valid: false, error: 'Razorpay order ID mismatch or missing on gateway' };
  }
  // 3. Exact amount equality (in paise) - reject missing or mismatched amount
  if (typeof payment.amount !== 'number' || payment.amount !== order.amount) {
    return { valid: false, error: 'Payment amount mismatch between gateway and order record' };
  }
  // 4. Expected currency INR - reject missing or non-INR currency
  if (!payment.currency || typeof payment.currency !== 'string' || payment.currency.trim().toUpperCase() !== 'INR') {
    return { valid: false, error: 'Invalid payment currency. Expected INR.' };
  }
  return { valid: true };
}

// POST /api/payment/verify - Verify payment and unlock download access (No login required)
router.post('/verify', async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, order_id, db_order_id } = req.body;
  const directOrderId = order_id || db_order_id;
  const db = getDb();
  
  // 1. Mandatory parameter validation: all Razorpay parameters required
  if (!razorpay_order_id || typeof razorpay_order_id !== 'string' || !razorpay_order_id.trim()) {
    return res.status(400).json({ success: false, error: 'Missing required parameter: razorpay_order_id' });
  }
  if (!razorpay_payment_id || typeof razorpay_payment_id !== 'string' || !razorpay_payment_id.trim()) {
    return res.status(400).json({ success: false, error: 'Missing required parameter: razorpay_payment_id' });
  }
  if (!razorpay_signature || typeof razorpay_signature !== 'string' || !razorpay_signature.trim()) {
    return res.status(400).json({ success: false, error: 'Missing required parameter: razorpay_signature' });
  }

  const cleanRzpOrderId = razorpay_order_id.trim();
  const cleanRzpPaymentId = razorpay_payment_id.trim();
  const cleanRzpSignature = razorpay_signature.trim();

  // 2. Fetch order record
  const order = db.prepare(`
    SELECT * FROM orders 
    WHERE razorpay_order_id = ? OR id = ?
  `).get(cleanRzpOrderId, directOrderId || '');

  if (!order) {
    return res.status(404).json({ success: false, error: 'Order record not found' });
  }

  if (order.razorpay_order_id && order.razorpay_order_id !== cleanRzpOrderId) {
    return res.status(400).json({ success: false, error: 'Payment order ID does not match order record' });
  }

  // 3. Guard against duplicate verification attaching a different payment ID to an already-paid order
  if (order.status === 'paid') {
    if (order.razorpay_payment_id && order.razorpay_payment_id !== cleanRzpPaymentId) {
      console.error(`[Payment Security] Duplicate verification rejected: payment ID mismatch on paid order ${order.id}`);
      return res.status(400).json({
        success: false,
        error: 'Order is already marked as paid with a different payment ID'
      });
    }
  }

  const rzpConfig = getEffectiveRazorpayConfig(db);
  const isProd = config.NODE_ENV === 'production';
  const isTestEnv = (process.env.NODE_ENV === 'test' || config.NODE_ENV === 'test') && !isProd;

  // 4. Cryptographic Signature Validation (Logs sanitized: no signatures exposed)
  if (rzpConfig.isConfigured && rzpConfig.keySecret) {
    const hmac = crypto.createHmac('sha256', rzpConfig.keySecret);
    hmac.update(`${cleanRzpOrderId}|${cleanRzpPaymentId}`);
    const expectedSignature = hmac.digest('hex');

    const sigBuf = Buffer.from(cleanRzpSignature, 'utf-8');
    const expBuf = Buffer.from(expectedSignature, 'utf-8');

    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      console.error(`[Payment Security] Signature mismatch for order ${order.id}`);
      return res.status(400).json({ success: false, error: 'Payment signature verification failed' });
    }

    // 5. Confirm Payment Status directly with Razorpay API (for real configured credentials)
    if (rzpConfig.keyId && rzpConfig.keySecret && !isTestEnv) {
      try {
        const Razorpay = require('razorpay');
        const rzp = new Razorpay({ key_id: rzpConfig.keyId, key_secret: rzpConfig.keySecret });
        const payment = await rzp.payments.fetch(cleanRzpPaymentId);

        const check = validateGatewayPayment(payment, order, cleanRzpOrderId);
        if (!check.valid) {
          console.error(`[Payment Security] Gateway validation failed for order ${order.id}: ${check.error}`);
          return res.status(400).json({ success: false, error: check.error });
        }
      } catch (apiErr) {
        console.error(`[Payment Security] Failed to verify payment with Razorpay API for order ${order.id}:`, apiErr.message || 'API error');
        const errMsg = (apiErr.error && apiErr.error.description) ? apiErr.error.description : (apiErr.message || 'Payment gateway verification error');
        return res.status(400).json({ success: false, error: 'Razorpay gateway verification error: ' + errMsg });
      }
    }
  } else if (isTestEnv) {
    // Isolated Test Fixture (Only accessible in test environment, NEVER in production)
    const testSecret = process.env.TEST_PAYMENT_SECRET || 'codelibrary_test_fixture_secret_2026';
    const hmac = crypto.createHmac('sha256', testSecret);
    hmac.update(`${cleanRzpOrderId}|${cleanRzpPaymentId}`);
    const expectedSignature = hmac.digest('hex');

    const sigBuf = Buffer.from(cleanRzpSignature, 'utf-8');
    const expBuf = Buffer.from(expectedSignature, 'utf-8');

    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      console.error(`[Payment Security] Test fixture signature mismatch for order ${order.id}`);
      return res.status(400).json({ success: false, error: 'Test fixture signature verification failed' });
    }

    // In test environment, if test gateway payment mock is provided, validate through the exact same logic
    if (req.body.test_gateway_payment) {
      const check = validateGatewayPayment(req.body.test_gateway_payment, order, cleanRzpOrderId);
      if (!check.valid) {
        return res.status(400).json({ success: false, error: check.error });
      }
    }
  } else {
    // Production without configured Razorpay credentials: Must reject immediately
    console.error('[Payment Security] Payment verification rejected: Razorpay credentials are not configured on server');
    return res.status(500).json({ success: false, error: 'Payment gateway is not properly configured on server' });
  }

  // 6. Update Order to Paid (Strict transaction: idempotent, prevents duplicate coupon usage and conflicting payment IDs)
  try {
    db.exec('BEGIN IMMEDIATE;');
    try {
      const freshOrder = db.prepare('SELECT status, razorpay_payment_id FROM orders WHERE id = ?').get(order.id);
      if (!freshOrder) {
        throw new Error('Order record not found');
      }

      if (freshOrder.status === 'paid') {
        if (freshOrder.razorpay_payment_id && freshOrder.razorpay_payment_id !== cleanRzpPaymentId) {
          const err = new Error('Order is already marked as paid with a different payment ID');
          err.statusCode = 400;
          throw err;
        }
        // Already paid with identical payment ID - idempotent replay
        db.exec('COMMIT;');
      } else {
        db.prepare(`
          UPDATE orders 
          SET status = 'paid', razorpay_payment_id = ?, razorpay_signature = ?, updated_at = CURRENT_TIMESTAMP 
          WHERE id = ? AND status != 'paid'
        `).run(cleanRzpPaymentId, cleanRzpSignature, order.id);

        // Record coupon usage strictly once inside transaction
        if (order.coupon_code) {
          const coupon = db.prepare('SELECT id FROM coupons WHERE code = ?').get(order.coupon_code);
          if (coupon) {
            db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(coupon.id);
            db.prepare('INSERT OR IGNORE INTO coupon_usages (id, coupon_id, customer_id, order_id, discount_amount) VALUES (?, ?, ?, ?, ?)').run(
              uuidv4(), coupon.id, order.customer_id || 'guest', order.id, order.discount_amount || 0
            );
          }
        }
        db.exec('COMMIT;');
      }
    } catch (innerErr) {
      try { db.exec('ROLLBACK;'); } catch (rbErr) {}
      throw innerErr;
    }
  } catch (txErr) {
    if (txErr.statusCode === 400 || txErr.message.includes('different payment ID')) {
      console.error(`[Payment Security] Verification conflict on order ${order.id}`);
      return res.status(400).json({ success: false, error: txErr.message });
    }
    console.error(`[Payment Security] Database error updating order ${order.id}:`, txErr.message || txErr);
    return res.status(500).json({ success: false, error: 'Database error processing order' });
  }

  // If user is currently logged in, associate order with their account
  const loggedInUser = getAuthenticatedUserFromCookie(req);
  const effectiveCustomerId = (loggedInUser && loggedInUser.id) ? loggedInUser.id : (order.customer_id || 'guest');
  if (loggedInUser && loggedInUser.id && order.customer_id !== loggedInUser.id) {
    db.prepare('UPDATE orders SET customer_id = ? WHERE id = ?').run(loggedInUser.id, order.id);
  }

  // Resolve purchased items and grant download access
  let purchasedProducts = [];
  let rawItems = [];
  try {
    rawItems = order.items_json ? JSON.parse(order.items_json) : [];
  } catch (e) {
    rawItems = [];
  }

  if (order.order_type === 'book') {
    const book = db.prepare('SELECT id, title, slug, category, price, cover_image, google_drive_url FROM books WHERE id = ? OR slug = ?').get(order.product_id, order.product_id);
    if (book) {
      db.prepare('INSERT OR IGNORE INTO download_access (id, customer_id, book_id, order_id) VALUES (?, ?, ?, ?)').run(
        uuidv4(), effectiveCustomerId, book.id, order.id
      );
      purchasedProducts.push({
        id: book.id,
        title: book.title,
        slug: book.slug,
        category: book.category,
        price: book.price,
        cover_image: book.cover_image,
        google_drive_url: book.google_drive_url || null,
        type: 'book',
        download_url: `/api/orders/${order.id}/download/${book.id}?token=${order.download_token}`
      });
    }
  } else if (order.order_type === 'bundle') {
    const bundle = db.prepare("SELECT id, title, slug, price, books FROM bundles WHERE (id = ? OR slug = ? OR ? = 'bundle')").get(order.product_id, order.product_id, order.product_id);
    if (bundle) {
      const bookIds = JSON.parse(bundle.books || '[]');
      const stmt = db.prepare('INSERT OR IGNORE INTO download_access (id, customer_id, book_id, order_id) VALUES (?, ?, ?, ?)');
      for (const bid of bookIds) {
        const book = db.prepare('SELECT id, title, slug, category, price, cover_image, google_drive_url FROM books WHERE id = ? OR slug = ?').get(bid, bid);
        if (book) {
          stmt.run(uuidv4(), effectiveCustomerId, book.id, order.id);
          purchasedProducts.push({
            id: book.id,
            title: book.title,
            slug: book.slug,
            category: book.category,
            price: book.price,
            cover_image: book.cover_image,
            google_drive_url: book.google_drive_url || null,
            type: 'book',
            download_url: `/api/orders/${order.id}/download/${book.id}?token=${order.download_token}`
          });
        }
      }
    }
  } else if (rawItems.length > 0) {
    // Process items stored in cart order
    for (const item of rawItems) {
      if (item.type === 'bundle') {
        const bundle = db.prepare("SELECT id, title, slug, price, books FROM bundles WHERE (id = ? OR slug = ? OR ? = 'bundle')").get(item.id, item.id, item.id);
        if (bundle) {
          const bookIds = JSON.parse(bundle.books || '[]');
          const stmt = db.prepare('INSERT OR IGNORE INTO download_access (id, customer_id, book_id, order_id) VALUES (?, ?, ?, ?)');
          for (const bid of bookIds) {
            const book = db.prepare('SELECT id, title, slug, category, price, cover_image, google_drive_url FROM books WHERE id = ? OR slug = ?').get(bid, bid);
            if (book) {
              stmt.run(uuidv4(), effectiveCustomerId, book.id, order.id);
              if (!purchasedProducts.some(p => p.id === book.id)) {
                purchasedProducts.push({
                  id: book.id,
                  title: book.title,
                  slug: book.slug,
                  category: book.category,
                  price: book.price,
                  cover_image: book.cover_image,
                  google_drive_url: book.google_drive_url || null,
                  type: 'book',
                  download_url: `/api/orders/${order.id}/download/${book.id}?token=${order.download_token}`
                });
              }
            }
          }
        }
      } else {
        const book = db.prepare('SELECT id, title, slug, category, price, cover_image, google_drive_url FROM books WHERE id = ? OR slug = ?').get(item.id, item.id || item.slug);
        if (book) {
          db.prepare('INSERT OR IGNORE INTO download_access (id, customer_id, book_id, order_id) VALUES (?, ?, ?, ?)').run(
            uuidv4(), effectiveCustomerId, book.id, order.id
          );
          if (!purchasedProducts.some(p => p.id === book.id)) {
            purchasedProducts.push({
              id: book.id,
              title: book.title,
              slug: book.slug,
              category: book.category,
              price: book.price,
              cover_image: book.cover_image,
              google_drive_url: book.google_drive_url || null,
              type: 'book',
              download_url: `/api/orders/${order.id}/download/${book.id}?token=${order.download_token}`
            });
          }
        }
      }
    }
  }

  res.json({
    success: true,
    message: 'Payment successfully verified. Order completed!',
    order_id: order.id,
    download_token: order.download_token,
    customer_name: order.customer_name || 'Valued Customer',
    customer_email: order.customer_email || '',
    customer_phone: order.customer_phone || '',
    amount: order.amount,
    subtotal: order.original_amount || order.amount,
    discount_amount: order.discount_amount || 0,
    coupon_code: order.coupon_code || null,
    created_at: order.created_at,
    items: purchasedProducts,
    invoice_url: `/api/orders/${order.id}/invoice?token=${order.download_token}`
  });
});

// Razorpay Webhook
router.post('/webhook', (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  if (config.RAZORPAY_WEBHOOK_SECRET && !config.RAZORPAY_WEBHOOK_SECRET.includes('your_webhook')) {
    const hmac = crypto.createHmac('sha256', config.RAZORPAY_WEBHOOK_SECRET);
    hmac.update(req.body);
    if (hmac.digest('hex') !== signature) {
      return res.status(400).send('Invalid webhook signature');
    }
  }

  try {
    const event = JSON.parse(req.body.toString());
    const db = getDb();

    if (event.event === 'payment.captured') {
      const paymentEntity = event.payload.payment.entity;
      const rzp_order_id = paymentEntity.order_id;
      const rzp_payment_id = paymentEntity.id;
      
      const order = db.prepare('SELECT id, customer_id, order_type, product_id, coupon_code, discount_amount, items_json FROM orders WHERE razorpay_order_id = ?').get(rzp_order_id);
      if (order && order.status !== 'paid') {
        db.prepare('UPDATE orders SET status = "paid", razorpay_payment_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(rzp_payment_id, order.id);
        
        if (order.coupon_code) {
          const coupon = db.prepare('SELECT id FROM coupons WHERE code = ?').get(order.coupon_code);
          if (coupon) {
            db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(coupon.id);
            db.prepare('INSERT OR IGNORE INTO coupon_usages (id, coupon_id, customer_id, order_id, discount_amount) VALUES (?, ?, ?, ?, ?)').run(
              uuidv4(), coupon.id, order.customer_id || 'guest', order.id, order.discount_amount || 0
            );
          }
        }
        
        if (order.order_type === 'book') {
          const book = db.prepare('SELECT id FROM books WHERE id = ? OR slug = ?').get(order.product_id, order.product_id);
          if (book) {
            db.prepare('INSERT OR IGNORE INTO download_access (id, customer_id, book_id, order_id) VALUES (?, ?, ?, ?)')
              .run(uuidv4(), order.customer_id || 'guest', book.id, order.id);
          }
        } else if (order.order_type === 'bundle') {
          const bundle = db.prepare("SELECT books FROM bundles WHERE (id = ? OR slug = ? OR ? = 'bundle') AND is_active = 1").get(order.product_id, order.product_id, order.product_id);
          if (bundle) {
            const bookIds = JSON.parse(bundle.books || '[]');
            const stmt = db.prepare('INSERT OR IGNORE INTO download_access (id, customer_id, book_id, order_id) VALUES (?, ?, ?, ?)');
            for (const bid of bookIds) {
              const book = db.prepare('SELECT id FROM books WHERE id = ? OR slug = ?').get(bid, bid);
              if (book) {
                stmt.run(uuidv4(), order.customer_id || 'guest', book.id, order.id);
              }
            }
          }
        }
      }
    } else if (event.event === 'payment.failed') {
      const paymentEntity = event.payload.payment.entity;
      const rzp_order_id = paymentEntity.order_id;
      db.prepare('UPDATE orders SET status = "failed", updated_at = CURRENT_TIMESTAMP WHERE razorpay_order_id = ?').run(rzp_order_id);
    }
    
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Webhook processing error' });
  }
});

module.exports = router;

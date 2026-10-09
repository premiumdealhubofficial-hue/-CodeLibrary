const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const validator = require('validator');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/schema');
const config = require('../utils/config');

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

    // Find or create customer in users table for database referential integrity
    let customerId = uuidv4();
    const customerEmailToSave = cleanEmail || `guest_${Date.now()}_${Math.floor(Math.random() * 1000)}@guest.codelibrary.in`;
    const existingUser = db.prepare('SELECT id, name FROM users WHERE email = ?').get(customerEmailToSave);
    if (existingUser) {
      customerId = existingUser.id;
      if (cleanName && cleanName !== existingUser.name) {
        db.prepare('UPDATE users SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(cleanName, customerId);
      }
    } else {
      db.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)').run(
        customerId, cleanName || 'Customer', customerEmailToSave, null
      );
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
    const isRazorpayConfigured = config.RAZORPAY_KEY_ID && 
                                 config.RAZORPAY_KEY_SECRET && 
                                 !config.RAZORPAY_KEY_ID.includes('xxxx') && 
                                 !config.RAZORPAY_KEY_ID.includes('placeholder') && 
                                 !config.RAZORPAY_KEY_SECRET.includes('your_razorpay');

    if (isRazorpayConfigured) {
      try {
        const Razorpay = require('razorpay');
        const rzp = new Razorpay({ key_id: config.RAZORPAY_KEY_ID, key_secret: config.RAZORPAY_KEY_SECRET });
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
      razorpay_key_id: config.RAZORPAY_KEY_ID || null,
      razorpay_order_id: rzp_order_id
    });
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ error: 'Failed to create payment order' });
  }
});

// GET /api/payment/config-status - Safe payment gateway diagnostics (No secrets exposed)
router.get('/config-status', (req, res) => {
  const keyId = config.RAZORPAY_KEY_ID || '';
  const hasSecret = Boolean(config.RAZORPAY_KEY_SECRET && !config.RAZORPAY_KEY_SECRET.includes('your_razorpay') && !config.RAZORPAY_KEY_SECRET.includes('placeholder'));
  let mode = 'not_configured';
  if (keyId.startsWith('rzp_live_')) {
    mode = 'live';
  } else if (keyId.startsWith('rzp_test_')) {
    mode = 'test';
  } else if (keyId) {
    mode = 'custom';
  }

  const isConfigured = Boolean(
    keyId && 
    hasSecret && 
    !keyId.includes('xxxx') && 
    !keyId.includes('placeholder')
  );

  res.json({
    mode,
    key_prefix: keyId ? keyId.substring(0, 8) + '...' : null,
    is_live_mode: mode === 'live',
    is_test_mode: mode === 'test',
    is_configured: isConfigured,
    has_matching_secret: hasSecret,
    environment: config.NODE_ENV
  });
});

// POST /api/payment/verify - Verify payment and unlock download access (No login required)
router.post('/verify', (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, order_id, db_order_id } = req.body;
  const directOrderId = order_id || db_order_id;
  const db = getDb();
  
  if (!razorpay_order_id && !directOrderId) {
    return res.status(400).json({ success: false, error: 'Missing order details for verification' });
  }

  const order = db.prepare(`
    SELECT * FROM orders 
    WHERE razorpay_order_id = ? OR id = ?
  `).get(razorpay_order_id || '', directOrderId || '');

  if (!order) {
    return res.status(404).json({ success: false, error: 'Order record not found' });
  }

  const isRazorpayConfigured = config.RAZORPAY_KEY_ID && 
                               config.RAZORPAY_KEY_SECRET && 
                               !config.RAZORPAY_KEY_ID.includes('xxxx') && 
                               !config.RAZORPAY_KEY_ID.includes('placeholder') && 
                               !config.RAZORPAY_KEY_SECRET.includes('your_razorpay');

  // Cryptographic signature check when real secret is configured
  if (isRazorpayConfigured) {
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, error: 'Missing payment signature verification parameters' });
    }
    const hmac = crypto.createHmac('sha256', config.RAZORPAY_KEY_SECRET);
    hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    const expectedSignature = hmac.digest('hex');
    if (expectedSignature !== razorpay_signature) {
      console.error(`Signature mismatch for order ${order.id}: expected ${expectedSignature}, received ${razorpay_signature}`);
      return res.status(400).json({ success: false, error: 'Payment signature verification failed' });
    }
  }

  const paymentId = razorpay_payment_id || `pay_${Date.now()}`;
  const signature = razorpay_signature || 'verified_server_test';

  db.prepare(`
    UPDATE orders 
    SET status = 'paid', razorpay_payment_id = ?, razorpay_signature = ?, updated_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `).run(paymentId, signature, order.id);

  // Record coupon usage if applied
  if (order.coupon_code) {
    const coupon = db.prepare('SELECT id FROM coupons WHERE code = ?').get(order.coupon_code);
    if (coupon) {
      db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(coupon.id);
      db.prepare('INSERT OR IGNORE INTO coupon_usages (id, coupon_id, customer_id, order_id, discount_amount) VALUES (?, ?, ?, ?, ?)').run(
        uuidv4(), coupon.id, order.customer_id || 'guest', order.id, order.discount_amount || 0
      );
    }
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
    const book = db.prepare('SELECT id, title, slug, category, price, cover_image FROM books WHERE id = ? OR slug = ?').get(order.product_id, order.product_id);
    if (book) {
      db.prepare('INSERT OR IGNORE INTO download_access (id, customer_id, book_id, order_id) VALUES (?, ?, ?, ?)').run(
        uuidv4(), order.customer_id || 'guest', book.id, order.id
      );
      purchasedProducts.push({
        id: book.id,
        title: book.title,
        slug: book.slug,
        category: book.category,
        price: book.price,
        cover_image: book.cover_image,
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
        const book = db.prepare('SELECT id, title, slug, category, price, cover_image FROM books WHERE id = ? OR slug = ?').get(bid, bid);
        if (book) {
          stmt.run(uuidv4(), order.customer_id || 'guest', book.id, order.id);
          purchasedProducts.push({
            id: book.id,
            title: book.title,
            slug: book.slug,
            category: book.category,
            price: book.price,
            cover_image: book.cover_image,
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
            const book = db.prepare('SELECT id, title, slug, category, price, cover_image FROM books WHERE id = ? OR slug = ?').get(bid, bid);
            if (book) {
              stmt.run(uuidv4(), order.customer_id || 'guest', book.id, order.id);
              if (!purchasedProducts.some(p => p.id === book.id)) {
                purchasedProducts.push({
                  id: book.id,
                  title: book.title,
                  slug: book.slug,
                  category: book.category,
                  price: book.price,
                  cover_image: book.cover_image,
                  type: 'book',
                  download_url: `/api/orders/${order.id}/download/${book.id}?token=${order.download_token}`
                });
              }
            }
          }
        }
      } else {
        const book = db.prepare('SELECT id, title, slug, category, price, cover_image FROM books WHERE id = ? OR slug = ?').get(item.id, item.id || item.slug);
        if (book) {
          db.prepare('INSERT OR IGNORE INTO download_access (id, customer_id, book_id, order_id) VALUES (?, ?, ?, ?)').run(
            uuidv4(), order.customer_id || 'guest', book.id, order.id
          );
          if (!purchasedProducts.some(p => p.id === book.id)) {
            purchasedProducts.push({
              id: book.id,
              title: book.title,
              slug: book.slug,
              category: book.category,
              price: book.price,
              cover_image: book.cover_image,
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

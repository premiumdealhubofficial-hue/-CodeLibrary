const { DatabaseSync } = require('node:sqlite');
const config = require('../utils/config');
const path = require('path');
const fs = require('fs');

let dbInstance = null;

function getDbPath() {
  return path.isAbsolute(config.DB_PATH) 
    ? config.DB_PATH 
    : path.join(__dirname, '..', '..', config.DB_PATH);
}

function getDb() {
  if (dbInstance) return dbInstance;
  
  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  dbInstance = new DatabaseSync(dbPath);
  
  // Production durability and concurrency pragmas
  dbInstance.exec('PRAGMA foreign_keys = ON;');
  dbInstance.exec('PRAGMA journal_mode = WAL;');
  dbInstance.exec('PRAGMA synchronous = NORMAL;');
  dbInstance.exec('PRAGMA busy_timeout = 5000;');

  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      password_hash TEXT,
      name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admins (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      username TEXT UNIQUE,
      password_hash TEXT,
      totp_secret TEXT,
      totp_enabled INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT,
      slug TEXT UNIQUE,
      price INTEGER,
      description TEXT,
      short_description TEXT,
      what_you_learn TEXT,
      topics TEXT,
      category TEXT,
      cover_image TEXT,
      rating REAL DEFAULT 4.8,
      is_published INTEGER DEFAULT 1,
      ebook_filename TEXT,
      google_drive_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bundles (
      id TEXT PRIMARY KEY,
      title TEXT,
      slug TEXT UNIQUE,
      description TEXT,
      price INTEGER,
      books TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      order_type TEXT,
      product_id TEXT,
      amount INTEGER,
      status TEXT DEFAULT 'pending',
      razorpay_order_id TEXT,
      razorpay_payment_id TEXT,
      razorpay_signature TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS download_access (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      book_id TEXT,
      order_id TEXT,
      granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES users(id),
      FOREIGN KEY (book_id) REFERENCES books(id),
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS contact_messages (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT,
      message TEXT,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      admin_id TEXT,
      action TEXT,
      entity TEXT,
      entity_id TEXT,
      details TEXT,
      ip TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_id) REFERENCES admins(id)
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      name TEXT,
      rating INTEGER,
      review TEXT,
      is_published INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS coupons (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE,
      discount_type TEXT DEFAULT 'percentage',
      discount_value INTEGER NOT NULL,
      min_order_amount INTEGER DEFAULT 0,
      max_discount_amount INTEGER,
      start_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      expiry_date DATETIME,
      usage_limit INTEGER,
      per_customer_limit INTEGER DEFAULT 1,
      used_count INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS coupon_usages (
      id TEXT PRIMARY KEY,
      coupon_id TEXT,
      customer_id TEXT,
      order_id TEXT,
      discount_amount INTEGER NOT NULL,
      used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (coupon_id) REFERENCES coupons(id),
      FOREIGN KEY (customer_id) REFERENCES users(id),
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_books_slug ON books(slug);
    CREATE INDEX IF NOT EXISTS idx_books_category ON books(category);
    CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
    CREATE INDEX IF NOT EXISTS idx_download_access_customer ON download_access(customer_id);
    CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
    CREATE INDEX IF NOT EXISTS idx_coupon_usages_coupon ON coupon_usages(coupon_id);
    CREATE INDEX IF NOT EXISTS idx_coupon_usages_customer ON coupon_usages(customer_id);
  `);

  // Default Settings Seed for Contact & Social Media
  try {
    const defaultSettings = {
      contact_phone: '+91 7808202338',
      contact_whatsapp: '+91 7808202338',
      whatsapp_message: 'Hello CodeLibrary Support, I need help with my eBook/order.',
      support_email: 'support@codelibrary.in',
      business_email: 'contact@codelibrary.in',
      contact_address: 'India',
      social_whatsapp_enabled: '1',
      social_whatsapp_url: 'https://wa.me/917808202338',
      social_instagram_enabled: '1',
      social_instagram_url: 'https://instagram.com/codelibrary',
      social_facebook_enabled: '1',
      social_facebook_url: 'https://facebook.com/codelibrary',
      social_youtube_enabled: '1',
      social_youtube_url: 'https://youtube.com/@codelibrary',
      social_twitter_enabled: '1',
      social_twitter_url: 'https://x.com/codelibrary',
      social_telegram_enabled: '1',
      social_telegram_url: 'https://t.me/codelibrary',
      social_linkedin_enabled: '1',
      social_linkedin_url: 'https://linkedin.com/company/codelibrary',
      social_pinterest_enabled: '0',
      social_pinterest_url: '',
      social_discord_enabled: '0',
      social_discord_url: ''
    };

    const insertSetting = dbInstance.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    for (const [key, val] of Object.entries(defaultSettings)) {
      insertSetting.run(key, val);
    }
  } catch (e) {
    // Settings seed notice
  }

  // Safe column migrations for orders and books tables
  try {
    const tableInfo = dbInstance.prepare("PRAGMA table_info(orders)").all();
    const colNames = tableInfo.map(c => c.name);
    if (!colNames.includes('coupon_code')) {
      dbInstance.exec("ALTER TABLE orders ADD COLUMN coupon_code TEXT;");
    }
    if (!colNames.includes('discount_amount')) {
      dbInstance.exec("ALTER TABLE orders ADD COLUMN discount_amount INTEGER DEFAULT 0;");
    }
    if (!colNames.includes('original_amount')) {
      dbInstance.exec("ALTER TABLE orders ADD COLUMN original_amount INTEGER;");
    }
    if (!colNames.includes('customer_name')) {
      dbInstance.exec("ALTER TABLE orders ADD COLUMN customer_name TEXT;");
    }
    if (!colNames.includes('customer_email')) {
      dbInstance.exec("ALTER TABLE orders ADD COLUMN customer_email TEXT;");
    }
    if (!colNames.includes('customer_phone')) {
      dbInstance.exec("ALTER TABLE orders ADD COLUMN customer_phone TEXT;");
    }
    if (!colNames.includes('items_json')) {
      dbInstance.exec("ALTER TABLE orders ADD COLUMN items_json TEXT;");
    }
    if (!colNames.includes('download_token')) {
      dbInstance.exec("ALTER TABLE orders ADD COLUMN download_token TEXT;");
    }

    const booksTableInfo = dbInstance.prepare("PRAGMA table_info(books)").all();
    const booksColNames = booksTableInfo.map(c => c.name);
    if (!booksColNames.includes('google_drive_url')) {
      dbInstance.exec("ALTER TABLE books ADD COLUMN google_drive_url TEXT;");
    }
  } catch (e) {
    // Columns may already exist
  }

  // Safe automated initialization of catalog on fresh deployment (Render/Docker/VPS)
  try {
    const publishedCount = dbInstance.prepare("SELECT COUNT(*) as count FROM books WHERE is_published = 1").get().count;
    if (publishedCount < 19) {
      const { seedDatabase } = require('./seed');
      seedDatabase(dbInstance);
    }
  } catch (err) {
    console.error('Database auto-initialization notice:', err.message);
  }

  return dbInstance;
}

module.exports = { getDb, getDbPath };


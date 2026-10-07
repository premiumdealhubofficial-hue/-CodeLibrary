require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  TRUST_PROXY: process.env.TRUST_PROXY === 'true' || process.env.NODE_ENV === 'production',
  BASE_URL: process.env.BASE_URL || 'http://localhost:3000',
  DB_PATH: process.env.DB_PATH || 'database.sqlite',
  JWT_SECRET: process.env.JWT_SECRET || 'your_super_secret_key_change_in_prod',
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET,
  EBOOK_STORAGE_PATH: process.env.EBOOK_STORAGE_PATH || './ebooks',
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'admin@codelibrary.in',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'Admin@CodeLib2024!',
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  BACKUP_DIR: process.env.BACKUP_DIR || 'backups',
  BACKUP_RETENTION_COUNT: parseInt(process.env.BACKUP_RETENTION_COUNT, 10) || 30
};

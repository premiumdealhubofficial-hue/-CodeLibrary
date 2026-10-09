require('dotenv').config();

function sanitizeEnv(val) {
  if (!val || typeof val !== 'string') return val;
  return val.trim().replace(/^["']|["']$/g, '').trim();
}

module.exports = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: sanitizeEnv(process.env.NODE_ENV) || 'development',
  TRUST_PROXY: process.env.TRUST_PROXY === 'true' || process.env.NODE_ENV === 'production',
  BASE_URL: sanitizeEnv(process.env.BASE_URL) || 'http://localhost:3000',
  DB_PATH: sanitizeEnv(process.env.DB_PATH) || 'database.sqlite',
  JWT_SECRET: sanitizeEnv(process.env.JWT_SECRET) || 'your_super_secret_key_change_in_prod',
  RAZORPAY_KEY_ID: sanitizeEnv(process.env.RAZORPAY_KEY_ID) || null,
  RAZORPAY_KEY_SECRET: sanitizeEnv(process.env.RAZORPAY_KEY_SECRET) || null,
  RAZORPAY_WEBHOOK_SECRET: sanitizeEnv(process.env.RAZORPAY_WEBHOOK_SECRET) || null,
  EBOOK_STORAGE_PATH: sanitizeEnv(process.env.EBOOK_STORAGE_PATH) || './ebooks',
  ADMIN_EMAIL: sanitizeEnv(process.env.ADMIN_EMAIL) || 'admin@codelibrary.in',
  ADMIN_PASSWORD: sanitizeEnv(process.env.ADMIN_PASSWORD) || 'Admin@CodeLib2024!',
  ADMIN_USERNAME: sanitizeEnv(process.env.ADMIN_USERNAME) || 'admin',
  BACKUP_DIR: sanitizeEnv(process.env.BACKUP_DIR) || 'backups',
  BACKUP_RETENTION_COUNT: parseInt(process.env.BACKUP_RETENTION_COUNT, 10) || 30
};


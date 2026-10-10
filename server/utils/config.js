require('dotenv').config();

function sanitizeEnv(val) {
  if (!val || typeof val !== 'string') return val;
  return val.trim().replace(/^["']|["']$/g, '').trim();
}

function resolveRazorpayCredentials() {
  const env = process.env;
  const isProd = (sanitizeEnv(env.NODE_ENV) || 'development') === 'production';
  const explicitMode = sanitizeEnv(env.RAZORPAY_MODE || env.PAYMENT_MODE || '').toLowerCase();

  // Potential Live credentials
  const liveKeyId = sanitizeEnv(env.RAZORPAY_LIVE_KEY_ID || env.RZP_LIVE_KEY_ID || (env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_ID.startsWith('rzp_live_') ? env.RAZORPAY_KEY_ID : null));
  const liveKeySecret = sanitizeEnv(env.RAZORPAY_LIVE_KEY_SECRET || env.RAZORPAY_LIVE_SECRET || env.RZP_LIVE_KEY_SECRET || (liveKeyId && env.RAZORPAY_KEY_SECRET ? env.RAZORPAY_KEY_SECRET : null));

  // Potential Test credentials
  const testKeyId = sanitizeEnv(env.RAZORPAY_TEST_KEY_ID || env.RZP_TEST_KEY_ID || (env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_ID.startsWith('rzp_test_') ? env.RAZORPAY_KEY_ID : null));
  const testKeySecret = sanitizeEnv(env.RAZORPAY_TEST_KEY_SECRET || env.RAZORPAY_TEST_SECRET || env.RZP_TEST_KEY_SECRET || (testKeyId && env.RAZORPAY_KEY_SECRET ? env.RAZORPAY_KEY_SECRET : null));

  // Generic / Default
  const genericKeyId = sanitizeEnv(env.RAZORPAY_KEY_ID || env.RAZORPAY_KEY || env.RZP_KEY_ID);
  const genericKeySecret = sanitizeEnv(env.RAZORPAY_KEY_SECRET || env.RAZORPAY_SECRET || env.RZP_KEY_SECRET);

  let keyId = null;
  let keySecret = null;
  let mode = 'none';

  if (liveKeyId && liveKeySecret && (explicitMode === 'live' || explicitMode !== 'test')) {
    keyId = liveKeyId;
    keySecret = liveKeySecret;
    mode = 'live';
  } else if (explicitMode === 'test' && testKeyId && testKeySecret) {
    keyId = testKeyId;
    keySecret = testKeySecret;
    mode = 'test';
  } else if (genericKeyId && genericKeySecret) {
    keyId = genericKeyId;
    keySecret = genericKeySecret;
    mode = genericKeyId.startsWith('rzp_live_') ? 'live' : (genericKeyId.startsWith('rzp_test_') ? 'test' : 'custom');
  } else if (liveKeyId) {
    keyId = liveKeyId;
    keySecret = liveKeySecret || genericKeySecret;
    mode = 'live';
  } else if (testKeyId) {
    keyId = testKeyId;
    keySecret = testKeySecret || genericKeySecret;
    mode = 'test';
  } else if (genericKeyId) {
    keyId = genericKeyId;
    keySecret = genericKeySecret;
    mode = genericKeyId.startsWith('rzp_live_') ? 'live' : (genericKeyId.startsWith('rzp_test_') ? 'test' : 'custom');
  }

  return {
    keyId: keyId || null,
    keySecret: keySecret || null,
    mode,
    webhookSecret: sanitizeEnv(env.RAZORPAY_WEBHOOK_SECRET || env.RZP_WEBHOOK_SECRET) || null
  };
}

const rzpCreds = resolveRazorpayCredentials();

function sanitizeSmtpPass(val) {
  if (!val || typeof val !== 'string') return '';
  let clean = sanitizeEnv(val);
  if (/^[a-zA-Z0-9]{4}\s+[a-zA-Z0-9]{4}\s+[a-zA-Z0-9]{4}\s+[a-zA-Z0-9]{4}$/.test(clean.trim())) {
    clean = clean.replace(/\s+/g, '');
  }
  return clean;
}

module.exports = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: sanitizeEnv(process.env.NODE_ENV) || 'development',
  TRUST_PROXY: process.env.TRUST_PROXY === 'true' || process.env.NODE_ENV === 'production',
  BASE_URL: sanitizeEnv(process.env.BASE_URL) || 'http://localhost:3000',
  DB_PATH: sanitizeEnv(process.env.DB_PATH) || 'database.sqlite',
  JWT_SECRET: sanitizeEnv(process.env.JWT_SECRET) || 'your_super_secret_key_change_in_prod',
  RAZORPAY_KEY_ID: rzpCreds.keyId,
  RAZORPAY_KEY_SECRET: rzpCreds.keySecret,
  RAZORPAY_MODE: rzpCreds.mode,
  RAZORPAY_WEBHOOK_SECRET: rzpCreds.webhookSecret,
  EBOOK_STORAGE_PATH: sanitizeEnv(process.env.EBOOK_STORAGE_PATH) || './ebooks',
  ADMIN_EMAIL: sanitizeEnv(process.env.ADMIN_EMAIL) || 'admin@codelibrary.in',
  ADMIN_PASSWORD: sanitizeEnv(process.env.ADMIN_PASSWORD) || 'Admin@CodeLib2024!',
  ADMIN_USERNAME: sanitizeEnv(process.env.ADMIN_USERNAME) || 'admin',
  SMTP_HOST: sanitizeEnv(process.env.SMTP_HOST) || 'smtp.gmail.com',
  SMTP_PORT: parseInt(process.env.SMTP_PORT, 10) || 587,
  SMTP_SECURE: process.env.SMTP_SECURE !== undefined 
    ? process.env.SMTP_SECURE === 'true' 
    : (parseInt(process.env.SMTP_PORT, 10) === 465),
  SMTP_USER: sanitizeEnv(process.env.SMTP_USER) || '',
  SMTP_PASS: sanitizeSmtpPass(process.env.SMTP_PASS),
  SMTP_FROM: sanitizeEnv(process.env.SMTP_FROM) || (sanitizeEnv(process.env.SMTP_USER) ? `CodeLibrary <${sanitizeEnv(process.env.SMTP_USER)}>` : 'CodeLibrary Security <no-reply@codelibrary.in>'),
  RESEND_API_KEY: sanitizeEnv(process.env.RESEND_API_KEY) || '',
  BREVO_API_KEY: sanitizeEnv(process.env.BREVO_API_KEY) || '',
  SENDGRID_API_KEY: sanitizeEnv(process.env.SENDGRID_API_KEY) || '',
  BACKUP_DIR: sanitizeEnv(process.env.BACKUP_DIR) || 'backups',
  BACKUP_RETENTION_COUNT: parseInt(process.env.BACKUP_RETENTION_COUNT, 10) || 30
};


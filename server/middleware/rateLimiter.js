const rateLimit = require('express-rate-limit');

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  message: { error: 'Too many requests, please try again later.' }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many login attempts, please try again later.' }
});

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin login attempts from this IP. Please try again after 15 minutes.' }
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  message: { error: 'Too many API requests, please try again later.' }
});

const otpSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many OTP requests from this IP. Please wait 15 minutes before requesting again.' }
});

const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many OTP verification attempts from this IP. Please wait 15 minutes.' }
});

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many contact submissions, please try again later.' }
});

module.exports = { generalLimiter, loginLimiter, adminLoginLimiter, otpSendLimiter, otpVerifyLimiter, apiLimiter, contactLimiter };


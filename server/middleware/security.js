const helmet = require('helmet');
const cors = require('cors');

module.exports = function applySecurity(app) {
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'", 
          "'unsafe-inline'", 
          "'unsafe-eval'", 
          "https://checkout.razorpay.com", 
          "https://cdn.razorpay.com", 
          "https://cdn.jsdelivr.net", 
          "https://cdnjs.cloudflare.com", 
          "https://api.razorpay.com"
        ],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        connectSrc: ["'self'", "https://api.razorpay.com", "https://lumberjack.razorpay.com", "https://cdn.razorpay.com"],
        frameSrc: ["'self'", "https://api.razorpay.com", "https://checkout.razorpay.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false
  }));

  app.use(cors({
    origin: true,
    credentials: true
  }));

  // Sensitive file blocker (prevents direct downloading of databases, env files, backups)
  app.use((req, res, next) => {
    const rawUrl = req.url.split('?')[0].toLowerCase();
    const sensitivePatterns = [
      /\.(sqlite|sqlite3|db|db3|sqlite-wal|sqlite-shm|sqlite-journal)$/i,
      /\.(env|env\..*)$/i,
      /\.(bak|backup|old|orig|save)$/i,
      /\.(log|git|svn|sh|bash|yml|yaml)$/i,
      /(^|\/)\.env/i,
      /(^|\/)database\.sqlite/i,
      /(^|\/)backups\//i
    ];

    for (const pattern of sensitivePatterns) {
      if (pattern.test(rawUrl)) {
        // Exclude authenticated admin backup download endpoint
        if (req.url.startsWith('/api/admin/backups/download/')) {
          return next();
        }
        return res.status(403).json({ error: 'Access denied' });
      }
    }
    next();
  });

  app.use((req, res, next) => {
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
};

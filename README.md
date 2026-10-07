# CodeLibrary - Programming eBook Store & Digital Delivery Platform

A production-ready eCommerce website and digital delivery platform for programming eBooks, curated tech guides, and developer bundles.

## ✨ Features

- **⚡ Fast, Modern Frontend**: Clean UI with dark/light themes, dynamic book showcase, search, category filters, and interactive book modals.
- **🛒 Frictionless Guest Checkout**: Seamless customer checkout flow without mandatory account creation or password hurdles. Customers enter Name, Email, and Mobile Number to purchase instantly.
- **💳 Razorpay Payment Integration**: Full server-side order generation and cryptographic HMAC-SHA256 signature verification.
- **🔒 Secure Tokenized Digital Delivery**: Google Drive PDF links and digital files are completely protected on the backend. Downloads and printable HTML invoices are served via time-limited, cryptographically verified tokens.
- **🛡️ Secure Admin Control Panel**: Complete management interface for Books, Orders, Revenue Analytics, Promo Codes/Coupons, 2FA/TOTP Two-Factor Authentication, and Audit Logs.
- **💬 Dynamic WhatsApp Support & Social Links**: Configurable WhatsApp customer helpline with pre-filled support message and admin toggles for all major social media channels.
- **💾 SQLite WAL Mode & Zero-Downtime Backups**: Embedded database with Write-Ahead Logging for high concurrent throughput, crash recovery, and atomic `VACUUM INTO` live backups.

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js**: v18.0.0 or higher
- **npm**: v8.0.0 or higher

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/premiumdealhubofficial-hue/CodeLibrary.git
cd CodeLibrary

# Install dependencies
npm install --omit=dev
```

### 3. Environment Configuration
```bash
# Copy sample environment configuration
cp .env.example .env
```
Edit `.env` with your preferred configuration:
- `PORT`: Application port (default: 3000)
- `JWT_SECRET`: Random 64+ character secret string
- `RAZORPAY_KEY_ID`: Your Razorpay Key ID
- `RAZORPAY_KEY_SECRET`: Your Razorpay Secret Key
- `ADMIN_PASSWORD`: Your desired Admin Panel password

### 4. Database Initialization & Start
```bash
# Seed initial book catalog, default coupons & admin user
npm run seed

# Start the production server
npm start
```

Access the store at `http://localhost:3000` and Admin Panel at `http://localhost:3000/admin.html`.

---

## 🛠️ Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: SQLite3 (`better-sqlite3`) in WAL mode
- **Security**: Helmet, Express Rate Limit, Cookie Parser, JSON Web Tokens (JWT), OTPAuth (2FA)
- **Payment Gateway**: Razorpay Node SDK
- **Frontend**: Vanilla HTML5, CSS3, Modern JavaScript (ES6+), FontAwesome icons

---

## 📜 License
ISC License

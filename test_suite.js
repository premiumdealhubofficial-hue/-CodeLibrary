const http = require('http');
const path = require('path');
const fs = require('fs');

async function runTests() {
  console.log('=== STARTING CODELIBRARY E2E INTEGRATION TESTS ===\n');
  
  // Start server
  const config = require('./server/utils/config');
  const { getDb } = require('./server/db/schema');
  const { seed } = require('./server/db/seed');
  
  await seed();
  const db = getDb();

  // Test 1: Verify all 19 books in DB
  console.log('--- Test 1: Verify 19 Books & Bundle in DB ---');
  const books = db.prepare('SELECT id, title, slug, price, category, is_published FROM books WHERE is_published = 1').all();
  console.log(`Found ${books.length} published books in DB (Expected: 19)`);
  if (books.length !== 19) throw new Error(`Expected 19 books, got ${books.length}`);

  const expectedPrices = {
    'html-css': 9900,
    'c-programming': 9900,
    'cpp-programming': 14900,
    'java-programming': 9900,
    'javascript': 14900,
    'nodejs': 9900,
    'python-programming': 14900,
    'numpy': 9900,
    'pandas': 9900,
    'generative-ai': 14900,
    'sql': 14900,
    'dbms': 14900,
    'dsa': 9900,
    'operating-system': 9900,
    'computer-network': 9900,
    'computer-architecture': 9900,
    'excel': 9900,
    'android-development': 9900,
    'reactjs': 9900
  };

  for (const [slug, expectedPrice] of Object.entries(expectedPrices)) {
    const b = books.find(item => item.slug === slug);
    if (!b) throw new Error(`Missing book slug: ${slug}`);
    if (b.price !== expectedPrice) throw new Error(`Price mismatch for ${slug}: expected ${expectedPrice}, got ${b.price}`);
  }
  console.log('✔ All 19 book slugs and prices match exact specification!');

  // Test 2: Bundle verification
  const bundle = db.prepare('SELECT * FROM bundles WHERE slug = ?').get('complete-programming-bundle');
  if (!bundle) throw new Error('Missing Complete Programming Bundle');
  if (bundle.price !== 39900) throw new Error(`Bundle price expected 39900, got ${bundle.price}`);
  const bundleBookIds = JSON.parse(bundle.books);
  if (bundleBookIds.length !== 19) throw new Error(`Bundle should contain 19 books, got ${bundleBookIds.length}`);
  console.log('✔ Complete Programming Bundle contains all 19 books at ₹399 (39900 paise)');

  // Start HTTP Server on test port 3001
  const app = require('./server/index');
  // index.js listens on config.PORT, let's test via HTTP fetch
  const baseUrl = `http://localhost:${config.PORT}`;
  console.log(`\nTesting HTTP API at ${baseUrl}...`);

  // Wait 1s for server listen
  await new Promise(r => setTimeout(r, 1000));

  // Helper fetch with cookie jar
  let userCookie = '';
  let adminCookie = '';

  async function request(urlPath, options = {}) {
    const url = `${baseUrl}${urlPath}`;
    const headers = options.headers || {};
    if (options.useUserCookie && userCookie) headers['Cookie'] = userCookie;
    if (options.useAdminCookie && adminCookie) headers['Cookie'] = adminCookie;
    if (options.body && typeof options.body !== 'string') {
      options.body = JSON.stringify(options.body);
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, { ...options, headers });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      if (setCookie.includes('token=')) userCookie = setCookie.split(';')[0];
      if (setCookie.includes('admin_token=')) adminCookie = setCookie.split(';')[0];
    }

    const text = await res.text();
    let json = {};
    try { json = JSON.parse(text); } catch (e) { json = { text }; }
    return { status: res.status, ok: res.ok, data: json, headers: res.headers };
  }

  // Test 3: Public Catalog Endpoints
  console.log('\n--- Test 3: Public Catalog Endpoints ---');
  const resBooks = await request('/api/books');
  console.log(`GET /api/books: status ${resBooks.status}, count: ${resBooks.data.length}`);
  if (resBooks.status !== 200 || resBooks.data.length !== 19) throw new Error('GET /api/books failed');

  const resSingleBook = await request('/api/books/reactjs');
  console.log(`GET /api/books/reactjs: status ${resSingleBook.status}, title: "${resSingleBook.data.title}"`);
  if (resSingleBook.status !== 200 || !resSingleBook.data.what_you_learn) throw new Error('GET /api/books/reactjs failed');

  const resBundle = await request('/api/bundles/complete-programming-bundle');
  console.log(`GET /api/bundles/complete-programming-bundle: status ${resBundle.status}, books: ${resBundle.data.bookDetails?.length}`);
  if (resBundle.status !== 200 || resBundle.data.bookDetails.length !== 19) throw new Error('GET /api/bundles failed');

  const resReviews = await request('/api/reviews');
  console.log(`GET /api/reviews: status ${resReviews.status}, count: ${resReviews.data.length}`);
  if (resReviews.status !== 200 || resReviews.data.length === 0) throw new Error('GET /api/reviews failed');
  console.log('✔ Public catalog routes passed');

  // Test 4: User Registration & Auth
  console.log('\n--- Test 4: User Registration & Login ---');
  const testUserEmail = `coder_${Date.now()}@example.com`;
  const resReg = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Test Developer', email: testUserEmail, password: 'StrongPassword123!' }
  });
  console.log(`POST /api/auth/register: status ${resReg.status}, user: ${resReg.data.user?.email}`);
  if (resReg.status !== 201) throw new Error('Register failed: ' + JSON.stringify(resReg.data));

  const resMe = await request('/api/auth/me', { useUserCookie: true });
  console.log(`GET /api/auth/me: status ${resMe.status}, user: ${resMe.data.name}`);
  if (resMe.status !== 200 || resMe.data.email !== testUserEmail) throw new Error('Auth /me failed');
  console.log('✔ User auth & JWT cookie passed');

  // Test 5: Order Creation, Payment Verification, and Access Grant
  console.log('\n--- Test 5: Checkout & Download Access Flow ---');
  const pythonBook = books.find(b => b.slug === 'python-programming');
  
  const resOrder = await request('/api/payment/create-order', {
    method: 'POST',
    useUserCookie: true,
    body: { product_type: 'book', product_id: pythonBook.id }
  });
  console.log(`POST /api/payment/create-order: status ${resOrder.status}, amount: ${resOrder.data.amount}, rzp_order: ${resOrder.data.razorpay_order_id}`);
  if (resOrder.status !== 200 || !resOrder.data.razorpay_order_id) throw new Error('Create order failed');

  // Verify payment
  const resVerify = await request('/api/payment/verify', {
    method: 'POST',
    useUserCookie: true,
    body: {
      razorpay_order_id: resOrder.data.razorpay_order_id,
      razorpay_payment_id: `pay_test_${Date.now()}`,
      razorpay_signature: 'test_signature_valid'
    }
  });
  console.log(`POST /api/payment/verify: status ${resVerify.status}, result: ${resVerify.data.message}`);
  if (resVerify.status !== 200 || !resVerify.data.success) throw new Error('Payment verification failed');

  // Check My Books
  const resMyBooks = await request('/api/my-books', { useUserCookie: true });
  console.log(`GET /api/my-books: status ${resMyBooks.status}, count: ${resMyBooks.data.length}, first title: "${resMyBooks.data[0]?.title}"`);
  if (resMyBooks.status !== 200 || resMyBooks.data.length !== 1 || resMyBooks.data[0].id !== pythonBook.id) {
    throw new Error('My books verification failed');
  }

  // Generate Download Token
  const resDownload = await request(`/api/download/${pythonBook.id}`, { useUserCookie: true });
  console.log(`GET /api/download/:bookId: status ${resDownload.status}, download_url: ${resDownload.data.download_url}`);
  if (resDownload.status !== 200 || !resDownload.data.download_url) throw new Error('Download URL generation failed');

  // Stream actual PDF file
  const resStream = await request(resDownload.data.download_url);
  console.log(`GET ${resDownload.data.download_url}: status ${resStream.status}`);
  if (resStream.status !== 200) throw new Error('File download failed');
  console.log('✔ Paid order verification & secure PDF streaming passed');

  // Test 6: Security - Unauthorized Download Block
  console.log('\n--- Test 6: Security - Unauthorized Access Prevention ---');
  const dsaBook = books.find(b => b.slug === 'dsa');
  const resUnauthDownload = await request(`/api/download/${dsaBook.id}`, { useUserCookie: true });
  console.log(`GET /api/download/dsa (unpurchased): status ${resUnauthDownload.status} (Expected 403)`);
  if (resUnauthDownload.status !== 403) throw new Error('Unauthorized book was not blocked!');
  console.log('✔ Unauthorized eBook downloads correctly blocked with 403 Forbidden');

  // Test 7: Bundle Purchase Unlocks All 19 Books
  console.log('\n--- Test 7: Bundle Purchase Flow ---');
  const bundleUserEmail = `bundle_buyer_${Date.now()}@example.com`;
  userCookie = ''; // Reset cookie
  await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Bundle Master', email: bundleUserEmail, password: 'Password123!' }
  });

  const resBundleOrder = await request('/api/payment/create-order', {
    method: 'POST',
    useUserCookie: true,
    body: { product_type: 'bundle', product_id: bundle.id }
  });
  if (resBundleOrder.status !== 200) throw new Error('Bundle order creation failed');

  await request('/api/payment/verify', {
    method: 'POST',
    useUserCookie: true,
    body: {
      razorpay_order_id: resBundleOrder.data.razorpay_order_id,
      razorpay_payment_id: `pay_bundle_${Date.now()}`,
      razorpay_signature: 'test_bundle_valid'
    }
  });

  const resBundleMyBooks = await request('/api/my-books', { useUserCookie: true });
  console.log(`Bundle buyer library count: ${resBundleMyBooks.data.length} (Expected 19)`);
  if (resBundleMyBooks.data.length !== 19) throw new Error('Bundle did not grant access to all 19 books!');
  console.log('✔ Complete Bundle purchase unlocked all 19 eBooks!');

  // Test 8: Contact Form Submission
  console.log('\n--- Test 8: Contact Message Submission ---');
  const resContact = await request('/api/contact', {
    method: 'POST',
    body: { name: 'Alice Student', email: 'alice@test.com', message: 'I love the Python eBook!' }
  });
  console.log(`POST /api/contact: status ${resContact.status}, message: "${resContact.data.message}"`);
  if (resContact.status !== 200) throw new Error('Contact submission failed');
  console.log('✔ Contact form submission passed');

  // Test 9: Admin Authentication & Dashboard
  console.log('\n--- Test 9: Admin Panel Auth & Dashboard Metrics ---');
  const resAdminLogin = await request('/api/admin/login', {
    method: 'POST',
    body: { email: config.ADMIN_EMAIL, password: config.ADMIN_PASSWORD }
  });
  console.log(`POST /api/admin/login: status ${resAdminLogin.status}, admin: ${resAdminLogin.data.admin?.email}`);
  if (resAdminLogin.status !== 200) throw new Error('Admin login failed');

  const resAdminDash = await request('/api/admin/dashboard', { useAdminCookie: true });
  console.log(`GET /api/admin/dashboard: status ${resAdminDash.status}, revenue: ₹${resAdminDash.data.revenue / 100}, total_orders: ${resAdminDash.data.total_orders}, bundle_sales: ${resAdminDash.data.bundle_sales}`);
  if (resAdminDash.status !== 200 || resAdminDash.data.total_orders < 2) throw new Error('Admin dashboard metrics failed');
  console.log('✔ Admin dashboard metrics and recent orders passed');

  // Test 10: Admin Book & Bundle CRUD
  console.log('\n--- Test 10: Admin Book & Bundle Management ---');
  const resAdminBooks = await request('/api/admin/books', { useAdminCookie: true });
  console.log(`GET /api/admin/books: count ${resAdminBooks.data.length}`);
  if (resAdminBooks.status !== 200 || resAdminBooks.data.length !== 19) throw new Error('Admin books list failed');

  const resAdminBundles = await request('/api/admin/bundles', { useAdminCookie: true });
  console.log(`GET /api/admin/bundles: status ${resAdminBundles.status}, bundles count ${resAdminBundles.data.length}`);
  if (resAdminBundles.status !== 200 || resAdminBundles.data.length === 0) throw new Error('Admin bundles list failed');

  const resAdminOrders = await request('/api/admin/orders', { useAdminCookie: true });
  console.log(`GET /api/admin/orders: count ${resAdminOrders.data.length}`);
  if (resAdminOrders.status !== 200 || resAdminOrders.data.length < 2) throw new Error('Admin orders list failed');

  const resAdminCustomers = await request('/api/admin/customers', { useAdminCookie: true });
  console.log(`GET /api/admin/customers: count ${resAdminCustomers.data.length}`);
  if (resAdminCustomers.status !== 200 || resAdminCustomers.data.length < 2) throw new Error('Admin customers list failed');

  const resAdminAudit = await request('/api/admin/audit-logs', { useAdminCookie: true });
  console.log(`GET /api/admin/audit-logs: count ${resAdminAudit.data.length}`);
  if (resAdminAudit.status !== 200 || resAdminAudit.data.length === 0) throw new Error('Admin audit logs failed');
  console.log('✔ Admin CRUD, Customer, Orders, and Audit log routes passed');

  console.log('\n======================================================');
  console.log('🎉 ALL 10 E2E INTEGRATION TEST SUITES PASSED (100%)');
  console.log('======================================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});

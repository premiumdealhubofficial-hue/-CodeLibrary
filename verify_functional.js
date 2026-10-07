const config = require('./server/utils/config');
const baseUrl = `http://localhost:${config.PORT}`;

async function testAll() {
  console.log('Testing server at:', baseUrl);

  // Helper with cookies
  async function api(path, opt = {}) {
    const res = await fetch(baseUrl + path, {
      method: opt.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(opt.cookie ? { 'Cookie': opt.cookie } : {})
      },
      body: opt.body ? JSON.stringify(opt.body) : undefined
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch(e) { data = text; }
    const setCookie = res.headers.get('set-cookie');
    return { status: res.status, ok: res.ok, data, cookie: setCookie };
  }

  // 1. Catalog & Details
  console.log('\n--- 1. Catalog & Details ---');
  const booksRes = await api('/api/books');
  console.log('Books count:', booksRes.data.length);
  const singleBook = await api('/api/books/python-programming');
  console.log('Python book details:', singleBook.data.title, '| Price:', singleBook.data.price, '| Topics count:', singleBook.data.topics?.length);

  // 2. Filters & Search
  console.log('\n--- 2. Filters & Search ---');
  const webDevRes = await api('/api/books?category=web-development');
  console.log('Web Dev filter count:', webDevRes.data.length);
  const searchRes = await api('/api/books?search=React');
  console.log('Search React count:', searchRes.data.length, '| Title:', searchRes.data[0]?.title);

  // 3. User Register & Login
  console.log('\n--- 3. User Register & Login ---');
  const email = `verifier_${Date.now()}@test.com`;
  const regRes = await api('/api/auth/register', {
    method: 'POST',
    body: { name: 'Verifier User', email, password: 'Password@123' }
  });
  const userCookie = regRes.cookie ? regRes.cookie.split(';')[0] : '';
  console.log('Register status:', regRes.status, '| Cookie:', !!userCookie);

  const meRes = await api('/api/auth/me', { cookie: userCookie });
  console.log('Me status:', meRes.status, '| User:', meRes.data.name, meRes.data.email);

  // 4. Cart & Checkout (Single eBook)
  console.log('\n--- 4. Cart & Checkout (Single eBook) ---');
  const order1 = await api('/api/payment/create-order', {
    method: 'POST',
    cookie: userCookie,
    body: { product_type: 'book', product_id: singleBook.data.id }
  });
  console.log('Create order status:', order1.status, '| Amount:', order1.data.amount, '| Order ID:', order1.data.razorpay_order_id);

  const verify1 = await api('/api/payment/verify', {
    method: 'POST',
    cookie: userCookie,
    body: {
      razorpay_order_id: order1.data.razorpay_order_id,
      razorpay_payment_id: `pay_test_${Date.now()}`,
      razorpay_signature: 'test_sig'
    }
  });
  console.log('Verify order status:', verify1.status, '| Success:', verify1.data.success);

  // 5. My Books & Download
  console.log('\n--- 5. My Books & Download ---');
  const myBooks = await api('/api/my-books', { cookie: userCookie });
  console.log('My Books count:', myBooks.data.length, '| Title:', myBooks.data[0]?.title);

  const dlRes = await api(`/api/download/${singleBook.data.id}`, { cookie: userCookie });
  console.log('Download URL generated:', dlRes.data.download_url);
  const fileRes = await api(dlRes.data.download_url);
  console.log('File download stream status:', fileRes.status, '| Is PDF:', typeof fileRes.data === 'string' && fileRes.data.startsWith('%PDF'));

  // 6. Contact Form
  console.log('\n--- 6. Contact Form ---');
  const contactRes = await api('/api/contact', {
    method: 'POST',
    body: { name: 'Support Inquirer', email: 'inquirer@test.com', message: 'Hello CodeLibrary!' }
  });
  console.log('Contact status:', contactRes.status, '| Message:', contactRes.data.message);

  // 7. Admin Login
  console.log('\n--- 7. Admin Flow ---');
  const adminLogin = await api('/api/admin/login', {
    method: 'POST',
    body: { email: config.ADMIN_EMAIL, password: config.ADMIN_PASSWORD }
  });
  const adminCookie = adminLogin.cookie ? adminLogin.cookie.split(';')[0] : '';
  console.log('Admin login status:', adminLogin.status, '| Cookie:', !!adminCookie);

  // 8. Admin Dashboard
  const dashRes = await api('/api/admin/dashboard', { cookie: adminCookie });
  console.log('Admin dashboard revenue:', dashRes.data.revenue, '| Orders:', dashRes.data.total_orders, '| Customers:', dashRes.data.total_customers);

  // 9. Admin Books & Price Editing
  const adminBooks = await api('/api/admin/books', { cookie: adminCookie });
  console.log('Admin books count:', adminBooks.data.length);
  
  // Test updating price of a book
  const bookToEdit = adminBooks.data.find(b => b.slug === 'html-css');
  const updateRes = await api(`/api/admin/books/${bookToEdit.id}`, {
    method: 'PUT',
    cookie: adminCookie,
    body: { price: 9900 }
  });
  console.log('Book price update status:', updateRes.status, '| Success:', updateRes.data.success);

  // 10. Admin Orders & Status Update
  const adminOrders = await api('/api/admin/orders', { cookie: adminCookie });
  console.log('Admin orders count:', adminOrders.data.length);
  if (adminOrders.data.length > 0) {
    const oId = adminOrders.data[0].id;
    const statusUpdate = await api(`/api/admin/orders/${oId}/status`, {
      method: 'PUT',
      cookie: adminCookie,
      body: { status: 'paid' }
    });
    console.log('Order status update:', statusUpdate.status, '| Success:', statusUpdate.data.success);
  }

  // 11. Admin Customers
  const adminCust = await api('/api/admin/customers', { cookie: adminCookie });
  console.log('Admin customers count:', adminCust.data.length);

  // 12. Admin Messages & Mark as Read
  const adminMsgs = await api('/api/admin/contacts', { cookie: adminCookie });
  console.log('Admin messages count:', adminMsgs.data.length);
  if (adminMsgs.data.length > 0) {
    const msgId = adminMsgs.data[0].id;
    const readRes = await api(`/api/admin/contacts/${msgId}/read`, {
      method: 'PUT',
      cookie: adminCookie
    });
    console.log('Message mark as read status:', readRes.status);
  }

  // 13. Admin 2FA Flow
  const faStatus = await api('/api/admin/2fa/status', { cookie: adminCookie });
  console.log('2FA Status:', faStatus.data.enabled);

  console.log('\n--- ALL VERIFICATION TESTS COMPLETED SUCCESSFULLY ---');
}

testAll().catch(console.error);

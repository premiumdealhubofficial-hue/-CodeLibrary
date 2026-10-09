const adminState = {
  admin: null,
  currentSection: 'dashboard',
  dashboard: { stats: null, recentOrders: [], chartData: null },
  books: [],
  bundles: [],
  orders: [],
  customers: [],
  coupons: [],
  couponStats: null,
  contacts: [],
  auditLogs: [],
  salesChartInstance: null
};

// Formatting Utilities
const formatCurrency = (paise) => {
  if (paise == null || isNaN(paise)) return '₹0';
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
};

const formatDate = (isoString) => {
  if (!isoString) return 'N/A';
  try {
    return new Date(isoString).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch (e) {
    return isoString;
  }
};

const showAdminToast = (message, type = 'info') => {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i> <span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
};

const escapeHtml = (str) => {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

// API Wrapper with Dual Cookie & Bearer Token Authentication
const adminApi = async (path, options = {}) => {
  const token = localStorage.getItem('admin_token');
  const defaultOptions = {
    headers: { 
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    },
    credentials: 'same-origin'
  };
  
  if (options.body && typeof options.body !== 'string') {
    options.body = JSON.stringify(options.body);
  }
  
  const merged = { ...defaultOptions, ...options };
  merged.headers = { ...defaultOptions.headers, ...options.headers };

  try {
    const response = await fetch(path, merged);
    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
      if (path === '/api/admin/login') {
        const loginErr = new Error(data.error || 'Invalid admin credentials');
        loginErr.require_2fa = !!data.require_2fa;
        throw loginErr;
      }
      localStorage.removeItem('admin_token');
      showLoginScreen();
      throw new Error(data.error || 'Session expired or unauthorized');
    }

    if (!response.ok) {
      const err = new Error(data.error || `HTTP Error ${response.status}`);
      err.require_2fa = !!data.require_2fa;
      throw err;
    }
    return data;
  } catch (error) {
    if (path !== '/api/admin/me') {
      console.error('Admin API Error:', error);
    }
    throw error;
  }
};

// Auth Checking
const checkAdminAuth = async () => {
  try {
    const admin = await adminApi('/api/admin/me');
    adminState.admin = admin;
    showDashboard();
  } catch (error) {
    showLoginScreen();
  }
};

const handleLogin = async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const totp = document.getElementById('login-totp').value.trim();
  const errorEl = document.getElementById('login-error');
  const btn = document.getElementById('btn-admin-login');
  
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Authenticating...';
  errorEl.innerText = '';
  
  try {
    const res = await adminApi('/api/admin/login', {
      method: 'POST',
      body: { email, password, totp_code: totp }
    });
    
    if (res.token) {
      localStorage.setItem('admin_token', res.token);
    }
    adminState.admin = res.admin;
    showDashboard();
    showAdminToast('Welcome to CodeLibrary Admin Panel', 'success');
  } catch (err) {
    if (err.require_2fa || (err.message && (err.message.includes('Two-factor') || err.message.includes('2FA')))) {
      document.getElementById('totp-field').style.display = 'block';
      document.getElementById('login-totp').focus();
    }
    errorEl.innerText = err.message || 'Login failed';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>Sign In to Dashboard</span> <i class="fas fa-arrow-right"></i>';
  }
};

const handleLogout = async () => {
  try {
    await adminApi('/api/admin/logout', { method: 'POST' });
  } catch (e) {
    // Ignored
  }
  localStorage.removeItem('admin_token');
  adminState.admin = null;
  showLoginScreen();
  showAdminToast('Logged out securely', 'info');
};

const showLoginScreen = () => {
  document.getElementById('admin-dashboard').style.display = 'none';
  document.getElementById('admin-login').style.display = 'flex';
};

const showDashboard = () => {
  document.getElementById('admin-login').style.display = 'none';
  document.getElementById('admin-dashboard').style.display = 'flex';
  document.getElementById('admin-name').innerText = adminState.admin?.username || adminState.admin?.email || 'Admin';
  switchSection(adminState.currentSection || 'dashboard');
};

// Navigation
const switchSection = (sectionId) => {
  adminState.currentSection = sectionId;
  
  document.querySelectorAll('#sidebar-nav a').forEach(a => {
    a.classList.toggle('active', a.dataset.section === sectionId);
  });
  
  const titleMap = {
    dashboard: 'Dashboard Overview',
    books: 'Manage eBooks (19 Catalog Titles)',
    bundles: 'Manage Bundles',
    orders: 'Customer Orders',
    customers: 'Registered Customers',
    coupons: 'Discount & Coupon Codes',
    contacts: 'Support Messages',
    audit: 'Security Audit Log',
    settings: 'Admin Settings & Security'
  };
  
  document.getElementById('page-title').innerText = titleMap[sectionId] || 'Dashboard';
  
  document.querySelectorAll('.content-section').forEach(sec => {
    sec.style.display = 'none';
  });
  
  const targetSec = document.getElementById(`section-${sectionId}`);
  if (targetSec) targetSec.style.display = 'block';
  
  document.getElementById('sidebar').classList.remove('open');
  loadSectionData(sectionId);
};

const loadSectionData = (sectionId) => {
  switch (sectionId) {
    case 'dashboard': loadDashboard(); break;
    case 'books': loadBooks(); break;
    case 'bundles': loadBundles(); break;
    case 'orders': loadOrders(); break;
    case 'customers': loadCustomers(); break;
    case 'coupons': loadCoupons(); break;
    case 'contacts': loadContacts(); break;
    case 'audit': loadAuditLogs(); break;
    case 'settings': loadSettings(); break;
  }
};

// Dashboard
const loadDashboard = async () => {
  try {
    const data = await adminApi('/api/admin/dashboard');
    adminState.dashboard = data;
    
    renderStats(data.stats || {
      totalSales: data.revenue || 0,
      totalOrders: data.total_orders || 0,
      totalCustomers: data.total_customers || 0,
      ebooksSold: data.total_ebooks_sold || 0,
      bundleSales: data.bundle_sales || 0,
      monthlyRevenue: data.monthly_revenue || 0
    });
    
    renderRecentOrders(data.recentOrders || []);

    // Populate month options in chart dropdown if present
    const chartSelect = document.getElementById('chart-timeframe');
    if (chartSelect && data.availableMonths && data.availableMonths.length > 0) {
      // Keep static timeframe options and append available months if not present
      const existingVals = Array.from(chartSelect.options).map(o => o.value);
      data.availableMonths.forEach(m => {
        if (!existingVals.includes(m.month_val)) {
          const opt = document.createElement('option');
          opt.value = m.month_val;
          opt.textContent = `Month: ${m.month_name || m.month_val}`;
          chartSelect.appendChild(opt);
        }
      });
    }

    if (data.chartData) {
      renderSalesChart(data.chartData);
    }
  } catch (e) {
    showAdminToast('Failed to load dashboard metrics', 'error');
  }
};

const renderStats = (stats) => {
  document.getElementById('stat-total-sales').innerText = formatCurrency(stats.totalSales);
  document.getElementById('stat-total-orders').innerText = stats.totalOrders || 0;
  document.getElementById('stat-total-customers').innerText = stats.totalCustomers || 0;
  document.getElementById('stat-ebooks-sold').innerText = stats.ebooksSold || 0;
  document.getElementById('stat-bundle-sales').innerText = stats.bundleSales || 0;
  document.getElementById('stat-monthly-revenue').innerText = formatCurrency(stats.monthlyRevenue);
};

const renderRecentOrders = (orders) => {
  const tbody = document.querySelector('#recent-orders-table tbody');
  if (!tbody) return;
  
  if (orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-secondary">No orders recorded yet.</td></tr>';
    return;
  }

  tbody.innerHTML = orders.map(o => `
    <tr>
      <td><span class="code-tag">${escapeHtml(o.id.substring(0, 8))}...</span></td>
      <td>${escapeHtml(o.customer || o.customerName || 'User')}</td>
      <td>${formatCurrency(o.amount)}</td>
      <td><span class="badge ${o.status.toLowerCase() === 'paid' ? 'success' : o.status.toLowerCase() === 'failed' ? 'danger' : 'warning'}">${o.status}</span></td>
    </tr>
  `).join('');
};

const loadChartData = async (timeframe = '6m') => {
  try {
    const isMonth = /^\d{4}-\d{2}$/.test(timeframe);
    const url = isMonth 
      ? `/api/admin/dashboard/chart?month=${timeframe}` 
      : `/api/admin/dashboard/chart?timeframe=${timeframe}`;
    const chartData = await adminApi(url);
    if (chartData) {
      renderSalesChart(chartData);
    }
  } catch (e) {
    console.error('Failed to load chart data:', e);
  }
};

const renderSalesChart = (data) => {
  const ctx = document.getElementById('salesChart');
  if (!ctx || typeof Chart === 'undefined') return;
  
  if (adminState.salesChartInstance) {
    adminState.salesChartInstance.destroy();
  }

  const isLight = document.body.classList.contains('admin-light');
  const textColor = isLight ? '#334155' : '#94a3b8';
  const gridColor = isLight ? 'rgba(100,116,139,0.12)' : 'rgba(148,163,184,0.08)';
  const legendColor = isLight ? '#0f172a' : '#e2e8f0';
  const tooltipBg = isLight ? 'rgba(15,23,42,0.92)' : 'rgba(15,23,42,0.95)';
  
  adminState.salesChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.labels,
      datasets: [{
        label: data.title || 'Revenue (₹)',
        data: data.values,
        borderColor: '#3b82f6',
        backgroundColor: isLight ? 'rgba(59, 130, 246, 0.12)' : 'rgba(59, 130, 246, 0.18)',
        borderWidth: 3,
        fill: true,
        tension: 0.35,
        pointBackgroundColor: '#60a5fa',
        pointBorderColor: '#fff',
        pointBorderWidth: 1.5,
        pointRadius: 4,
        pointHoverRadius: 6
      }]
    },
    options: { 
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: { 
        legend: { 
          labels: { 
            color: legendColor, 
            font: { family: 'inherit', weight: '600', size: 12 } 
          } 
        },
        tooltip: {
          backgroundColor: tooltipBg,
          titleColor: '#fff',
          bodyColor: '#38bdf8',
          padding: 10,
          displayColors: false,
          callbacks: {
            label: (context) => ` Revenue: ₹${Number(context.parsed.y).toLocaleString('en-IN')}`
          }
        }
      },
      scales: {
        x: { 
          ticks: { color: textColor, font: { family: 'inherit', size: 11 } }, 
          grid: { color: gridColor } 
        },
        y: { 
          beginAtZero: true,
          ticks: { 
            color: textColor,
            font: { family: 'inherit', size: 11 },
            callback: (val) => '₹' + Number(val).toLocaleString('en-IN')
          }, 
          grid: { color: gridColor } 
        }
      }
    }
  });
};

// Books Management
const loadBooks = async () => {
  try {
    const books = await adminApi('/api/admin/books');
    adminState.books = books;
    renderBooksTable(books);
  } catch (e) {
    showAdminToast('Failed to load books catalog', 'error');
  }
};

const renderBooksTable = (books) => {
  const tbody = document.querySelector('#books-table tbody');
  if (!tbody) return;

  if (books.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-secondary">No books in catalog.</td></tr>';
    return;
  }

  tbody.innerHTML = books.map(b => {
    const thumbHtml = b.cover_image ? 
      `<img src="${escapeHtml(b.cover_image)}" class="book-table-thumb" alt="${escapeHtml(b.title)}" onerror="this.outerHTML='<div class=\\'book-thumb-placeholder\\'><span>${escapeHtml(b.title.substring(0,3))}</span></div>'">` :
      `<div class="book-thumb-placeholder"><span>${escapeHtml(b.title.substring(0,3))}</span></div>`;

    return `
      <tr>
        <td style="width: 60px;">${thumbHtml}</td>
        <td>
          <div style="font-weight: 600; color: #f8fafc;">${escapeHtml(b.title)}</div>
          <small class="text-secondary">/${b.slug}</small>
        </td>
        <td><span class="category-badge">${escapeHtml(b.category)}</span></td>
        <td><strong>${formatCurrency(b.price)}</strong></td>
        <td><i class="fas fa-star text-warning"></i> ${(b.rating || 4.8).toFixed(1)}</td>
        <td><span class="badge ${b.status === 'Published' ? 'success' : 'warning'}">${b.status}</span></td>
        <td>
          <div class="table-actions">
            <button class="btn btn-sm btn-outline" data-action="edit-book" data-id="${escapeHtml(b.id)}" title="Edit Book">
              <i class="fas fa-edit"></i> Edit
            </button>
            <button class="btn btn-sm btn-outline text-danger" data-action="delete-book" data-id="${escapeHtml(b.id)}" title="Deactivate Book">
              <i class="fas fa-trash-alt"></i> Delete
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
};

window.adminState = adminState;

let currentCoverBase64 = null;

function updateCoverPreview(src) {
  const img = document.getElementById('book-cover-preview');
  const placeholder = document.getElementById('book-cover-placeholder-preview');
  const removeBtn = document.getElementById('btn-remove-cover');
  if (!img || !placeholder) return;

  if (src) {
    img.src = src;
    img.style.display = 'block';
    placeholder.style.display = 'none';
    if (removeBtn) removeBtn.style.display = 'inline-flex';
  } else {
    img.src = '';
    img.style.display = 'none';
    placeholder.style.display = 'flex';
    if (removeBtn) removeBtn.style.display = 'none';
  }
}

window.showAddBookModal = () => {
  document.getElementById('book-form').reset();
  document.getElementById('book-id').value = '';
  document.getElementById('book-cover-url').value = '';
  document.getElementById('book-google-drive-link').value = '';
  currentCoverBase64 = null;
  updateCoverPreview(null);
  document.getElementById('book-modal-title').innerText = 'Add New Programming eBook';
  document.getElementById('book-modal').classList.add('active');
};

window.showEditBookModal = (id) => {
  if (!id) return;
  const book = adminState.books.find(b => b.id === id || b.slug === id);
  if (!book) {
    showAdminToast('Book data not found', 'error');
    return;
  }
  
  document.getElementById('book-id').value = book.id;
  document.getElementById('book-title').value = book.title || '';
  document.getElementById('book-slug').value = book.slug || '';
  document.getElementById('book-price').value = Math.round(book.price / 100) || 99;
  document.getElementById('book-category').value = book.category || 'web-development';
  document.getElementById('book-filename').value = book.filename || book.ebook_filename || `${book.slug}.pdf`;
  document.getElementById('book-google-drive-link').value = book.google_drive_url || book.google_drive_link || '';
  document.getElementById('book-short-desc').value = book.shortDescription || book.short_description || '';
  document.getElementById('book-desc').value = book.description || '';
  
  const cover = book.cover_image || book.cover || '';
  document.getElementById('book-cover-url').value = cover;
  currentCoverBase64 = null;
  updateCoverPreview(cover);

  const learn = Array.isArray(book.whatYouWillLearn) ? book.whatYouWillLearn : (book.what_you_learn ? (typeof book.what_you_learn === 'string' ? JSON.parse(book.what_you_learn) : book.what_you_learn) : []);
  const topics = Array.isArray(book.topics) ? book.topics : (typeof book.topics === 'string' ? JSON.parse(book.topics) : (Array.isArray(book.topics) ? book.topics : []));
  
  document.getElementById('book-learn').value = learn.join('\n');
  document.getElementById('book-topics').value = topics.join('\n');
  document.getElementById('book-published').checked = (book.status === 'Published' || book.is_published === 1);
  
  document.getElementById('book-modal-title').innerText = `Edit: ${book.title}`;
  document.getElementById('book-modal').classList.add('active');
};

// Cover Image Event Listeners
document.getElementById('book-cover-file')?.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showAdminToast('Please select a valid image file', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = (event) => {
    currentCoverBase64 = event.target.result;
    updateCoverPreview(currentCoverBase64);
    document.getElementById('book-cover-url').value = '';
  };
  reader.readAsDataURL(file);
});

document.getElementById('book-cover-url')?.addEventListener('input', (e) => {
  const val = e.target.value.trim();
  currentCoverBase64 = null;
  updateCoverPreview(val);
});

document.getElementById('btn-remove-cover')?.addEventListener('click', () => {
  currentCoverBase64 = '';
  document.getElementById('book-cover-url').value = '';
  const fileInput = document.getElementById('book-cover-file');
  if (fileInput) fileInput.value = '';
  updateCoverPreview(null);
});

document.getElementById('book-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('book-id').value;
  const title = document.getElementById('book-title').value.trim();
  const slug = document.getElementById('book-slug').value.trim();
  const price = Math.round(parseFloat(document.getElementById('book-price').value) * 100);
  const category = document.getElementById('book-category').value;
  const filename = document.getElementById('book-filename').value.trim();
  const google_drive_url = document.getElementById('book-google-drive-link').value.trim();
  const short_description = document.getElementById('book-short-desc').value.trim();
  const description = document.getElementById('book-desc').value.trim();
  const what_you_learn = document.getElementById('book-learn').value.split('\n').map(l => l.trim()).filter(Boolean);
  const topics = document.getElementById('book-topics').value.split('\n').map(l => l.trim()).filter(Boolean);
  const is_published = document.getElementById('book-published').checked ? 1 : 0;
  
  // Cover Image value (either newly uploaded base64 data URL, text URL, or empty string if cleared)
  const cover_image = currentCoverBase64 !== null ? currentCoverBase64 : document.getElementById('book-cover-url').value.trim();

  const btn = document.getElementById('btn-save-book');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

  try {
    if (id) {
      await adminApi(`/api/admin/books/${id}`, {
        method: 'PUT',
        body: { title, slug, price, category, ebook_filename: filename, google_drive_url, short_description, description, what_you_learn, topics, is_published, cover_image }
      });
      showAdminToast('Book updated successfully', 'success');
    } else {
      await adminApi('/api/admin/books', {
        method: 'POST',
        body: { title, slug, price, category, ebook_filename: filename, google_drive_url, short_description, description, what_you_learn, topics, is_published, cover_image }
      });
      showAdminToast('New book created successfully', 'success');
    }

    closeAllModals();
    loadBooks();
  } catch (err) {
    showAdminToast(err.message || 'Error saving book', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Save eBook';
  }
});

window.handleDeleteBook = async (id) => {
  if (!id) return;
  const book = adminState.books.find(b => b.id === id || b.slug === id);
  const title = book ? book.title : 'this eBook';
  if (!confirm(`Are you sure you want to unpublish/deactivate "${title}" from the store?`)) return;
  try {
    await adminApi(`/api/admin/books/${id}`, { method: 'DELETE' });
    showAdminToast(`"${title}" deactivated successfully`, 'success');
    loadBooks();
  } catch (e) {
    showAdminToast('Error deactivating book: ' + (e.message || ''), 'error');
  }
};

// Global Delegated Click Listeners in Admin Panel
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const id = btn.dataset.id;

  if (action === 'edit-book') {
    e.preventDefault();
    window.showEditBookModal(id);
  } else if (action === 'delete-book') {
    e.preventDefault();
    window.handleDeleteBook(id);
  } else if (action === 'edit-bundle') {
    e.preventDefault();
    window.showEditBundleModal(id);
  }
});

// Bundle Management
const loadBundles = async () => {
  try {
    const bundles = await adminApi('/api/admin/bundles');
    adminState.bundles = bundles;
    renderBundles(bundles);
  } catch (e) {
    showAdminToast('Failed to load bundles', 'error');
  }
};

const renderBundles = (bundles) => {
  const container = document.getElementById('bundles-container');
  if (!container) return;

  if (bundles.length === 0) {
    container.innerHTML = '<p class="text-secondary">No bundles configured.</p>';
    return;
  }

  container.innerHTML = bundles.map(b => `
    <div class="card bundle-card">
      <div class="bundle-card-header">
        <div>
          <h3>${escapeHtml(b.title || b.name)}</h3>
          <p class="text-secondary">${b.books ? b.books.length : 0} eBooks Included</p>
        </div>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span class="badge ${b.status === 'Active' ? 'success' : 'warning'}">${b.status}</span>
          <button class="btn btn-sm btn-outline" data-action="edit-bundle" data-id="${b.id}" onclick="showEditBundleModal('${b.id}')" title="Edit Bundle Price">
            <i class="fas fa-edit"></i> Edit Price
          </button>
        </div>
      </div>
      
      <p class="bundle-desc-admin">${escapeHtml(b.description || '')}</p>

      <div class="form-group" style="margin-top: 1rem;">
        <label>Bundle Price (in ₹)</label>
        <div style="display: flex; gap: 0.5rem;">
          <input type="number" id="bundle-price-${b.id}" class="form-control" value="${Math.round(b.price / 100)}" min="1" step="1">
          <button class="btn btn-primary btn-sm" onclick="saveBundlePrice('${b.id}')">
            <i class="fas fa-save"></i> Update Price
          </button>
        </div>
      </div>

      <div class="bundle-books-list">
        <h4>Included Books:</h4>
        ${(b.books || []).map(bk => `<div class="bundle-book-item"><i class="fas fa-check text-success"></i> ${escapeHtml(bk)}</div>`).join('')}
      </div>

      <div style="margin-top: 1.5rem;">
        <button class="btn btn-outline btn-block" onclick="toggleBundleStatus('${b.id}', '${b.status}')">
          <i class="fas fa-toggle-on"></i> Toggle ${b.status === 'Active' ? 'Inactive' : 'Active'}
        </button>
      </div>
    </div>
  `).join('');
};

window.showEditBundleModal = (id) => {
  if (!id && adminState.bundles && adminState.bundles.length > 0) {
    id = adminState.bundles[0].id;
  }
  const bundle = (adminState.bundles || []).find(b => b.id === id || b.slug === id);
  if (!bundle) {
    showAdminToast('Bundle data not found', 'error');
    return;
  }

  document.getElementById('bundle-modal-id').value = bundle.id;
  document.getElementById('bundle-modal-name').value = bundle.title || bundle.name || 'Complete Programming Bundle';
  document.getElementById('bundle-modal-price').value = Math.round(bundle.price / 100);
  document.getElementById('bundle-modal-title').innerText = `Edit: ${bundle.title || bundle.name}`;
  document.getElementById('bundle-modal').classList.add('active');
};

document.getElementById('bundle-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('bundle-modal-id').value;
  const rawPrice = document.getElementById('bundle-modal-price').value;
  const priceNum = parseFloat(rawPrice);

  if (isNaN(priceNum) || priceNum <= 0) {
    showAdminToast('Please enter a valid positive bundle price in ₹', 'error');
    return;
  }

  const price = Math.round(priceNum * 100);
  const btn = document.getElementById('btn-save-bundle-modal');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

  try {
    await adminApi(`/api/admin/bundles/${id}`, {
      method: 'PUT',
      body: { price }
    });
    showAdminToast(`Bundle price successfully updated to ₹${priceNum}`, 'success');
    closeAllModals();
    loadBundles();
  } catch (err) {
    showAdminToast(err.message || 'Failed to update bundle price', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save"></i> Save Bundle Price';
  }
});

window.saveBundlePrice = async (id) => {
  const priceInput = document.getElementById(`bundle-price-${id}`);
  if (!priceInput) return;
  const rawVal = priceInput.value;
  const num = parseFloat(rawVal);
  if (isNaN(num) || num <= 0) {
    showAdminToast('Please enter a valid positive bundle price in ₹', 'error');
    return;
  }
  const price = Math.round(num * 100);
  try {
    await adminApi(`/api/admin/bundles/${id}`, {
      method: 'PUT',
      body: { price }
    });
    showAdminToast(`Bundle price successfully updated to ₹${num}`, 'success');
    loadBundles();
  } catch (err) {
    showAdminToast(err.message || 'Failed to update bundle price', 'error');
  }
};

window.toggleBundleStatus = async (id, currentStatus) => {
  const newStatus = currentStatus === 'Active' ? 'Inactive' : 'Active';
  try {
    await adminApi(`/api/admin/bundles/${id}`, {
      method: 'PUT',
      body: { status: newStatus }
    });
    showAdminToast(`Bundle is now ${newStatus}`, 'success');
    loadBundles();
  } catch (err) {
    showAdminToast('Failed to update bundle status', 'error');
  }
};

// Orders Management
const loadOrders = async () => {
  const filter = document.getElementById('order-status-filter')?.value || '';
  try {
    const url = filter ? `/api/admin/orders?status=${encodeURIComponent(filter)}` : '/api/admin/orders';
    const orders = await adminApi(url);
    adminState.orders = orders;
    renderOrdersTable(orders);
  } catch (e) {
    showAdminToast('Failed to load orders', 'error');
  }
};

document.getElementById('order-status-filter')?.addEventListener('change', loadOrders);

const renderOrdersTable = (orders) => {
  const tbody = document.querySelector('#orders-table tbody');
  if (!tbody) return;

  if (orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-secondary">No customer orders match filter.</td></tr>';
    return;
  }

  tbody.innerHTML = orders.map(o => `
    <tr>
      <td><span class="code-tag">${escapeHtml(o.id.substring(0, 8))}...</span></td>
      <td>
        <div><strong>${escapeHtml(o.customer || o.customerName || 'User')}</strong></div>
        <small class="text-secondary">${escapeHtml(o.customerEmail || '')}</small>
      </td>
      <td>${escapeHtml(o.product || o.productName || 'eBook')}</td>
      <td><strong>${formatCurrency(o.amount)}</strong></td>
      <td><span class="badge ${o.status.toLowerCase() === 'paid' ? 'success' : o.status.toLowerCase() === 'failed' ? 'danger' : 'warning'}">${o.status}</span></td>
      <td><small class="code-tag">${escapeHtml(o.paymentId || '-')}</small></td>
      <td>${formatDate(o.createdAt)}</td>
      <td>
        <button class="btn btn-sm btn-outline" onclick="showOrderDetail('${o.id}')" title="View / Update">
          <i class="fas fa-eye"></i>
        </button>
      </td>
    </tr>
  `).join('');
};

window.showOrderDetail = async (id) => {
  try {
    const order = await adminApi(`/api/admin/orders/${id}`);
    if (!order) return;

    document.getElementById('modal-order-id').innerText = `#${order.id.substring(0, 8)}`;
    document.getElementById('modal-update-order-status').value = order.status.toLowerCase();
    
    document.getElementById('btn-update-order').onclick = async () => {
      const newStatus = document.getElementById('modal-update-order-status').value;
      try {
        await adminApi(`/api/admin/orders/${order.id}/status`, {
          method: 'PUT',
          body: { status: newStatus }
        });
        showAdminToast('Order status updated successfully', 'success');
        closeAllModals();
        loadOrders();
      } catch (e) {
        showAdminToast('Failed to update status', 'error');
      }
    };
    
    document.getElementById('order-detail-content').innerHTML = `
      <div class="order-detail-grid">
        <p><strong>Customer Name:</strong> ${escapeHtml(order.customer || order.customerName)}</p>
        <p><strong>Email Address:</strong> ${escapeHtml(order.customerEmail || 'N/A')}</p>
        <p><strong>Product Purchased:</strong> ${escapeHtml(order.product || order.productName)}</p>
        <p><strong>Total Amount:</strong> ${formatCurrency(order.amount)}</p>
        <p><strong>Order Timestamp:</strong> ${formatDate(order.createdAt)}</p>
        <p><strong>Razorpay Payment ID:</strong> <code>${escapeHtml(order.paymentId || 'N/A')}</code></p>
        <p><strong>Razorpay Order ID:</strong> <code>${escapeHtml(order.razorpay_order_id || 'N/A')}</code></p>
      </div>
    `;
    
    document.getElementById('order-modal').classList.add('active');
  } catch (err) {
    showAdminToast('Failed to fetch order details', 'error');
  }
};

// Customers
const loadCustomers = async () => {
  try {
    const customers = await adminApi('/api/admin/customers');
    adminState.customers = customers;
    renderCustomersTable(customers);
  } catch (e) {
    showAdminToast('Failed to load customers', 'error');
  }
};

const renderCustomersTable = (customers) => {
  const tbody = document.querySelector('#customers-table tbody');
  if (!tbody) return;

  if (customers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-secondary">No registered customers yet.</td></tr>';
    return;
  }

  tbody.innerHTML = customers.map(c => `
    <tr>
      <td><strong>${escapeHtml(c.name || 'User')}</strong></td>
      <td>${escapeHtml(c.email)}</td>
      <td>${c.orderCount || 0}</td>
      <td><span class="badge info">${c.purchases || 0} eBooks</span></td>
      <td><strong>${formatCurrency(c.totalSpent || 0)}</strong></td>
      <td>${formatDate(c.createdAt)}</td>
      <td>
        <button class="btn btn-sm btn-outline" onclick="showCustomerDetail('${c.id}')">
          <i class="fas fa-folder-open"></i> Licenses
        </button>
      </td>
    </tr>
  `).join('');
};

window.showCustomerDetail = async (id) => {
  try {
    const c = await adminApi(`/api/admin/customers/${id}`);
    if (!c) return;

    const purchases = Array.isArray(c.purchases) ? c.purchases : [];
    
    document.getElementById('customer-detail-content').innerHTML = `
      <div class="customer-info-box">
        <h3>${escapeHtml(c.name)}</h3>
        <p class="text-secondary">${escapeHtml(c.email)}</p>
        <div style="display: flex; gap: 1.5rem; margin: 1rem 0;">
          <div><strong>Total Orders:</strong> ${c.orderCount || 0}</div>
          <div><strong>Lifetime Spent:</strong> ${formatCurrency(c.totalSpent || 0)}</div>
          <div><strong>Joined:</strong> ${formatDate(c.createdAt)}</div>
        </div>
      </div>
      
      <h4 style="margin-top: 1.5rem; margin-bottom: 0.5rem;"><i class="fas fa-book-open"></i> Unlocked eBook Licenses:</h4>
      ${purchases.length === 0 ? '<p class="text-secondary">No purchased eBooks yet.</p>' : `
        <div class="customer-books-list">
          ${purchases.map(p => `
            <div class="customer-book-item">
              <div>
                <strong>${escapeHtml(p.title)}</strong>
                <span class="category-badge">${escapeHtml(p.category || 'eBook')}</span>
              </div>
              <small class="text-secondary">Granted: ${formatDate(p.granted_at)}</small>
            </div>
          `).join('')}
        </div>
      `}
    `;
    
    document.getElementById('customer-modal').classList.add('active');
  } catch (err) {
    showAdminToast('Failed to fetch customer profile', 'error');
  }
};

// Discount Codes & Coupons
const loadCoupons = async () => {
  try {
    const [coupons, stats] = await Promise.all([
      adminApi('/api/admin/coupons'),
      adminApi('/api/admin/coupons/stats')
    ]);
    adminState.coupons = coupons;
    adminState.couponStats = stats;
    renderCouponStats(stats);
    renderCouponsTable(coupons);
  } catch (e) {
    showAdminToast('Failed to load coupons data', 'error');
  }
};

const renderCouponStats = (stats) => {
  if (!stats) return;
  const totalEl = document.getElementById('stat-total-coupons');
  const activeEl = document.getElementById('stat-active-coupons');
  const usesEl = document.getElementById('stat-coupon-uses');
  const discountEl = document.getElementById('stat-discount-given');

  if (totalEl) totalEl.innerText = stats.totalCoupons || 0;
  if (activeEl) activeEl.innerText = stats.activeCoupons || 0;
  if (usesEl) usesEl.innerText = stats.totalUses || 0;
  if (discountEl) discountEl.innerText = formatCurrency(stats.totalDiscountGiven || 0);
};

const renderCouponsTable = (coupons) => {
  const tbody = document.querySelector('#coupons-table tbody');
  if (!tbody) return;

  if (coupons.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-secondary">No discount codes created yet. Click "Create New Coupon" to add one.</td></tr>';
    return;
  }

  tbody.innerHTML = coupons.map(c => {
    const discountText = c.discount_type === 'percentage'
      ? `${c.discount_value}% OFF${c.max_discount_amount ? ` (Cap: ${formatCurrency(c.max_discount_amount)})` : ''}`
      : `${formatCurrency(c.discount_value)} OFF`;

    const minOrderText = c.min_order_amount > 0 ? formatCurrency(c.min_order_amount) : 'None';
    const usageText = `${c.used_count || 0} / ${c.usage_limit != null ? c.usage_limit : '∞'}`;
    const expiryText = c.expiry_date ? formatDate(c.expiry_date) : 'Never (No Expiry)';
    
    // Check if expired
    const isExpired = c.expiry_date && new Date(c.expiry_date) < new Date();
    const isActive = !!c.is_active && !isExpired;

    return `
      <tr>
        <td>
          <span class="code-tag" style="font-size: 0.9rem; font-weight: 700; letter-spacing: 0.5px;">${escapeHtml(c.code)}</span>
        </td>
        <td><strong>${escapeHtml(discountText)}</strong></td>
        <td>${escapeHtml(minOrderText)}</td>
        <td>${escapeHtml(usageText)}</td>
        <td><small class="${isExpired ? 'text-danger' : 'text-secondary'}">${escapeHtml(expiryText)}</small></td>
        <td>
          <span class="badge ${isActive ? 'success' : 'danger'}">
            ${isExpired ? 'Expired' : (isActive ? 'Active' : 'Inactive')}
          </span>
        </td>
        <td>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <button class="btn btn-sm ${isActive ? 'btn-outline text-warning' : 'btn-outline text-success'}" onclick="toggleCouponStatus('${c.id}')" title="${isActive ? 'Deactivate' : 'Activate'}">
              <i class="fas ${isActive ? 'fa-pause' : 'fa-play'}"></i>
            </button>
            <button class="btn btn-sm btn-outline" onclick="showEditCouponModal('${c.id}')" title="Edit Coupon">
              <i class="fas fa-edit"></i>
            </button>
            <button class="btn btn-sm btn-danger" onclick="deleteCoupon('${c.id}', '${escapeHtml(c.code)}')" title="Delete Coupon">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
};

window.showAddCouponModal = () => {
  document.getElementById('coupon-modal-title').innerText = 'Create Discount Code';
  document.getElementById('coupon-id').value = '';
  document.getElementById('coupon-code').value = '';
  document.getElementById('coupon-code').disabled = false;
  document.getElementById('coupon-discount-type').value = 'percentage';
  document.getElementById('coupon-discount-value').value = '';
  document.getElementById('coupon-max-discount').value = '';
  document.getElementById('coupon-min-order').value = '0';
  document.getElementById('coupon-usage-limit').value = '';
  document.getElementById('coupon-per-customer').value = '1';
  document.getElementById('coupon-expiry-date').value = '';
  document.getElementById('coupon-is-active').checked = true;

  document.getElementById('coupon-modal').classList.add('active');
};

window.showEditCouponModal = async (id) => {
  try {
    const coupon = await adminApi(`/api/admin/coupons/${id}`);
    document.getElementById('coupon-modal-title').innerText = `Edit Coupon: ${coupon.code}`;
    document.getElementById('coupon-id').value = coupon.id;
    document.getElementById('coupon-code').value = coupon.code;
    document.getElementById('coupon-code').disabled = false;
    document.getElementById('coupon-discount-type').value = coupon.discount_type;
    
    // Convert paise to rupees for fixed/cap/min
    if (coupon.discount_type === 'fixed') {
      document.getElementById('coupon-discount-value').value = (coupon.discount_value / 100).toFixed(0);
    } else {
      document.getElementById('coupon-discount-value').value = coupon.discount_value;
    }

    document.getElementById('coupon-max-discount').value = coupon.max_discount_amount ? (coupon.max_discount_amount / 100).toFixed(0) : '';
    document.getElementById('coupon-min-order').value = coupon.min_order_amount ? (coupon.min_order_amount / 100).toFixed(0) : '0';
    document.getElementById('coupon-usage-limit').value = coupon.usage_limit || '';
    document.getElementById('coupon-per-customer').value = coupon.per_customer_limit || '1';
    
    // Format date for datetime-local
    if (coupon.expiry_date) {
      const d = new Date(coupon.expiry_date);
      if (!isNaN(d.getTime())) {
        const pad = n => String(n).padStart(2, '0');
        document.getElementById('coupon-expiry-date').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      } else {
        document.getElementById('coupon-expiry-date').value = '';
      }
    } else {
      document.getElementById('coupon-expiry-date').value = '';
    }

    document.getElementById('coupon-is-active').checked = !!coupon.is_active;
    document.getElementById('coupon-modal').classList.add('active');
  } catch (err) {
    showAdminToast(err.message || 'Failed to fetch coupon details', 'error');
  }
};

window.toggleCouponStatus = async (id) => {
  try {
    const res = await adminApi(`/api/admin/coupons/${id}/toggle`, { method: 'PATCH' });
    showAdminToast(`Coupon is now ${res.is_active ? 'Active' : 'Inactive'}`, 'success');
    loadCoupons();
  } catch (err) {
    showAdminToast(err.message || 'Failed to update coupon status', 'error');
  }
};

window.deleteCoupon = async (id, code) => {
  if (!confirm(`Are you sure you want to delete coupon code "${code}"?`)) {
    return;
  }
  try {
    await adminApi(`/api/admin/coupons/${id}`, { method: 'DELETE' });
    showAdminToast(`Coupon "${code}" deleted successfully`, 'success');
    loadCoupons();
  } catch (err) {
    showAdminToast(err.message || 'Failed to delete coupon', 'error');
  }
};

const handleCouponSubmit = async (e) => {
  e.preventDefault();
  const id = document.getElementById('coupon-id').value;
  const code = document.getElementById('coupon-code').value.trim().toUpperCase();
  const discount_type = document.getElementById('coupon-discount-type').value;
  const rawDiscountVal = parseFloat(document.getElementById('coupon-discount-value').value);
  const rawMaxDiscount = parseFloat(document.getElementById('coupon-max-discount').value);
  const rawMinOrder = parseFloat(document.getElementById('coupon-min-order').value);
  const rawUsageLimit = parseInt(document.getElementById('coupon-usage-limit').value, 10);
  const rawPerCustomer = parseInt(document.getElementById('coupon-per-customer').value, 10);
  const expiry_date = document.getElementById('coupon-expiry-date').value ? new Date(document.getElementById('coupon-expiry-date').value).toISOString() : null;
  const is_active = document.getElementById('coupon-is-active').checked;

  if (!code || isNaN(rawDiscountVal) || rawDiscountVal <= 0) {
    showAdminToast('Please provide a valid code and discount value', 'warning');
    return;
  }

  // Convert rupees to paise
  const discount_value = discount_type === 'fixed' ? Math.round(rawDiscountVal * 100) : rawDiscountVal;
  const max_discount_amount = !isNaN(rawMaxDiscount) && rawMaxDiscount > 0 ? Math.round(rawMaxDiscount * 100) : null;
  const min_order_amount = !isNaN(rawMinOrder) && rawMinOrder > 0 ? Math.round(rawMinOrder * 100) : 0;
  const usage_limit = !isNaN(rawUsageLimit) && rawUsageLimit > 0 ? rawUsageLimit : null;
  const per_customer_limit = !isNaN(rawPerCustomer) && rawPerCustomer > 0 ? rawPerCustomer : 1;

  const payload = {
    code,
    discount_type,
    discount_value,
    max_discount_amount,
    min_order_amount,
    usage_limit,
    per_customer_limit,
    expiry_date,
    is_active
  };

  try {
    const saveBtn = document.getElementById('btn-save-coupon');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    }

    if (id) {
      await adminApi(`/api/admin/coupons/${id}`, {
        method: 'PUT',
        body: payload
      });
      showAdminToast(`Coupon "${code}" updated successfully`, 'success');
    } else {
      await adminApi('/api/admin/coupons', {
        method: 'POST',
        body: payload
      });
      showAdminToast(`Coupon "${code}" created successfully`, 'success');
    }

    closeAllModals();
    loadCoupons();
  } catch (err) {
    showAdminToast(err.message || 'Failed to save coupon', 'error');
  } finally {
    const saveBtn = document.getElementById('btn-save-coupon');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = 'Save Coupon';
    }
  }
};

// Contact Messages
const loadContacts = async () => {
  try {
    const contacts = await adminApi('/api/admin/contacts');
    adminState.contacts = contacts;
    renderContactsTable(contacts);
  } catch (e) {
    showAdminToast('Failed to load contact messages', 'error');
  }
};

const renderContactsTable = (contacts) => {
  const tbody = document.querySelector('#contacts-table tbody');
  if (!tbody) return;

  if (contacts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-secondary">No inquiries submitted.</td></tr>';
    return;
  }

  tbody.innerHTML = contacts.map(c => `
    <tr class="${c.status === 'Unread' ? 'unread-row' : ''}">
      <td><strong>${escapeHtml(c.name)}</strong></td>
      <td>${escapeHtml(c.email)}</td>
      <td><div class="message-preview">${escapeHtml(c.message)}</div></td>
      <td><span class="badge ${c.status === 'Unread' ? 'warning' : 'success'}">${c.status}</span></td>
      <td>${formatDate(c.createdAt)}</td>
      <td>
        ${c.status === 'Unread' ? `
          <button class="btn btn-sm btn-outline text-success" onclick="markContactAsRead('${c.id}')">
            <i class="fas fa-check"></i> Mark Read
          </button>
        ` : '<span class="text-secondary"><i class="fas fa-check-double"></i> Read</span>'}
      </td>
    </tr>
  `).join('');
};

window.markContactAsRead = async (id) => {
  try {
    await adminApi(`/api/admin/contacts/${id}/read`, { method: 'PUT' });
    showAdminToast('Message marked as read', 'success');
    loadContacts();
  } catch (err) {
    showAdminToast('Failed to update message status', 'error');
  }
};

// Security Audit Log
const loadAuditLogs = async () => {
  try {
    const logs = await adminApi('/api/admin/audit-logs');
    adminState.auditLogs = logs;
    renderAuditTable(logs);
  } catch (e) {
    showAdminToast('Failed to load audit logs', 'error');
  }
};

const renderAuditTable = (logs) => {
  const tbody = document.querySelector('#audit-table tbody');
  if (!tbody) return;

  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-secondary">No audit logs found.</td></tr>';
    return;
  }

  tbody.innerHTML = logs.map(l => `
    <tr>
      <td>${formatDate(l.createdAt)}</td>
      <td><strong>${escapeHtml(l.adminEmail)}</strong></td>
      <td><span class="badge ${l.action.includes('LOGIN') ? 'info' : l.action.includes('2FA') ? 'warning' : 'success'}">${escapeHtml(l.action)}</span></td>
      <td>${escapeHtml(l.entity)}</td>
      <td><small class="code-tag">${escapeHtml(typeof l.details === 'object' ? JSON.stringify(l.details) : l.details)}</small></td>
      <td>${escapeHtml(l.ipAddress)}</td>
    </tr>
  `).join('');
};

// Settings & 2FA
const loadSettings = async () => {
  if (adminState.admin) {
    document.getElementById('setting-name').value = adminState.admin.username || 'admin';
    document.getElementById('setting-email').value = adminState.admin.email || 'admin@codelibrary.in';
  }
  load2FAStatus();
  loadContactSettings();
};

const loadContactSettings = async () => {
  try {
    const res = await adminApi('/api/admin/settings/contact');
    if (!res || !res.settings) return;
    const s = res.settings;

    // Contact Fields
    if (document.getElementById('setting-contact-phone')) document.getElementById('setting-contact-phone').value = s.contact_phone || '';
    if (document.getElementById('setting-contact-whatsapp')) document.getElementById('setting-contact-whatsapp').value = s.contact_whatsapp || '';
    if (document.getElementById('setting-whatsapp-message')) document.getElementById('setting-whatsapp-message').value = s.whatsapp_message || '';
    if (document.getElementById('setting-support-email')) document.getElementById('setting-support-email').value = s.support_email || '';
    if (document.getElementById('setting-business-email')) document.getElementById('setting-business-email').value = s.business_email || '';
    if (document.getElementById('setting-contact-address')) document.getElementById('setting-contact-address').value = s.contact_address || '';

    // Social Channels
    const channels = ['whatsapp', 'instagram', 'facebook', 'youtube', 'twitter', 'telegram', 'linkedin', 'pinterest', 'discord'];
    channels.forEach(ch => {
      const enabledEl = document.getElementById(`setting-social-${ch}-enabled`);
      const urlEl = document.getElementById(`setting-social-${ch}-url`);
      if (enabledEl) enabledEl.checked = s[`social_${ch}_enabled`] === '1' || s[`social_${ch}_enabled`] === 1;
      if (urlEl) urlEl.value = s[`social_${ch}_url`] || '';
    });
  } catch (err) {
    console.error('Failed to load contact settings:', err);
  }
};

const handleContactSettingsSubmit = async (e) => {
  if (e) e.preventDefault();
  const alertEl = document.getElementById('contact-settings-alert');
  const saveBtn = document.getElementById('btn-save-contact-settings');
  const saveBtnBottom = document.getElementById('btn-save-contact-settings-bottom');

  const payload = {
    contact_phone: document.getElementById('setting-contact-phone')?.value.trim(),
    contact_whatsapp: document.getElementById('setting-contact-whatsapp')?.value.trim(),
    whatsapp_message: document.getElementById('setting-whatsapp-message')?.value.trim(),
    support_email: document.getElementById('setting-support-email')?.value.trim(),
    business_email: document.getElementById('setting-business-email')?.value.trim(),
    contact_address: document.getElementById('setting-contact-address')?.value.trim()
  };

  const channels = ['whatsapp', 'instagram', 'facebook', 'youtube', 'twitter', 'telegram', 'linkedin', 'pinterest', 'discord'];
  channels.forEach(ch => {
    payload[`social_${ch}_enabled`] = document.getElementById(`setting-social-${ch}-enabled`)?.checked ? '1' : '0';
    payload[`social_${ch}_url`] = document.getElementById(`setting-social-${ch}-url`)?.value.trim() || '';
  });

  try {
    if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }
    if (saveBtnBottom) { saveBtnBottom.disabled = true; saveBtnBottom.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }

    const res = await adminApi('/api/admin/settings/contact', {
      method: 'PUT',
      body: payload
    });

    if (alertEl) {
      alertEl.style.display = 'block';
      alertEl.style.background = 'rgba(16, 185, 129, 0.15)';
      alertEl.style.border = '1px solid #10b981';
      alertEl.style.color = '#10b981';
      alertEl.innerHTML = '<i class="fas fa-check-circle"></i> ' + (res.message || 'Settings saved successfully');
      setTimeout(() => { alertEl.style.display = 'none'; }, 4000);
    }
    showAdminToast('Contact & social settings saved successfully', 'success');
  } catch (err) {
    if (alertEl) {
      alertEl.style.display = 'block';
      alertEl.style.background = 'rgba(239, 68, 68, 0.15)';
      alertEl.style.border = '1px solid #ef4444';
      alertEl.style.color = '#ef4444';
      alertEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> ' + (err.message || 'Failed to save settings');
    }
    showAdminToast(err.message || 'Failed to save settings', 'error');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Settings'; }
    if (saveBtnBottom) { saveBtnBottom.disabled = false; saveBtnBottom.innerHTML = '<i class="fas fa-save"></i> Save All Settings'; }
  }
};

const load2FAStatus = async () => {
  try {
    const res = await adminApi('/api/admin/2fa/status');
    const badge = document.getElementById('2fa-status-badge');
    const setupBtn = document.getElementById('btn-setup-2fa');
    const disableBtn = document.getElementById('btn-disable-2fa');
    
    if (res.enabled) {
      badge.className = 'badge success';
      badge.innerText = 'Active & Protected';
      setupBtn.style.display = 'none';
      disableBtn.style.display = 'inline-block';
    } else {
      badge.className = 'badge warning';
      badge.innerText = 'Disabled';
      setupBtn.style.display = 'inline-block';
      disableBtn.style.display = 'none';
    }
  } catch (e) {
    console.error('Failed to load 2FA status:', e);
  }
};

document.getElementById('btn-setup-2fa')?.addEventListener('click', async () => {
  try {
    const res = await adminApi('/api/admin/setup-2fa', { method: 'POST' });
    document.getElementById('qr-code-img').src = res.qr_code;
    document.getElementById('secret-key-display').innerText = `Manual Secret: ${res.secret}`;
    document.getElementById('verify-2fa-code').value = '';
    document.getElementById('setup-2fa-modal').classList.add('active');
  } catch (e) {
    showAdminToast('Failed to initialize 2FA setup', 'error');
  }
});

document.getElementById('btn-verify-2fa')?.addEventListener('click', async () => {
  const code = document.getElementById('verify-2fa-code').value.trim();
  if (!code || code.length !== 6) {
    showAdminToast('Please enter the 6-digit code', 'warning');
    return;
  }
  try {
    await adminApi('/api/admin/verify-2fa', {
      method: 'POST',
      body: { totp_code: code }
    });
    showAdminToast('Two-Factor Authentication is now enabled!', 'success');
    closeAllModals();
    load2FAStatus();
  } catch (e) {
    showAdminToast(e.message || 'Invalid 2FA code', 'error');
  }
});

document.getElementById('btn-disable-2fa')?.addEventListener('click', async () => {
  const code = prompt('Enter the 6-digit 2FA code from your authenticator app to disable 2FA:');
  if (!code) return;
  try {
    await adminApi('/api/admin/disable-2fa', {
      method: 'POST',
      body: { totp_code: code.trim() }
    });
    showAdminToast('2FA has been disabled', 'info');
    load2FAStatus();
  } catch (e) {
    showAdminToast(e.message || 'Failed to disable 2FA', 'error');
  }
});

// Event Listeners
document.getElementById('login-form')?.addEventListener('submit', handleLogin);
document.getElementById('admin-logout')?.addEventListener('click', handleLogout);
document.getElementById('contact-settings-form')?.addEventListener('submit', handleContactSettingsSubmit);

document.querySelectorAll('#sidebar-nav a').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    switchSection(link.dataset.section);
  });
});

document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

document.getElementById('chart-timeframe')?.addEventListener('change', (e) => {
  loadChartData(e.target.value);
});

document.getElementById('btn-add-book')?.addEventListener('click', window.showAddBookModal);
document.getElementById('btn-add-coupon')?.addEventListener('click', window.showAddCouponModal);
document.getElementById('coupon-form')?.addEventListener('submit', handleCouponSubmit);

// Modal Handling
const closeAllModals = () => {
  document.querySelectorAll('.admin-modal').forEach(m => m.classList.remove('active'));
};

document.querySelectorAll('.close-modal').forEach(btn => {
  btn.addEventListener('click', closeAllModals);
});

window.addEventListener('click', (e) => {
  if (e.target.classList.contains('admin-modal')) {
    closeAllModals();
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAllModals();
});

// ========================================
// Admin Theme Toggle (Light / Dark Mode)
// ========================================
(function initAdminTheme() {
  const STORAGE_KEY = 'codelibrary-admin-theme';

  // Apply saved theme immediately to prevent flash
  const savedTheme = localStorage.getItem(STORAGE_KEY);
  if (savedTheme === 'light') {
    document.body.classList.add('admin-light');
  }

  // Attach toggle handler
  const toggleBtn = document.getElementById('admin-theme-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const isLight = document.body.classList.toggle('admin-light');
      localStorage.setItem(STORAGE_KEY, isLight ? 'light' : 'dark');

      // Update Chart.js colors if a chart exists
      if (adminState.salesChartInstance) {
        const textColor = isLight ? '#475569' : '#94a3b8';
        const gridColor = isLight ? 'rgba(100,116,139,0.12)' : 'rgba(148,163,184,0.08)';
        const legendColor = isLight ? '#334155' : '#e2e8f0';
        const chart = adminState.salesChartInstance;
        chart.options.scales.x.ticks.color = textColor;
        chart.options.scales.y.ticks.color = textColor;
        chart.options.scales.x.grid.color = gridColor;
        chart.options.scales.y.grid.color = gridColor;
        chart.options.plugins.legend.labels.color = legendColor;
        chart.update('none');
      }
    });
  }
})();

// Start Checking Auth
checkAdminAuth();

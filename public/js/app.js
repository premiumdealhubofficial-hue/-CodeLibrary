// State Management
const state = {
  books: [],
  bundle: null,
  cart: [],
  appliedCoupon: null,
  user: null,
  myBooks: [],
  reviews: [],
  activeFilter: 'all',
  searchQuery: '',
  currentReviewIndex: 0
};

// Category Color & Icon Mappings for CSS Book Covers
const categoryMeta = {
  'web-development': { color1: '#1e3a8a', color2: '#3b82f6', icon: 'fa-code' },
  'programming-languages': { color1: '#312e81', color2: '#6366f1', icon: 'fa-terminal' },
  'data-science': { color1: '#064e3b', color2: '#10b981', icon: 'fa-chart-pie' },
  'database': { color1: '#701a75', color2: '#d946ef', icon: 'fa-database' },
  'ai': { color1: '#581c87', color2: '#a855f7', icon: 'fa-brain' },
  'computer-science': { color1: '#134e4a', color2: '#14b8a6', icon: 'fa-microchip' },
  'mobile-development': { color1: '#831843', color2: '#ec4899', icon: 'fa-mobile-alt' },
  'productivity': { color1: '#14532d', color2: '#22c55e', icon: 'fa-table' }
};

// API Helper
async function api(path, options = {}) {
  const defaultOptions = {
    headers: { 'Content-Type': 'application/json' },
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
    
    if (!response.ok) {
      throw new Error(data.error || `Request failed with status ${response.status}`);
    }
    return data;
  } catch (error) {
    console.error(`API [${path}] Error:`, error);
    throw error;
  }
}

// App Initialization
document.addEventListener('DOMContentLoaded', async () => {
  loadTheme();
  loadCart();
  initFilters();
  initNavigation();
  initSearch();
  initFAQ();
  initContact();
  initBundleActions();
  initReviewsCarousel();
  initCouponListeners();
  
  await Promise.all([
    fetchBooks(),
    fetchBundle(),
    fetchReviews(),
    fetchSettings()
  ]);
});

// Dynamic Settings Fetching & DOM Hydration
async function fetchSettings() {
  try {
    const data = await api('/api/settings');
    if (!data) return;
    state.settings = data;
    applySettingsToDOM(data);
  } catch (err) {
    console.warn('Could not fetch dynamic settings:', err);
  }
}

function applySettingsToDOM(settings) {
  if (!settings) return;
  const { contact, social } = settings;

  if (contact) {
    const waPhone = (contact.whatsapp || '+91 7808202338').replace(/[^0-9]/g, '');
    const waMsg = contact.whatsapp_message || 'Hello CodeLibrary Support, I need help with my eBook/order.';
    const waUrl = contact.whatsapp_url || `https://wa.me/${waPhone}?text=${encodeURIComponent(waMsg)}`;

    // Update all WhatsApp links across the page
    document.querySelectorAll('a[href*="wa.me"]').forEach(link => {
      link.href = waUrl;
    });

    // Update Contact section elements
    const waEl = document.getElementById('contact-info-whatsapp');
    if (waEl) {
      waEl.textContent = (contact.whatsapp || '+91 7808202338') + ' →';
      waEl.href = waUrl;
    }

    const emailEl = document.getElementById('contact-info-email');
    if (emailEl && contact.support_email) {
      emailEl.textContent = contact.support_email;
      emailEl.href = `mailto:${contact.support_email}`;
    }
  }

  if (social) {
    renderSocialMediaLinks(social);
  }
}

function renderSocialMediaLinks(social) {
  const container = document.getElementById('footer-social-links');
  if (!container || !social) return;

  const socialMeta = {
    whatsapp: { icon: 'fab fa-whatsapp', color: '#25D366', label: 'WhatsApp' },
    instagram: { icon: 'fab fa-instagram', color: '#E1306C', label: 'Instagram' },
    facebook: { icon: 'fab fa-facebook', color: '#1877F2', label: 'Facebook' },
    youtube: { icon: 'fab fa-youtube', color: '#FF0000', label: 'YouTube' },
    twitter: { icon: 'fab fa-x-twitter', color: 'var(--text-primary)', label: 'X (Twitter)' },
    telegram: { icon: 'fab fa-telegram', color: '#26A5E4', label: 'Telegram' },
    linkedin: { icon: 'fab fa-linkedin', color: '#0A66C2', label: 'LinkedIn' },
    pinterest: { icon: 'fab fa-pinterest', color: '#E60023', label: 'Pinterest' },
    discord: { icon: 'fab fa-discord', color: '#5865F2', label: 'Discord' }
  };

  const activeLinks = [];
  for (const [key, item] of Object.entries(social)) {
    if (item && item.enabled && item.url && item.url.trim()) {
      const meta = socialMeta[key] || { icon: 'fas fa-link', color: 'var(--accent-blue)', label: key };
      activeLinks.push(`
        <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(meta.label)}" aria-label="${escapeHtml(meta.label)}" style="display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 50%; background: var(--bg-card); border: 1px solid var(--border); color: ${meta.color}; font-size: 1.1rem; text-decoration: none;">
          <i class="${meta.icon}"></i>
        </a>
      `);
    }
  }

  container.innerHTML = activeLinks.join('');
}

// Theme Management
function loadTheme() {
  const saved = localStorage.getItem('codelibrary_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcon(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('codelibrary_theme', next);
  updateThemeIcon(next);
}

function updateThemeIcon(theme) {
  const icon = document.querySelector('#btn-theme-toggle i');
  if (icon) {
    icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
  }
}

document.getElementById('btn-theme-toggle')?.addEventListener('click', toggleTheme);

// Data Fetching
async function fetchBooks() {
  try {
    const data = await api('/api/books');
    state.books = Array.isArray(data) ? data : [];
    renderBooks();
    renderBundle();
  } catch (err) {
    console.error('Failed to load books:', err);
    const grid = document.getElementById('books-grid');
    if (grid) {
      grid.innerHTML = '<div class="error-state"><p>Could not load books. Please check server connection.</p></div>';
    }
  }
}

async function fetchBundle() {
  try {
    let data;
    try {
      data = await api('/api/bundles/complete-programming-bundle');
    } catch (e) {
      const all = await api('/api/bundles');
      if (Array.isArray(all) && all.length > 0) {
        data = all.find(b => b.slug === 'complete-programming-bundle') || all[0];
      }
    }
    if (data) {
      state.bundle = data;
      renderBundle();
    }
  } catch (err) {
    console.warn('Could not fetch bundle details:', err);
  }
}

function renderBundle() {
  if (!state.bundle || state.bundle.price == null) return;
  const bundlePriceFormatted = formatCurrency(state.bundle.price);

  // 1. Home page bundle / collection amount
  const heroBundlePriceEl = document.getElementById('hero-bundle-price');
  if (heroBundlePriceEl) {
    heroBundlePriceEl.textContent = bundlePriceFormatted;
  }

  // 2. Bundle page top price & Card Elements
  const bundleCard = document.querySelector('.bundle-card');
  if (bundleCard) {
    const currentPriceEl = bundleCard.querySelector('.current-price');
    if (currentPriceEl) {
      currentPriceEl.textContent = bundlePriceFormatted;
    }

    const oldPriceEl = bundleCard.querySelector('.old-price');
    const saveBadgeEl = bundleCard.querySelector('.save-badge');
    if (oldPriceEl && Array.isArray(state.books) && state.books.length > 0) {
      const totalOriginal = state.books.reduce((acc, b) => acc + (b.price || 0), 0);
      if (totalOriginal > 0) {
        oldPriceEl.textContent = formatCurrency(totalOriginal);
        if (saveBadgeEl && state.bundle.price != null) {
          const discountPercent = Math.max(0, Math.round(((totalOriginal - state.bundle.price) / totalOriginal) * 100));
          saveBadgeEl.textContent = `Save ${discountPercent}%`;
        }
      }
    }

    const bundleTitleEl = bundleCard.querySelector('.bundle-title');
    if (bundleTitleEl && state.bundle.title) {
      bundleTitleEl.textContent = state.bundle.title;
    }

    // 3. Bundle page bottom / CTA price
    const bundleCtaPriceEl = document.getElementById('bundle-cta-price');
    if (bundleCtaPriceEl) {
      bundleCtaPriceEl.textContent = `• ${bundlePriceFormatted}`;
    }
  }

  // Sync any active cart items to current bundle price (4. Cart & 5. Checkout)
  syncCartWithLivePrices();
}

function syncCartWithLivePrices() {
  if (!state.cart || state.cart.length === 0) return;
  let changed = false;
  state.cart.forEach(item => {
    const isBundle = item.type === 'bundle' || item.id === 'bundle' || item.slug === 'complete-programming-bundle' || (state.bundle && item.id === state.bundle.id);
    if (isBundle && state.bundle && state.bundle.price != null) {
      if (item.price !== state.bundle.price || (state.bundle.title && item.title !== state.bundle.title)) {
        item.price = state.bundle.price;
        if (state.bundle.title) item.title = state.bundle.title;
        changed = true;
      }
    }
  });
  if (changed) {
    localStorage.setItem('codelibrary_cart', JSON.stringify(state.cart));
    renderCart();
  }
}

async function fetchReviews() {
  try {
    const data = await api('/api/reviews');
    state.reviews = Array.isArray(data) ? data : [];
    renderReviews();
  } catch (err) {
    console.warn('Could not fetch reviews:', err);
  }
}

window.state = state;

// Rendering Books Grid
function renderBooks() {
  const grid = document.getElementById('books-grid');
  if (!grid) return;

  if (!state.activeFilter) {
    state.activeFilter = 'all';
  }

  const activeFilter = state.activeFilter.toLowerCase().trim();

  // Sync category filter buttons visual active state
  const filterBtns = document.querySelectorAll('.filter-btn');
  if (filterBtns.length > 0) {
    filterBtns.forEach(btn => {
      const btnFilter = (btn.getAttribute('data-filter') || '').toLowerCase().trim();
      btn.classList.toggle('active', btnFilter === activeFilter);
    });
  }

  const filtered = state.books.filter(b => {
    const bookCategory = (b.category || '').toLowerCase().trim();
    const matchesCategory = activeFilter === 'all' || activeFilter === '' || bookCategory === activeFilter;
    const q = (state.searchQuery || '').toLowerCase().trim();
    const matchesSearch = !q || 
      (b.title && b.title.toLowerCase().includes(q)) || 
      (bookCategory && bookCategory.includes(q)) || 
      (b.short_description && b.short_description.toLowerCase().includes(q));
    return matchesCategory && matchesSearch;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-results" style="grid-column: 1/-1; text-align: center; padding: 3rem 1rem;">
        <i class="fas fa-search" style="font-size: 2.5rem; opacity: 0.4; margin-bottom: 1rem;"></i>
        <h3>No programming eBooks match your search</h3>
        <p>Try searching for another programming language, topic, or resetting category filters.</p>
        <button class="btn btn-secondary mt-4" onclick="resetFilters()">Reset All Filters</button>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(book => {
    const meta = categoryMeta[book.category] || { color1: '#1e293b', color2: '#3b82f6', icon: 'fa-book' };
    const priceDisplay = `₹${(book.price / 100).toFixed(0)}`;
    const ratingDisplay = (book.rating || 4.8).toFixed(1);
    const inCart = state.cart.some(item => item.id === book.id || item.slug === book.slug);
    const coverUrl = book.cover_image || book.cover;

    const coverHtml = coverUrl ? `
      <div class="book-cover-wrap">
        <img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(book.title)}" class="book-cover-img" onerror="this.parentElement.innerHTML='<div class=\\'book-cover-placeholder\\' style=\\'background: linear-gradient(135deg, ${meta.color1}, ${meta.color2});\\'><div class=\\'book-cover-icon\\'><i class=\\'fas ${meta.icon}\\'></i></div><div class=\\'book-cover-title\\'>${escapeHtml(book.title)}</div><div class=\\'book-cover-badge\\'>CodeLibrary</div></div>'">
      </div>
    ` : `
      <div class="book-cover-placeholder" style="background: linear-gradient(135deg, ${meta.color1}, ${meta.color2});">
        <div class="book-cover-icon"><i class="fas ${meta.icon}"></i></div>
        <div class="book-cover-title">${escapeHtml(book.title)}</div>
        <div class="book-cover-badge">CodeLibrary</div>
      </div>
    `;

    return `
      <div class="book-card" data-id="${escapeHtml(book.id)}" data-slug="${escapeHtml(book.slug)}">
        ${coverHtml}
        <div class="book-info">
          <div class="book-category-tag">${formatCategory(book.category)}</div>
          <h3 class="book-title">${escapeHtml(book.title)}</h3>
          <div class="book-meta-row">
            <div class="book-rating"><i class="fas fa-star"></i> <span>${ratingDisplay}</span></div>
            <div class="book-price">${priceDisplay}</div>
          </div>
          <p class="book-desc-short">${escapeHtml(book.short_description || '')}</p>
          <div class="book-actions">
            <button class="btn btn-secondary btn-sm" data-action="view-details" data-slug="${escapeHtml(book.slug)}" data-id="${escapeHtml(book.id)}">
              <i class="fas fa-info-circle"></i> View Details
            </button>
            <button class="btn btn-primary btn-sm ${inCart ? 'in-cart' : ''}" data-action="add-to-cart" data-id="${escapeHtml(book.id)}">
              <i class="fas ${inCart ? 'fa-check' : 'fa-cart-plus'}"></i> ${inCart ? 'In Cart' : 'Add to Cart'}
            </button>
          </div>
          <button class="btn btn-outline btn-block btn-buy-direct" data-action="buy-now" data-id="${escapeHtml(book.id)}">
            Get This eBook &rarr;
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Book Detail Modal
window.openBookDetail = async function(slugOrId) {
  if (!slugOrId) return;
  try {
    const book = await api(`/api/books/${slugOrId}`);
    if (!book) return;

    const meta = categoryMeta[book.category] || { color1: '#1e293b', color2: '#3b82f6', icon: 'fa-book' };
    const priceDisplay = `₹${(book.price / 100).toFixed(0)}`;
    const ratingDisplay = (book.rating || 4.8).toFixed(1);
    const learnList = Array.isArray(book.what_you_learn) ? book.what_you_learn : [];
    const topicsList = Array.isArray(book.topics) ? book.topics : [];
    const coverUrl = book.cover_image || book.cover;

    const detailCoverHtml = coverUrl ? `
      <div class="book-detail-cover-wrap">
        <img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(book.title)}" class="book-detail-cover-img" onerror="this.parentElement.innerHTML='<div class=\\'book-cover-placeholder large\\' style=\\'background: linear-gradient(135deg, ${meta.color1}, ${meta.color2});\\'><div class=\\'book-cover-icon\\'><i class=\\'fas ${meta.icon}\\'></i></div><div class=\\'book-cover-title\\'>${escapeHtml(book.title)}</div><div class=\\'book-cover-badge\\'>Official Edition</div></div>'">
      </div>
    ` : `
      <div class="book-cover-placeholder large" style="background: linear-gradient(135deg, ${meta.color1}, ${meta.color2});">
        <div class="book-cover-icon"><i class="fas ${meta.icon}"></i></div>
        <div class="book-cover-title">${escapeHtml(book.title)}</div>
        <div class="book-cover-badge">Official Edition</div>
      </div>
    `;

    const body = document.getElementById('book-detail-body');
    body.innerHTML = `
      <div class="book-detail-layout">
        <div class="book-detail-visual">
          ${detailCoverHtml}
        </div>
        <div class="book-detail-info">
          <div class="book-category-tag">${formatCategory(book.category)}</div>
          <h2 class="book-detail-title">${escapeHtml(book.title)}</h2>
          
          <div class="book-detail-pricing-row">
            <div class="book-price large">${priceDisplay}</div>
            <div class="book-rating"><i class="fas fa-star"></i> <strong>${ratingDisplay} / 5.0</strong> (Verified Rating)</div>
          </div>

          <p class="book-full-desc">${escapeHtml(book.description || book.short_description || '')}</p>

          ${learnList.length > 0 ? `
            <div class="detail-section">
              <h4><i class="fas fa-check-circle"></i> What You Will Learn</h4>
              <ul class="learn-list">
                ${learnList.map(item => `<li><i class="fas fa-arrow-right"></i> ${escapeHtml(item)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}

          ${topicsList.length > 0 ? `
            <div class="detail-section">
              <h4><i class="fas fa-list-ul"></i> Topics Covered</h4>
              <div class="topics-tags">
                ${topicsList.map(t => `<span class="topic-tag">${escapeHtml(t)}</span>`).join('')}
              </div>
            </div>
          ` : ''}

          <div class="detail-actions">
            <button class="btn btn-secondary btn-large" data-action="add-to-cart" data-id="${escapeHtml(book.id)}" onclick="addToCart('${escapeHtml(book.id)}', 'book'); closeModals();">
              <i class="fas fa-cart-plus"></i> Add to Cart
            </button>
            <button class="btn btn-primary btn-large btn-glow" data-action="buy-now" data-id="${escapeHtml(book.id)}" onclick="buyNow('${escapeHtml(book.id)}', 'book')">
              Buy Now &rarr;
            </button>
          </div>
        </div>
      </div>
    `;

    openModal('book-detail-modal');
  } catch (err) {
    showToast('Failed to load book details', 'error');
  }
};

// Filter Management
function initFilters() {
  state.activeFilter = (state.activeFilter || 'all').toLowerCase().trim();
  const filterBtns = document.querySelectorAll('.filter-btn');
  filterBtns.forEach(btn => {
    const btnFilter = (btn.getAttribute('data-filter') || '').toLowerCase().trim();
    btn.classList.toggle('active', btnFilter === state.activeFilter);
    btn.addEventListener('click', (e) => {
      const targetBtn = e.target.closest('.filter-btn') || e.target;
      filterBtns.forEach(b => b.classList.remove('active'));
      targetBtn.classList.add('active');
      state.activeFilter = (targetBtn.getAttribute('data-filter') || 'all').toLowerCase().trim();
      renderBooks();
    });
  });

  const searchInput = document.getElementById('catalog-search-input');
  const clearBtn = document.getElementById('catalog-search-clear');
  
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      if (clearBtn) {
        clearBtn.style.display = state.searchQuery ? 'block' : 'none';
      }
      renderBooks();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      state.searchQuery = '';
      clearBtn.style.display = 'none';
      renderBooks();
    });
  }
}

window.filterCategory = function(cat) {
  state.activeFilter = cat;
  const buttons = document.querySelectorAll('.filter-btn');
  buttons.forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-filter') === cat);
  });
  renderBooks();
  const target = document.getElementById('ebooks');
  if (target) {
    window.scrollTo({ top: target.offsetTop - 70, behavior: 'smooth' });
  }
};

window.resetFilters = function() {
  state.activeFilter = 'all';
  state.searchQuery = '';
  const searchInput = document.getElementById('catalog-search-input');
  if (searchInput) searchInput.value = '';
  const buttons = document.querySelectorAll('.filter-btn');
  buttons.forEach(b => b.classList.toggle('active', b.getAttribute('data-filter') === 'all'));
  renderBooks();
};

// Search Modal Overlay
function initSearch() {
  const openBtn = document.getElementById('btn-search-open');
  const searchInput = document.getElementById('search-input');
  const resultsContainer = document.getElementById('search-results');

  if (openBtn) {
    openBtn.addEventListener('click', () => {
      openModal('search-modal');
      setTimeout(() => searchInput?.focus(), 100);
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      if (!q) {
        resultsContainer.innerHTML = '<p class="text-secondary text-center">Type a language (e.g. Python, React, Java) or topic...</p>';
        return;
      }

      const matches = state.books.filter(b => 
        b.title.toLowerCase().includes(q) ||
        (b.category && b.category.toLowerCase().includes(q)) ||
        (b.short_description && b.short_description.toLowerCase().includes(q))
      );

      if (matches.length === 0) {
        resultsContainer.innerHTML = '<p class="text-secondary text-center">No matching programming eBooks found.</p>';
        return;
      }

      resultsContainer.innerHTML = matches.map(b => `
        <div class="search-result-item" onclick="closeModals(); openBookDetail('${b.slug}')">
          <div class="result-title">${escapeHtml(b.title)}</div>
          <div class="result-meta">${formatCategory(b.category)} • <strong>₹${(b.price / 100).toFixed(0)}</strong></div>
        </div>
      `).join('');
    });
  }
}

// Cart Functionality
function loadCart() {
  try {
    const saved = localStorage.getItem('codelibrary_cart');
    state.cart = saved ? JSON.parse(saved) : [];
  } catch (e) {
    state.cart = [];
  }
  updateCartBadge();
}

function saveCart() {
  localStorage.setItem('codelibrary_cart', JSON.stringify(state.cart));
  updateCartBadge();
  renderCart();
  renderBooks();
}

window.addToCart = async function(id, type = 'book') {
  if (type === 'bundle') {
    if (!state.bundle || state.bundle.price == null) {
      await fetchBundle();
    }
    // If bundle is added, replace individual books with bundle to save money
    state.cart = [{
      id: state.bundle?.id || 'bundle',
      type: 'bundle',
      slug: state.bundle?.slug || 'complete-programming-bundle',
      title: state.bundle?.title || 'Complete Programming Bundle (All 19 eBooks)',
      price: state.bundle?.price != null ? state.bundle.price : 0
    }];
    showToast('Complete Programming Bundle added to cart!', 'success');
  } else {
    // Check if bundle is already in cart
    if (state.cart.some(i => i.type === 'bundle')) {
      showToast('You already have the Complete Bundle in cart, which includes this book!', 'info');
      return;
    }

    const book = state.books.find(b => b.id === id || b.slug === id);
    if (!book) return;

    // Check duplicate
    if (state.cart.some(i => i.id === book.id || i.slug === book.slug)) {
      showToast('This eBook is already in your cart.', 'info');
      return;
    }

    state.cart.push({
      id: book.id,
      type: 'book',
      slug: book.slug,
      title: book.title,
      price: book.price,
      category: book.category,
      cover_image: book.cover_image || book.cover
    });
    showToast(`"${book.title}" added to cart!`, 'success');
  }

  saveCart();
};

window.removeFromCart = async function(id) {
  state.cart = state.cart.filter(item => item.id !== id);
  if (state.cart.length === 0) {
    state.appliedCoupon = null;
  } else if (state.appliedCoupon) {
    await recalculateAppliedCoupon();
  }
  saveCart();
  showToast('Item removed from cart', 'info');
};

async function recalculateAppliedCoupon() {
  if (!state.appliedCoupon || state.cart.length === 0) return;
  try {
    const res = await api('/api/payment/validate-coupon', {
      method: 'POST',
      body: {
        code: state.appliedCoupon.code,
        items: state.cart
      }
    });
    if (res.valid) {
      state.appliedCoupon = res;
    } else {
      state.appliedCoupon = null;
      showCouponMessage(`Coupon removed: ${res.message || 'Criteria no longer met'}`, 'error');
    }
  } catch (err) {
    state.appliedCoupon = null;
  }
}

function updateCartBadge() {
  const badge = document.getElementById('cart-badge-count');
  if (badge) {
    badge.textContent = state.cart.length;
    badge.style.display = state.cart.length > 0 ? 'flex' : 'none';
  }
}

window.showCart = function() {
  renderCart();
  openModal('cart-modal');
};

document.getElementById('btn-cart-open')?.addEventListener('click', window.showCart);

function renderCart() {
  const container = document.getElementById('cart-items');
  const subtotalEl = document.getElementById('cart-subtotal-price');
  const discountLine = document.getElementById('cart-discount-line');
  const discountAmountEl = document.getElementById('cart-discount-amount');
  const totalEl = document.getElementById('cart-total-price');
  const couponInputContainer = document.getElementById('coupon-input-container');
  const couponAppliedBadge = document.getElementById('coupon-applied-badge');
  const appliedCodeEl = document.getElementById('applied-coupon-code');
  const appliedSavedEl = document.getElementById('applied-coupon-saved');

  if (!container) return;

  if (state.cart.length === 0) {
    state.appliedCoupon = null;
    container.innerHTML = `
      <div class="empty-cart">
        <i class="fas fa-shopping-bag"></i>
        <p>Your shopping cart is empty.</p>
        <button class="btn btn-secondary btn-sm mt-4" onclick="closeModals(); window.location.href='#ebooks';">Browse eBooks</button>
      </div>
    `;
    if (subtotalEl) subtotalEl.textContent = '₹0';
    if (discountLine) discountLine.style.display = 'none';
    if (totalEl) totalEl.textContent = '₹0';
    if (couponInputContainer) couponInputContainer.style.display = 'flex';
    if (couponAppliedBadge) couponAppliedBadge.style.display = 'none';
    return;
  }

  let subtotalPaise = 0;
  container.innerHTML = state.cart.map(item => {
    subtotalPaise += item.price;
    const priceStr = `₹${(item.price / 100).toFixed(0)}`;
    return `
      <div class="cart-item">
        <div class="cart-item-info">
          <div class="cart-item-title">${escapeHtml(item.title)}</div>
          <div class="cart-item-badge">${item.type === 'bundle' ? '19 eBooks Bundle' : 'Single eBook'}</div>
          <div class="cart-item-price">${priceStr}</div>
        </div>
        <button class="cart-remove-btn" onclick="removeFromCart('${item.id}')" aria-label="Remove Item" title="Remove">
          <i class="fas fa-trash-alt"></i>
        </button>
      </div>
    `;
  }).join('');

  if (subtotalEl) subtotalEl.textContent = `₹${(subtotalPaise / 100).toFixed(0)}`;

  let discountPaise = 0;
  if (state.appliedCoupon && state.appliedCoupon.valid) {
    discountPaise = state.appliedCoupon.discount_amount || 0;
    if (discountLine) discountLine.style.display = 'flex';
    if (discountAmountEl) discountAmountEl.textContent = `-₹${(discountPaise / 100).toFixed(0)}`;
    if (couponInputContainer) couponInputContainer.style.display = 'none';
    if (couponAppliedBadge) {
      couponAppliedBadge.style.display = 'flex';
      if (appliedCodeEl) appliedCodeEl.textContent = state.appliedCoupon.code;
      if (appliedSavedEl) appliedSavedEl.textContent = `Saved ₹${(discountPaise / 100).toFixed(0)}`;
    }
  } else {
    if (discountLine) discountLine.style.display = 'none';
    if (couponInputContainer) couponInputContainer.style.display = 'flex';
    if (couponAppliedBadge) couponAppliedBadge.style.display = 'none';
  }

  const finalPaise = Math.max(0, subtotalPaise - discountPaise);
  if (totalEl) totalEl.textContent = `₹${(finalPaise / 100).toFixed(0)}`;
}

// Coupon Actions
window.applyCoupon = async function() {
  const input = document.getElementById('cart-coupon-input');
  const btn = document.getElementById('btn-apply-coupon');
  
  if (!input) return;
  const code = (input.value || '').trim().toUpperCase();
  if (!code) {
    showCouponMessage('Please enter a coupon code', 'error');
    return;
  }

  if (!state.cart || state.cart.length === 0) {
    showCouponMessage('Add items to cart before applying coupon', 'error');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Applying...';
  }

  try {
    const res = await api('/api/payment/validate-coupon', {
      method: 'POST',
      body: {
        code,
        items: state.cart
      }
    });

    if (res.valid) {
      state.appliedCoupon = res;
      showCouponMessage(`Coupon "${code}" applied successfully!`, 'success');
      showToast(`Coupon "${code}" applied! You saved ₹${(res.discount_amount / 100).toFixed(0)}`, 'success');
      renderCart();
    } else {
      state.appliedCoupon = null;
      showCouponMessage(res.message || 'Invalid coupon code', 'error');
      renderCart();
    }
  } catch (err) {
    state.appliedCoupon = null;
    showCouponMessage(err.message || 'Failed to apply coupon', 'error');
    renderCart();
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Apply';
    }
  }
};

window.removeCoupon = function() {
  state.appliedCoupon = null;
  const input = document.getElementById('cart-coupon-input');
  if (input) input.value = '';
  const msgEl = document.getElementById('coupon-message');
  if (msgEl) {
    msgEl.textContent = '';
    msgEl.style.display = 'none';
  }
  showToast('Coupon removed', 'info');
  renderCart();
};

function showCouponMessage(msg, type = 'error') {
  const msgEl = document.getElementById('coupon-message');
  if (!msgEl) return;
  msgEl.textContent = msg;
  msgEl.className = `coupon-status-msg ${type}`;
  msgEl.style.display = 'block';
}

function initCouponListeners() {
  document.getElementById('btn-apply-coupon')?.addEventListener('click', window.applyCoupon);
  document.getElementById('cart-coupon-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      window.applyCoupon();
    }
  });
  document.getElementById('btn-remove-coupon')?.addEventListener('click', window.removeCoupon);
}

// Checkout & Razorpay Integration
document.getElementById('btn-cart-checkout')?.addEventListener('click', () => {
  if (state.cart.length === 0) {
    showToast('Your cart is empty', 'warning');
    return;
  }
  executeCheckout();
});

window.buyNow = async function(id, type = 'book') {
  if (type === 'bundle') {
    if (!state.bundle || state.bundle.price == null) {
      await fetchBundle();
    }
    state.cart = [{
      id: state.bundle?.id || 'bundle',
      type: 'bundle',
      slug: state.bundle?.slug || 'complete-programming-bundle',
      title: state.bundle?.title || 'Complete Programming Bundle (All 19 eBooks)',
      price: state.bundle?.price != null ? state.bundle.price : 0
    }];
  } else {
    const book = state.books.find(b => b.id === id || b.slug === id);
    if (book) {
      if (!state.cart.some(i => i.id === book.id || i.slug === book.slug)) {
        state.cart.push({
          id: book.id,
          type: 'book',
          slug: book.slug,
          title: book.title,
          price: book.price,
          category: book.category,
          cover_image: book.cover_image || book.cover
        });
      }
    }
  }
  saveCart();
  renderCart();
  closeModals();
  openModal('cart-modal');
  
  // Focus name input for convenient customer entry
  setTimeout(() => {
    document.getElementById('checkout-name')?.focus();
  }, 200);
};

// Global Delegated Click Listeners
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const id = btn.dataset.id;
  const slug = btn.dataset.slug;

  if (action === 'view-details') {
    e.preventDefault();
    window.openBookDetail(slug || id);
  } else if (action === 'add-to-cart') {
    e.preventDefault();
    window.addToCart(id || slug, 'book');
  } else if (action === 'buy-now') {
    e.preventDefault();
    window.buyNow(id || slug, 'book');
  } else if (action === 'add-bundle-cart') {
    e.preventDefault();
    window.addToCart(state.bundle?.id || 'bundle', 'bundle');
  } else if (action === 'buy-bundle') {
    e.preventDefault();
    window.buyNow(state.bundle?.id || 'bundle', 'bundle');
  }
});

async function executeCheckout() {
  const nameInput = document.getElementById('checkout-name');
  const emailInput = document.getElementById('checkout-email');
  const phoneInput = document.getElementById('checkout-phone');

  const customerName = nameInput ? nameInput.value.trim() : '';
  const customerEmail = emailInput ? emailInput.value.trim() : '';
  const customerPhone = phoneInput ? phoneInput.value.trim() : '';

  if (!customerName) {
    showToast('Please enter your Full Name to proceed', 'warning');
    nameInput?.focus();
    return;
  }

  if (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    showToast('Please enter a valid Email Address for your eBook delivery', 'warning');
    emailInput?.focus();
    return;
  }

  if (!customerPhone || customerPhone.length < 6) {
    showToast('Please enter your Mobile Number', 'warning');
    phoneInput?.focus();
    return;
  }

  const btn = document.getElementById('btn-cart-checkout');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Initializing Payment...';
  }

  try {
    const firstItem = state.cart[0];
    const product_type = state.cart.length === 1 ? firstItem.type : 'cart';
    const product_id = state.cart.length === 1 ? firstItem.id : 'cart';

    const orderData = await api('/api/payment/create-order', {
      method: 'POST',
      body: {
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
        product_type,
        product_id,
        coupon_code: state.appliedCoupon ? state.appliedCoupon.code : null,
        items: state.cart
      }
    });

    // Launch Razorpay
    if (typeof Razorpay !== 'undefined' && orderData.razorpay_key_id && !orderData.razorpay_key_id.includes('xxxx') && !orderData.razorpay_key_id.includes('placeholder')) {
      const options = {
        key: orderData.razorpay_key_id,
        amount: orderData.amount,
        currency: 'INR',
        name: 'CodeLibrary',
        description: orderData.description,
        order_id: orderData.razorpay_order_id,
        handler: async function (response) {
          await verifyAndCompleteOrder(response, orderData.order_id);
        },
        prefill: {
          name: customerName,
          email: customerEmail,
          contact: customerPhone
        },
        theme: {
          color: '#3b82f6'
        },
        modal: {
          ondismiss: function() {
            if (btn) {
              btn.disabled = false;
              btn.innerHTML = 'Proceed to Pay &rarr;';
            }
          }
        }
      };
      const rzp = new Razorpay(options);
      rzp.open();
    } else {
      // Test mode / Simulated secure verification
      setTimeout(async () => {
        const dummyResponse = {
          razorpay_order_id: orderData.razorpay_order_id,
          razorpay_payment_id: `pay_test_${Date.now()}`,
          razorpay_signature: 'test_signature_valid'
        };
        await verifyAndCompleteOrder(dummyResponse, orderData.order_id);
      }, 800);
    }
  } catch (err) {
    showToast(err.message || 'Payment initialization failed', 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'Proceed to Pay &rarr;';
    }
  }
}

async function verifyAndCompleteOrder(paymentResponse, clientOrderId) {
  try {
    const verifyResult = await api('/api/payment/verify', {
      method: 'POST',
      body: {
        razorpay_order_id: paymentResponse.razorpay_order_id,
        razorpay_payment_id: paymentResponse.razorpay_payment_id,
        razorpay_signature: paymentResponse.razorpay_signature,
        order_id: clientOrderId
      }
    });

    if (verifyResult.success) {
      // Clear shopping cart
      state.cart = [];
      state.appliedCoupon = null;
      saveCart();
      renderCart();
      closeModals();

      // Populate Order Success Modal
      document.getElementById('success-order-id').textContent = verifyResult.order_id;
      document.getElementById('success-customer-name').textContent = verifyResult.customer_name || 'Customer';
      document.getElementById('success-customer-email').textContent = verifyResult.customer_email || 'Email on file';
      document.getElementById('success-amount-paid').textContent = `₹${((verifyResult.amount || 0) / 100).toFixed(2)}`;

      const invoiceBtn = document.getElementById('btn-success-invoice');
      if (invoiceBtn && verifyResult.invoice_url) {
        invoiceBtn.href = verifyResult.invoice_url;
      }

      // Populate Download items list
      const itemsListContainer = document.getElementById('success-items-list');
      if (itemsListContainer) {
        const items = verifyResult.items || [];
        if (items.length === 0) {
          itemsListContainer.innerHTML = '<p style="color: var(--text-secondary); font-size: 0.85rem;">eBook access unlocked.</p>';
        } else {
          itemsListContainer.innerHTML = items.map(item => `
            <div style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-secondary); border: 1px solid var(--border); padding: 0.85rem 1rem; border-radius: 8px;">
              <div>
                <div style="font-weight: 700; color: var(--text-primary); font-size: 0.95rem;">${escapeHtml(item.title)}</div>
                <div style="font-size: 0.8rem; color: var(--text-secondary);"><i class="fas fa-file-pdf" style="color: #ef4444;"></i> Digital PDF Edition</div>
              </div>
              <a href="${escapeHtml(item.download_url)}" target="_blank" class="btn btn-primary btn-sm" style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.45rem 0.9rem; font-size: 0.85rem;">
                <i class="fas fa-download"></i> Download eBook
              </a>
            </div>
          `).join('');
        }
      }

      openModal('thankyou-modal');
      showToast('🎉 Payment verified! Your eBooks and invoice are ready.', 'success');
    }
  } catch (err) {
    showToast(err.message || 'Payment verification failed', 'error');
  } finally {
    const btn = document.getElementById('btn-cart-checkout');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'Proceed to Pay &rarr;';
    }
  }
}

// Bundle Section Actions
function initBundleActions() {
  document.getElementById('btn-buy-bundle')?.addEventListener('click', () => {
    buyNow(state.bundle?.id || 'bundle', 'bundle');
  });

  document.getElementById('btn-add-bundle-cart')?.addEventListener('click', () => {
    addToCart(state.bundle?.id || 'bundle', 'bundle');
  });
}

// Reviews Carousel
function initReviewsCarousel() {
  document.getElementById('review-prev')?.addEventListener('click', () => {
    navigateReview(-1);
  });
  document.getElementById('review-next')?.addEventListener('click', () => {
    navigateReview(1);
  });
}

function renderReviews() {
  const track = document.getElementById('reviews-track');
  const dotsContainer = document.getElementById('review-dots');
  if (!track || state.reviews.length === 0) return;

  track.innerHTML = state.reviews.map(r => `
    <div class="review-card">
      <div class="review-stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</div>
      <p class="review-text">"${escapeHtml(r.review)}"</p>
      <div class="review-author">
        <div class="author-avatar"><i class="fas fa-user"></i></div>
        <div class="author-name">${escapeHtml(r.name)}</div>
      </div>
    </div>
  `).join('');

  if (dotsContainer) {
    dotsContainer.innerHTML = state.reviews.map((_, i) => `
      <span class="carousel-dot ${i === 0 ? 'active' : ''}" onclick="goToReview(${i})"></span>
    `).join('');
  }

  updateReviewCarouselPosition();
}

function navigateReview(direction) {
  if (state.reviews.length === 0) return;
  state.currentReviewIndex = (state.currentReviewIndex + direction + state.reviews.length) % state.reviews.length;
  updateReviewCarouselPosition();
}

window.goToReview = function(index) {
  state.currentReviewIndex = index;
  updateReviewCarouselPosition();
};

function updateReviewCarouselPosition() {
  const track = document.getElementById('reviews-track');
  if (!track) return;
  track.style.transform = `translateX(-${state.currentReviewIndex * 100}%)`;

  const dots = document.querySelectorAll('.carousel-dot');
  dots.forEach((dot, idx) => {
    dot.classList.toggle('active', idx === state.currentReviewIndex);
  });
}

// FAQ Accordion
function initFAQ() {
  const items = document.querySelectorAll('.faq-item');
  items.forEach(item => {
    const question = item.querySelector('.faq-question');
    question.addEventListener('click', () => {
      const isOpen = item.classList.contains('active');
      items.forEach(i => i.classList.remove('active'));
      if (!isOpen) {
        item.classList.add('active');
      }
    });
  });
}

// Contact Form
function initContact() {
  document.getElementById('contact-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('contact-name').value;
    const email = document.getElementById('contact-email').value;
    const message = document.getElementById('contact-message').value;
    const btn = document.getElementById('btn-contact-submit');

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';

    try {
      const res = await api('/api/contact', {
        method: 'POST',
        body: { name, email, message }
      });
      showToast(res.message || 'Message sent successfully!', 'success');
      e.target.reset();
    } catch (err) {
      showToast(err.message || 'Failed to send message', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span>Send Message</span> <i class="fas fa-paper-plane"></i>';
    }
  });
}

// Navigation & Mobile Menu
function initNavigation() {
  const header = document.getElementById('main-header');
  const links = document.querySelectorAll('.nav-links a');

  window.addEventListener('scroll', () => {
    if (window.scrollY > 40) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  });

  // Mobile menu toggle
  const mobileBtn = document.getElementById('btn-mobile-menu');
  const mobileMenu = document.getElementById('mobile-menu');
  const closeMobile = document.querySelector('.close-menu');

  mobileBtn?.addEventListener('click', () => mobileMenu.classList.add('active'));
  closeMobile?.addEventListener('click', () => mobileMenu.classList.remove('active'));

  document.querySelectorAll('.mobile-nav-links a').forEach(a => {
    a.addEventListener('click', () => mobileMenu.classList.remove('active'));
  });
}

// Modal Helpers
function openModal(id) {
  closeModals();
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.add('active');
    document.body.classList.add('modal-open');
  }
}

window.closeModals = function() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  document.body.classList.remove('modal-open');
};

document.querySelectorAll('.close-modal').forEach(btn => {
  btn.addEventListener('click', window.closeModals);
});

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) window.closeModals();
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.closeModals();
});

// Legal Policies Modal
window.showLegalModal = function(type) {
  const titleEl = document.getElementById('legal-modal-title');
  const bodyEl = document.getElementById('legal-modal-body');

  const policies = {
    terms: {
      title: 'Terms & Conditions',
      content: `
        <p>By purchasing and downloading digital eBooks from CodeLibrary, you agree to the following terms:</p>
        <ul>
          <li>All eBooks are copyrighted materials intended solely for personal educational use.</li>
          <li>Redistribution, public sharing, reproduction, or resale without written permission is strictly prohibited.</li>
          <li>Purchasing grants lifetime non-exclusive digital access for personal learning on your devices.</li>
        </ul>
      `
    },
    privacy: {
      title: 'Privacy Policy',
      content: `
        <p>CodeLibrary respects your privacy and is committed to protecting your personal data:</p>
        <ul>
          <li>We collect your name and email address strictly to deliver and manage your eBook licenses and access tokens.</li>
          <li>We never sell, rent, or trade your personal data to third parties.</li>
          <li>All payments are securely processed through Razorpay PCI-DSS certified infrastructure.</li>
        </ul>
      `
    },
    refund: {
      title: 'Refund Policy',
      content: `
        <p>At CodeLibrary, your satisfaction is our priority:</p>
        <ul>
          <li>Because our products are digital downloads delivered immediately upon purchase, please contact our support team at support@codelibrary.in within 7 days of purchase if you encounter technical difficulties with file formatting.</li>
          <li>We guarantee prompt customer assistance and replacement file support.</li>
        </ul>
      `
    }
  };

  const selected = policies[type] || policies.terms;
  titleEl.textContent = selected.title;
  bodyEl.innerHTML = selected.content;
  openModal('legal-modal');
};

// Toast Notifications
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const iconMap = {
    success: 'fa-check-circle',
    error: 'fa-exclamation-circle',
    warning: 'fa-exclamation-triangle',
    info: 'fa-info-circle'
  };

  toast.innerHTML = `
    <i class="fas ${iconMap[type] || 'fa-info-circle'}"></i>
    <span>${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Utility Helpers
function formatCategory(cat) {
  if (!cat) return 'Programming';
  return cat.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

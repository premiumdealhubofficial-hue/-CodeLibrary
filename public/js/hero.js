function initHero() {
  initStandingBooksShowcase();
}

async function initStandingBooksShowcase() {
  const container = document.getElementById('hero-standing-books');
  if (!container) return;

  try {
    let books = [];
    if (window.state && Array.isArray(window.state.books) && window.state.books.length > 0) {
      books = window.state.books;
    } else {
      const res = await fetch('/api/books');
      if (res.ok) books = await res.json();
    }

    if (!Array.isArray(books) || books.length === 0) return;

    // 4 Featured Core Books matching the reference: C, C++, Java, Python
    const targetSlugs = ['c', 'cpp', 'java', 'python'];
    const showcaseBooks = [];

    for (const slug of targetSlugs) {
      const found = books.find(b => b.slug === slug || b.slug.startsWith(slug));
      if (found) showcaseBooks.push(found);
    }

    // Fallback if not all 4 found
    if (showcaseBooks.length < 4) {
      for (const b of books) {
        if (!showcaseBooks.includes(b)) showcaseBooks.push(b);
        if (showcaseBooks.length >= 4) break;
      }
    }

    const categoryGradients = {
      'c': { g: 'linear-gradient(135deg, #1e293b, #334155)', icon: 'fa-c' },
      'cpp': { g: 'linear-gradient(135deg, #1e3a8a, #3b82f6)', icon: 'fa-cube' },
      'java': { g: 'linear-gradient(135deg, #451a03, #d97706)', icon: 'fa-mug-hot' },
      'python': { g: 'linear-gradient(135deg, #064e3b, #10b981)', icon: 'fa-brands fa-python' }
    };

    container.innerHTML = '';
    showcaseBooks.forEach((book, idx) => {
      const el = document.createElement('div');
      el.className = `standing-book-item book-item-${idx + 1}`;
      el.title = `Click to view ${book.title} (₹${(book.price / 100).toFixed(0)})`;

      const coverUrl = book.cover_image || book.cover;
      const grad = categoryGradients[book.slug] || { g: 'linear-gradient(135deg, #1e293b, #3b82f6)', icon: 'fa-book' };

      if (coverUrl) {
        el.innerHTML = `
          <div class="standing-book-cover">
            <img src="${coverUrl}" alt="${book.title}" onerror="this.parentElement.innerHTML='<div class=\\'standing-book-fallback\\' style=\\'background: ${grad.g};\\'><i class=\\'fas ${grad.icon}\\'></i><div class=\\'fallback-title\\'>${book.title}</div></div>'">
          </div>
        `;
      } else {
        el.innerHTML = `
          <div class="standing-book-fallback" style="background: ${grad.g};">
            <i class="fas ${grad.icon}"></i>
            <div class="fallback-title">${book.title}</div>
            <span class="fallback-badge">CodeLibrary</span>
          </div>
        `;
      }

      el.addEventListener('click', () => {
        if (typeof window.openBookDetail === 'function') {
          window.openBookDetail(book.slug || book.id);
        } else {
          window.location.hash = '#ebooks';
        }
      });

      container.appendChild(el);
    });
  } catch (err) {
    console.warn('Hero standing books error:', err);
  }
}

document.addEventListener('DOMContentLoaded', initHero);


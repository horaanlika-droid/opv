/**
 * Сайт книги: загружает content/book.json и строит титул, содержание и главы.
 */
(function () {
  'use strict';

  var contentUrl = 'content/book.json?v=' + Date.now();

  var els = {
    status: document.getElementById('cover-status'),
    kicker: document.getElementById('cover-kicker'),
    title: document.getElementById('cover-title'),
    author: document.getElementById('cover-author'),
    note: document.getElementById('cover-note'),
    cta: document.getElementById('cover-cta'),
    chapters: document.getElementById('chapters'),
    tocNav: document.getElementById('toc-nav'),
    tocFoot: document.getElementById('toc-foot'),
    footerLine: document.getElementById('footer-line'),
    toc: document.getElementById('toc'),
    tocToggle: document.getElementById('toc-toggle'),
    tocBackdrop: document.getElementById('toc-backdrop'),
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function renderBook(book) {
    var meta = book.meta || {};
    var chapters = book.chapters || [];

    // Титул.
    if (meta.title) {
      document.title = meta.title + (meta.author ? ' — ' + meta.author : '');
      els.title.textContent = meta.title;
      var og = document.querySelector('meta[property="og:title"]');
      if (og) og.setAttribute('content', meta.title);
    }
    if (meta.subtitle) {
      els.kicker.textContent = meta.subtitle;
      var md = document.querySelector('meta[name="description"]');
      if (md) md.setAttribute('content', meta.subtitle + (meta.author ? '. ' + meta.author : ''));
    }
    if (meta.author) els.author.textContent = meta.author;
    if (meta.note) els.note.innerHTML = window.MD.render(meta.note);
    if (chapters.length) {
      els.cta.setAttribute('href', '#' + chapters[0].id);
      els.cta.hidden = false;
    }

    // Содержание.
    var tocHtml = '<a class="toc-cover" href="#cover"><span class="n">—</span><span>Титул</span></a>';
    chapters.forEach(function (ch, i) {
      tocHtml +=
        '<a href="#' + esc(ch.id) + '" data-id="' + esc(ch.id) + '">' +
        '<span class="n">' + pad2(i + 1) + '</span>' +
        '<span>' + esc(ch.title) + '</span></a>';
    });
    els.tocNav.innerHTML = tocHtml;
    els.tocFoot.textContent =
      'Глав: ' + chapters.length +
      (meta.updated ? ' · обновлено ' + meta.updated : '');

    // Главы.
    var html = '';
    chapters.forEach(function (ch, i) {
      var prev = chapters[i - 1];
      var next = chapters[i + 1];
      html += '<article class="chapter" id="' + esc(ch.id) + '">';
      html += '<div class="chapter-head">';
      html += '<span class="chapter-num">Глава ' + pad2(i + 1) + '</span>';
      html += '<h2>' + esc(ch.title) + '</h2>';
      html += '</div>';
      if (ch.illustration) {
        html +=
          '<figure class="chapter-illus">' +
          '<img src="assets/illustrations/' + esc(ch.illustration) + '" alt="Иллюстрация: ' + esc(ch.title) + '" loading="lazy">' +
          '<figcaption>Иллюстрация к главе «' + esc(ch.title) + '».</figcaption>' +
          '</figure>';
      }
      html += '<div class="chapter-body">' + window.MD.render(ch.markdown) + '</div>';
      html += '<nav class="pager">';
      if (prev) {
        html += '<a class="prev" href="#' + esc(prev.id) + '"><span class="dir">← Предыдущая</span><span class="pager-label">' + esc(prev.title) + '</span></a>';
      }
      if (next) {
        html += '<a class="next" href="#' + esc(next.id) + '"><span class="dir">Следующая →</span><span class="pager-label">' + esc(next.title) + '</span></a>';
      }
      html += '</nav>';
      html += '</article>';
    });
    els.chapters.innerHTML = html;

    els.footerLine.textContent =
      (meta.title || 'Книга') + (meta.author ? ' · ' + meta.author : '') +
      (meta.updated ? ' · обновлено ' + meta.updated : '');

    els.status.hidden = true;

    setupScrollSpy();
    scrollToHash();
  }

  function showError(message) {
    els.status.className = 'cover-status error';
    els.status.innerHTML = message;
    els.cta.hidden = true;
  }

  function scrollToHash() {
    var id = decodeURIComponent((location.hash || '').replace(/^#/, ''));
    if (!id || id === 'cover') return;
    var target = document.getElementById(id);
    if (target) {
      requestAnimationFrame(function () {
        target.scrollIntoView({ behavior: 'auto', block: 'start' });
      });
    }
  }

  var spy = null;
  function setupScrollSpy() {
    if (spy) spy.disconnect();
    var links = els.tocNav.querySelectorAll('a[data-id]');
    if (!('IntersectionObserver' in window) || !links.length) return;

    var byId = {};
    links.forEach(function (a) { byId[a.getAttribute('data-id')] = a; });

    spy = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var id = entry.target.id;
          links.forEach(function (a) { a.classList.remove('active'); });
          if (byId[id]) byId[id].classList.add('active');
        });
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 }
    );

    els.chapters.querySelectorAll('.chapter').forEach(function (sec) {
      spy.observe(sec);
    });
  }

  // Мобильное содержание.
  function closeToc() {
    els.toc.classList.remove('open');
    els.tocToggle.setAttribute('aria-expanded', 'false');
    els.tocBackdrop.hidden = true;
  }

  els.tocToggle.addEventListener('click', function () {
    var open = els.toc.classList.toggle('open');
    els.tocToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    els.tocBackdrop.hidden = !open;
  });
  els.tocBackdrop.addEventListener('click', closeToc);
  els.tocNav.addEventListener('click', function (e) {
    if (e.target.closest('a')) closeToc();
  });

  window.addEventListener('hashchange', scrollToHash);

  // Загрузка книги.
  fetch(contentUrl, { cache: 'no-cache' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(renderBook)
    .catch(function (err) {
      console.error(err);
      showError(
        'Не удалось загрузить книгу (' + esc(err.message) + '). ' +
        'Если страница открыта как файл с диска, запустите локальный сервер: ' +
        '<code>npx serve docs</code> — или откройте сайт по адресу GitHub Pages.'
      );
    });
})();

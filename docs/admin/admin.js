/**
 * Редакция книги «Остров. Продукт. Вкус».
 *
 * Вход: пароль в адресной строке (/admin/?pass=…) или поле на экране входа.
 * Правки хранятся в book.json; «Сохранить в GitHub» пишет файл через
 * GitHub API (нужен токен с доступом на запись). Черновик правок
 * дополнительно автосохраняется в localStorage браузера.
 */
(function () {
  'use strict';

  var PASSWORD = 'opv2026';
  var DRAFT_KEY = 'opv_admin_draft';
  var SETTINGS_KEY = 'opv_admin_settings';
  var UNLOCK_KEY = 'opv_admin_unlocked';

  var $ = function (id) { return document.getElementById(id); };

  var PRODUCT_TEMPLATE = [
    '### Сцена с места / гонзо-заметка',
    '',
    '[ГОНЗО-ЗАМЕТКА АВТОРА: короткая документальная сцена от первого лица — где вы были, что делали, кто был рядом и что вы поняли о продукте.]',
    '',
    '### Продукт и место',
    '',
    '[Что именно называют этим продуктом на Сахалине? Где и в каком контексте он встречается?] [ИСТОЧНИК НУЖЕН]',
    '',
    '### Сезон и добыча / сбор',
    '',
    '[Когда доступен продукт, кто и как его добывает/собирает?] [ИСТОЧНИК НУЖЕН]',
    '',
    '### На кухне',
    '',
    '[Выбор, первичная обработка, хранение, безопасность и кулинарные свойства.] [ИСТОЧНИК НУЖЕН]',
    '',
    '### Рецепт',
    '',
    '[МЕСТО ДЛЯ АВТОРСКОГО РЕЦЕПТА — добавит автор.]',
    '',
    '### Источники и вопросы',
    '',
    '- [Источник: автор/организация, название, публикация/дата, ссылка, дата обращения]',
    '- [Вопрос автору / факт на проверку]',
    ''
  ].join('\n');

  var TRANSLIT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e',
    'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
    'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
    'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch',
    'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'
  };

  /* ================== Вход ================== */

  function isUnlocked() {
    try { return sessionStorage.getItem(UNLOCK_KEY) === '1'; } catch (e) { return false; }
  }

  function passwordFromUrl() {
    try {
      var q = new URLSearchParams(location.search);
      var v = q.get('pass') || q.get('password') || q.get('p');
      if (v) return v;
    } catch (e) { /* ignore */ }
    var h = decodeURIComponent((location.hash || '').replace(/^#/, ''));
    if (!h) return '';
    if (h.indexOf('pass=') === 0) return h.slice(5);
    if (h.indexOf('password=') === 0) return h.slice(9);
    return h;
  }

  function cleanUrl() {
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
  }

  function showLock(message) {
    $('lock').hidden = false;
    $('app').hidden = true;
    var err = $('lock-error');
    if (message) {
      err.hidden = false;
      err.textContent = message;
    } else {
      err.hidden = true;
      err.textContent = '';
    }
  }

  var appStarted = false;

  function enterApp() {
    try { sessionStorage.setItem(UNLOCK_KEY, '1'); } catch (e) { /* ignore */ }
    cleanUrl();
    $('lock').hidden = true;
    $('app').hidden = false;
    if (!appStarted) {
      appStarted = true;
      initApp();
    }
  }

  $('lock-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if ($('lock-pass').value === PASSWORD) {
      enterApp();
    } else {
      var err = $('lock-error');
      err.hidden = false;
      err.textContent = 'Неверный пароль.';
      $('lock-pass').select();
    }
  });

  /* ================== Состояние ================== */

  var book = null;          // рабочая копия книги
  var selectedId = null;
  var dirty = false;
  var previewOn = false;
  var draftTimer = null;

  var settings = {
    owner: '', repo: '', branch: 'main',
    path: 'docs/content/book.json', token: ''
  };
  var hadSavedBranch = false;
  var hadSavedPath = false;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setPill(kind, text) {
    var pill = $('status-pill');
    pill.className = 'pill' + (kind ? ' ' + kind : '');
    pill.textContent = text;
  }

  function markDirty() {
    dirty = true;
    setPill('dirty', 'Есть несохранённые изменения');
    scheduleDraftSave();
  }

  function scheduleDraftSave() {
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 400);
  }

  function saveDraft() {
    if (!book) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ book: book, ts: Date.now() }));
    } catch (e) { /* превышен квота — не критично */ }
  }

  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
    $('draft-banner').hidden = true;
  }

  function readDraft() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  /* ================== Нормализация ================== */

  function normalize(data) {
    if (!data || typeof data !== 'object') throw new Error('Некорректный JSON');
    if (!Array.isArray(data.chapters)) throw new Error('В файле нет массива chapters');
    data.meta = data.meta || {};
    data.meta.title = data.meta.title || 'Остров. Продукт. Вкус';
    data.meta.author = data.meta.author || '';
    data.meta.subtitle = data.meta.subtitle || '';
    data.meta.note = data.meta.note || '';
    if (!Array.isArray(data.illustrations)) data.illustrations = [];
    var used = {};
    data.chapters.forEach(function (ch, i) {
      if (!ch || typeof ch !== 'object') throw new Error('Глава #' + (i + 1) + ' — не объект');
      ch.title = String(ch.title || 'Без названия');
      ch.markdown = String(ch.markdown || '');
      ch.illustration = ch.illustration || null;
      var base = String(ch.id || '').trim() || slugify(ch.title, Object.keys(used));
      var id = base;
      var n = 2;
      while (used[id]) id = base + '-' + (n++);
      used[id] = true;
      ch.id = id;
    });
    return data;
  }

  function slugify(title, taken) {
    var out = '';
    var lower = String(title).toLowerCase();
    for (var i = 0; i < lower.length; i++) {
      var ch = lower[i];
      if (TRANSLIT[ch] !== undefined) out += TRANSLIT[ch];
      else if (/[a-z0-9]/.test(ch)) out += ch;
      else if (/[\s._()]/.test(ch) || ch === '-') out += '-';
    }
    out = out.replace(/-+/g, '-').replace(/^-|-$/g, '') || 'glava';
    var id = out;
    var n = 2;
    var list = taken || [];
    while (list.indexOf(id) >= 0) id = out + '-' + (n++);
    return id;
  }

  function uniqueId(title) {
    var taken = book.chapters.map(function (c) { return c.id; });
    return slugify(title, taken);
  }

  function chapterIndex(id) {
    for (var i = 0; i < book.chapters.length; i++) {
      if (book.chapters[i].id === id) return i;
    }
    return -1;
  }

  function currentChapter() {
    var i = chapterIndex(selectedId);
    return i >= 0 ? book.chapters[i] : null;
  }

  /* ================== Загрузка ================== */

  function fetchServerBook() {
    return fetch('../content/book.json?v=' + Date.now(), { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
  }

  function initApp() {
    wireEvents();
    loadSettings();
    fillGhFields();
    setPill('', 'Загрузка…');

    fetchServerBook()
      .then(function (data) {
        book = normalize(data);
        renderAll();
        setPill('', 'Загружено из книги');
        checkDraftBanner();
        detectRemote();
      })
      .catch(function (err) {
        console.error(err);
        setPill('err', 'Не удалось загрузить book.json');
        $('empty-hint').innerHTML =
          'Не удалось прочитать <code>../content/book.json</code> (' + esc(err.message) + '). ' +
          'Если страница открыта как файл, запустите локальный сервер: <code>npx serve docs</code>.';
      });
  }

  /* ================== Отрисовка ================== */

  function renderAll() {
    renderList();
    renderIllusOptions();
    if (selectedId && chapterIndex(selectedId) >= 0) {
      renderEditor();
    } else {
      selectedId = null;
      $('editor').hidden = true;
      $('editor-empty').hidden = false;
    }
    $('empty-hint').textContent = 'Всего глав: ' + book.chapters.length;
  }

  function renderList() {
    var ul = $('ch-list');
    var html = '';
    book.chapters.forEach(function (ch, i) {
      html +=
        '<li data-id="' + esc(ch.id) + '" class="' + (ch.id === selectedId ? 'active' : '') + '" title="' + esc(ch.title) + '">' +
        '<span class="n">' + (i + 1) + '</span>' +
        '<span class="t">' + esc(ch.title) + '</span>' +
        (ch.illustration ? '<span class="has-illus">✎</span>' : '') +
        '</li>';
    });
    ul.innerHTML = html;
    $('ch-count').textContent = book.chapters.length;
  }

  function renderIllusOptions() {
    var sel = $('f-illus');
    var ch = currentChapter();
    var current = ch && ch.illustration ? ch.illustration : '';
    var files = (book.illustrations || []).slice();
    if (current && files.indexOf(current) < 0) files.push(current);
    var html = '<option value="">— нет —</option>';
    files.forEach(function (f) {
      html += '<option value="' + esc(f) + '">' + esc(f) + '</option>';
    });
    sel.innerHTML = html;
    sel.value = current;
  }

  function renderEditor() {
    var ch = currentChapter();
    if (!ch) return;
    $('editor-empty').hidden = true;
    $('editor').hidden = false;
    $('f-title').value = ch.title;
    $('f-markdown').value = ch.markdown;
    renderIllusOptions();
    renderPreview();
    updatePagerButtons();
  }

  function updatePagerButtons() {
    var i = chapterIndex(selectedId);
    $('btn-up').disabled = i <= 0;
    $('btn-down').disabled = i < 0 || i >= book.chapters.length - 1;
  }

  function renderPreview() {
    var ch = currentChapter();
    if (!ch) return;
    $('preview').innerHTML = window.MD.render(ch.markdown);
  }

  function selectChapter(id) {
    if (chapterIndex(id) < 0) return;
    selectedId = id;
    renderList();
    renderEditor();
  }

  /* ================== Черновик ================== */

  function checkDraftBanner() {
    var draft = readDraft();
    if (!draft || !draft.book) return;
    if (JSON.stringify(draft.book) === JSON.stringify(book)) return;
    var when = new Date(draft.ts).toLocaleString('ru-RU');
    $('draft-text').textContent = 'Найден несохранённый черновик от ' + when + '.';
    $('draft-banner').hidden = false;
  }

  /* ================== Действия с главами ================== */

  function addChapter() {
    if (!book) return;
    var id = uniqueId('novaya-glava');
    book.chapters.push({
      id: id,
      title: 'Новая глава',
      markdown: PRODUCT_TEMPLATE,
      illustration: null
    });
    selectChapter(id);
    markDirty();
    var input = $('f-title');
    input.focus();
    input.select();
  }

  function deleteChapter() {
    var ch = currentChapter();
    if (!ch) return;
    if (!window.confirm('Удалить главу «' + ch.title + '»?')) return;
    var i = chapterIndex(selectedId);
    book.chapters.splice(i, 1);
    selectedId = book.chapters.length ? book.chapters[Math.min(i, book.chapters.length - 1)].id : null;
    renderAll();
    markDirty();
  }

  function moveChapter(delta) {
    var i = chapterIndex(selectedId);
    var j = i + delta;
    if (i < 0 || j < 0 || j >= book.chapters.length) return;
    var tmp = book.chapters[i];
    book.chapters[i] = book.chapters[j];
    book.chapters[j] = tmp;
    renderList();
    updatePagerButtons();
    markDirty();
  }

  function insertTemplate() {
    var ta = $('f-markdown');
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    var chunk = (start > 0 && ta.value.slice(0, start).trim() ? '\n\n' : '') + PRODUCT_TEMPLATE;
    ta.value = ta.value.slice(0, start) + chunk + ta.value.slice(end);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = start + chunk.length;
    syncMarkdown();
  }

  function syncMarkdown() {
    var ch = currentChapter();
    if (!ch) return;
    ch.markdown = $('f-markdown').value;
    if (previewOn) renderPreview();
    markDirty();
  }

  /* ================== Метаданные ================== */

  function openMeta() {
    if (!book) return;
    $('m-title').value = book.meta.title || '';
    $('m-author').value = book.meta.author || '';
    $('m-subtitle').value = book.meta.subtitle || '';
    $('m-note').value = book.meta.note || '';
    $('meta-modal').hidden = false;
    $('m-title').focus();
  }

  function applyMeta() {
    book.meta.title = $('m-title').value.trim();
    book.meta.author = $('m-author').value.trim();
    book.meta.subtitle = $('m-subtitle').value.trim();
    book.meta.note = $('m-note').value.trim();
    $('meta-modal').hidden = true;
    markDirty();
  }

  /* ================== Настройки GitHub ================== */

  function loadSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        hadSavedBranch = Boolean(s.branch);
        hadSavedPath = Boolean(s.path);
        settings = {
          owner: s.owner || '',
          repo: s.repo || '',
          branch: s.branch || 'main',
          path: s.path || 'docs/content/book.json',
          token: s.token || ''
        };
      }
    } catch (e) { /* ignore */ }
  }

  function persistSettings() {
    readGhFields();
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  function fillGhFields() {
    $('gh-owner').value = settings.owner;
    $('gh-repo').value = settings.repo;
    $('gh-branch').value = settings.branch;
    $('gh-path').value = settings.path;
    $('gh-token').value = settings.token;
  }

  function readGhFields() {
    settings.owner = $('gh-owner').value.trim();
    settings.repo = $('gh-repo').value.trim();
    settings.branch = $('gh-branch').value.trim() || 'main';
    settings.path = $('gh-path').value.trim() || 'docs/content/book.json';
    settings.token = $('gh-token').value.trim();
  }

  /** Определяет владельца/репозиторий по адресу GitHub Pages и ветку публикации. */
  function detectRemote() {
    var m = location.hostname.match(/^([^.]+)\.github\.io$/);
    if (m && !settings.owner) {
      settings.owner = m[1];
      var seg = location.pathname.split('/').filter(Boolean);
      settings.repo = (seg.length && seg[0] !== 'admin') ? seg[0] : m[1];
      fillGhFields();
      persistSettings();
    }
    if (!settings.owner || !settings.repo) return;

    fetch('https://api.github.com/repos/' + encodeURIComponent(settings.owner) + '/' + encodeURIComponent(settings.repo) + '/pages')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.source) return;
        if (!hadSavedBranch && data.source.branch) {
          settings.branch = data.source.branch;
          $('gh-branch').value = settings.branch;
        }
        if (!hadSavedPath && data.source.path != null) {
          var base = String(data.source.path).replace(/^\//, '').replace(/\/$/, '');
          settings.path = (base ? base + '/' : '') + 'content/book.json';
          $('gh-path').value = settings.path;
        }
        persistSettings();
      })
      .catch(function () { /* без сети с GitHub — остаются значения по умолчанию */ });
  }

  function ghHeaders(extra) {
    var h = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (settings.token) h['Authorization'] = 'Bearer ' + settings.token;
    if (extra) {
      Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    }
    return h;
  }

  function ghContentsUrl() {
    var parts = settings.path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    return 'https://api.github.com/repos/' + encodeURIComponent(settings.owner) + '/' +
      encodeURIComponent(settings.repo) + '/contents/' + parts;
  }

  function ghStatus(text, kind) {
    var el = $('gh-status');
    el.textContent = text;
    el.className = 'gh-status' + (kind ? ' ' + kind : '');
  }

  function checkAccess() {
    readGhFields();
    if (!settings.owner || !settings.repo) {
      ghStatus('Укажите владельца и репозиторий.', 'err');
      return;
    }
    ghStatus('Проверяю…');
    fetch('https://api.github.com/repos/' + encodeURIComponent(settings.owner) + '/' + encodeURIComponent(settings.repo), {
      headers: ghHeaders()
    })
      .then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok) throw new Error(data.message || 'HTTP ' + r.status);
          var canPush = data.permissions && data.permissions.push;
          ghStatus(
            'Репозиторий найден, ветка по умолчанию: ' + data.default_branch +
            (settings.token ? (canPush ? ', запись разрешена ✓' : ', запись НЕ разрешена ✗') : ' (токен не задан)'),
            canPush || !settings.token ? 'ok' : 'err'
          );
          if (!hadSavedBranch && data.default_branch && $('gh-branch').value === 'main') {
            settings.branch = data.default_branch;
            $('gh-branch').value = settings.branch;
          }
          return fetch(ghContentsUrl() + '?ref=' + encodeURIComponent(settings.branch), { headers: ghHeaders() });
        });
      })
      .then(function (r) {
        if (r.status === 404) { ghStatus('Файл ещё не найден — при сохранении будет создан.', 'ok'); return; }
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.message || 'HTTP ' + r.status); });
        ghStatus('Доступ есть, файл на месте ✓', 'ok');
      })
      .catch(function (err) {
        ghStatus('Ошибка: ' + err.message, 'err');
      });
  }

  /* ================== Сохранение в GitHub ================== */

  function utf8ToBase64(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function saveToGitHub() {
    if (!book) return;
    readGhFields();
    if (!settings.owner || !settings.repo) {
      $('gh-details').open = true;
      ghStatus('Сначала заполните владельца и репозиторий.', 'err');
      return;
    }
    if (!settings.token) {
      $('gh-details').open = true;
      ghStatus('Нужен токен с доступом на запись (см. ссылку выше).', 'err');
      $('gh-token').focus();
      return;
    }

    var btn = $('btn-save');
    btn.disabled = true;
    setPill('', 'Сохраняю в GitHub…');

    book.meta.updated = new Date().toISOString().slice(0, 10);
    var payload = JSON.stringify(book, null, 2) + '\n';
    var url = ghContentsUrl();

    fetch(url + '?ref=' + encodeURIComponent(settings.branch), { headers: ghHeaders() })
      .then(function (r) {
        if (r.status === 404) return null;
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.message || 'HTTP ' + r.status); });
        return r.json();
      })
      .then(function (existing) {
        var body = {
          message: 'admin: обновление книги через /admin (' + book.chapters.length + ' гл.)',
          content: utf8ToBase64(payload),
          branch: settings.branch
        };
        if (existing && existing.sha) body.sha = existing.sha;
        return fetch(url, {
          method: 'PUT',
          headers: ghHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(body)
        });
      })
      .then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok) throw new Error(data.message || 'HTTP ' + r.status);
          return data;
        });
      })
      .then(function (data) {
        dirty = false;
        clearDraft();
        setPill('ok', 'Сохранено ✓');
        var msg = 'Записано в ' + settings.branch + ' · ' + settings.path;
        if (data.commit && data.commit.html_url) {
          msg += ' · коммит: ' + data.commit.sha.slice(0, 7);
        }
        ghStatus(msg + '. Публикация на GitHub Pages — до минуты.', 'ok');
        $('gh-details').open = true;
      })
      .catch(function (err) {
        setPill('err', 'Ошибка сохранения');
        $('gh-details').open = true;
        ghStatus('Ошибка: ' + err.message, 'err');
      })
      .then(function () {
        btn.disabled = false;
      });
  }

  /* ================== Экспорт / импорт / сброс ================== */

  function exportJson() {
    if (!book) return;
    var blob = new Blob([JSON.stringify(book, null, 2) + '\n'], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'book.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  function importJson(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = normalize(JSON.parse(String(reader.result)));
        if (!window.confirm('Заменить текущую книгу импортированным файлом (' + data.chapters.length + ' гл.)?')) return;
        book = data;
        selectedId = null;
        renderAll();
        markDirty();
        setPill('dirty', 'Импортировано — не сохранено');
      } catch (err) {
        window.alert('Не удалось импортировать: ' + err.message);
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  function resetToServer() {
    if (!window.confirm('Сбросить все правки и вернуться к версии с сервера?')) return;
    fetchServerBook()
      .then(function (data) {
        book = normalize(data);
        selectedId = null;
        clearDraft();
        renderAll();
        dirty = false;
        setPill('', 'Сброшено к серверной версии');
      })
      .catch(function (err) {
        window.alert('Не удалось загрузить: ' + err.message);
      });
  }

  /* ================== События ================== */

  function wireEvents() {
    // Список глав.
    $('ch-list').addEventListener('click', function (ev) {
      var li = ev.target.closest('li[data-id]');
      if (li) selectChapter(li.getAttribute('data-id'));
    });

    $('btn-add').addEventListener('click', addChapter);
    $('btn-del').addEventListener('click', deleteChapter);
    $('btn-up').addEventListener('click', function () { moveChapter(-1); });
    $('btn-down').addEventListener('click', function () { moveChapter(1); });

    // Поля главы.
    $('f-title').addEventListener('input', function () {
      var ch = currentChapter();
      if (!ch) return;
      ch.title = $('f-title').value;
      renderList();
      markDirty();
    });

    $('f-markdown').addEventListener('input', syncMarkdown);

    $('f-illus').addEventListener('change', function () {
      var ch = currentChapter();
      if (!ch) return;
      ch.illustration = $('f-illus').value || null;
      renderList();
      markDirty();
    });

    // Предпросмотр / шаблон.
    $('btn-preview').addEventListener('click', function () {
      previewOn = !previewOn;
      $('btn-preview').classList.toggle('active', previewOn);
      $('btn-preview').textContent = previewOn ? 'Редактировать' : 'Предпросмотр';
      $('f-markdown').hidden = previewOn;
      $('preview').hidden = !previewOn;
      if (previewOn) renderPreview();
    });

    $('btn-template').addEventListener('click', insertTemplate);

    // Метаданные.
    $('btn-meta').addEventListener('click', openMeta);
    $('meta-apply').addEventListener('click', applyMeta);
    $('meta-cancel').addEventListener('click', function () { $('meta-modal').hidden = true; });
    $('meta-modal').addEventListener('click', function (ev) {
      if (ev.target === $('meta-modal')) $('meta-modal').hidden = true;
    });

    // Файл.
    $('btn-save').addEventListener('click', saveToGitHub);
    $('btn-export').addEventListener('click', exportJson);
    $('btn-import').addEventListener('click', function () { $('import-file').click(); });
    $('import-file').addEventListener('change', function () {
      if (this.files && this.files[0]) importJson(this.files[0]);
      this.value = '';
    });
    $('btn-reset').addEventListener('click', resetToGitHubGuard);

    // Черновик.
    $('draft-restore').addEventListener('click', function () {
      var draft = readDraft();
      if (!draft || !draft.book) return;
      try {
        book = normalize(draft.book);
        selectedId = null;
        renderAll();
        markDirty();
        $('draft-banner').hidden = true;
      } catch (err) {
        window.alert('Черновик повреждён: ' + err.message);
      }
    });
    $('draft-drop').addEventListener('click', clearDraft);

    // GitHub.
    $('gh-check').addEventListener('click', checkAccess);
    $('gh-save-settings').addEventListener('click', function () {
      persistSettings();
      ghStatus('Настройки запомнены в этом браузере.', 'ok');
    });

    // Ctrl/Cmd+S.
    document.addEventListener('keydown', function (ev) {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') {
        ev.preventDefault();
        saveToGitHub();
      }
    });

    // Смена ветки/пути вручную — не перетирать автоопределением.
    ['gh-branch', 'gh-path'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        if (id === 'gh-branch') hadSavedBranch = true;
        if (id === 'gh-path') hadSavedPath = true;
      });
    });
  }

  function resetToGitHubGuard() {
    if (dirty && !window.confirm('Есть несохранённые изменения. Сбросить их и вернуться к серверной версии?')) return;
    resetToServer();
  }

  /* ================== Старт ================== */

  (function gate() {
    if (isUnlocked()) { enterApp(); return; }
    var pw = passwordFromUrl();
    if (pw) {
      if (pw === PASSWORD) { enterApp(); return; }
      showLock('Неверный пароль из адресной строки.');
      $('lock-pass').focus();
      return;
    }
    showLock();
    $('lock-pass').focus();
  })();
})();

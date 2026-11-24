/**
 * Дымовой тест книги: страница собирается в DOM без ошибок — главы
 * рисуются, пилюли озвучки и постоянный плеер подключаются, кнопка
 * атмосферы честно сообщает о готовности дорожек. Ловит класс ошибок,
 * из-за которых раньше страница могла «падать» целиком
 * (неопределённая функция в рендере главы).
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
};

function serveDocs() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(DOCS, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(DOCS)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/** Грузим только то, что нужно для выполнения скриптов; CSS/картинки — пустые. */
class ScriptLoader extends ResourceLoader {
  fetch(url) {
    const ext = path.extname(new URL(url).pathname);
    if (ext === '' || ext === '.html' || ext === '.js' || ext === '.json') return super.fetch(url);
    return Promise.resolve(Buffer.from(''));
  }
}

function waitFor(fn, timeout = 8000, step = 50) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      let v;
      try { v = fn(); } catch (e) { v = false; }
      if (v) return resolve(v);
      if (Date.now() - t0 > timeout) return reject(new Error('timeout'));
      setTimeout(poll, step);
    })();
  });
}

test('книга: страница собирается в DOM без ошибок', async () => {
  const server = await serveDocs();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/`;

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const msg = String(e && e.message || e);
    // Не реализовано в jsdom, а не сломано в книге.
    if (/Could not parse CSS|Not implemented: HTMLMediaElement|Not implemented: window\.scrollTo/.test(msg)) return;
    errors.push(msg + (e && e.detail ? ' :: ' + e.detail : ''));
  });
  vc.on('error', () => {});

  let dom;
  try {
    dom = await JSDOM.fromURL(base, {
      runScripts: 'dangerously',
      resources: new ScriptLoader(),
      pretendToBeVisual: true,
      virtualConsole: vc,
      beforeParse(window) {
        // jsdom не реализует fetch — берём нодовский, адреса относительные.
        window.fetch = (input, init) =>
          globalThis.fetch(new URL(String(input), window.location.href), init);
        // jsdom не реализует matchMedia — считаем, что среда «обычная».
        window.matchMedia = (media) => ({
          matches: false,
          media,
          onchange: null,
          addListener() {},
          removeListener() {},
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent() { return false; },
        });
        window.addEventListener('error', (e) => errors.push('window.onerror: ' + e.message));
      },
    });

    const { window } = dom;
    const doc = window.document;

    // Главы собраны.
    await waitFor(() => doc.querySelectorAll('article.chapter').length >= 40, 10000);
    const chapters = doc.querySelectorAll('article.chapter').length;
    assert.ok(chapters >= 40, `главы на месте (${chapters})`);

    // Постоянный плеер подключён (манифест озвучки загружен).
    await waitFor(() => {
      const bar = doc.getElementById('voicebar');
      return bar && !bar.hidden && doc.body.classList.contains('voicebar-on');
    }, 8000);
    assert.equal(doc.getElementById('voicebar').hidden, false, 'плеер показан');

    // Пилюли — только у озвученных глав (по манифесту narration.json).
    const narration = JSON.parse(fs.readFileSync(path.join(DOCS, 'content/narration.json'), 'utf8'));
    const pills = doc.querySelectorAll('.chapter__player[data-vch]');
    assert.equal(pills.length, narration.chapters.length,
      `пилюль столько, сколько озвученных глав (${pills.length})`);

    // Кнопка атмосферы: честное состояние после пробы дорожек.
    const soundBtn = doc.getElementById('btn-sound');
    assert.ok(soundBtn, 'кнопка звука на месте');
    await waitFor(() => soundBtn.disabled && /готовится|недоступ/i.test(
      soundBtn.querySelector('#sound-label')?.textContent || doc.getElementById('sound-label').textContent
    ), 8000);
    assert.match(doc.getElementById('sound-label').textContent, /готовится/,
      'дорожек нет — кнопка честно «Звук готовится»');

    // Переход к главе другого раздела меняет ландшафт (glue showChapter).
    const navaga = doc.getElementById('navaga');
    assert.ok(navaga, 'глава «Навага» собрана');
    window.location.hash = '#navaga';
    await waitFor(() => doc.body.classList.contains('is-reading') && navaga.classList.contains('is-current'), 4000);
    assert.equal(window.BookAudio.status().part, 'more', 'ландшафт раздела «Море»');

    window.location.hash = '#top';
    await waitFor(() => !doc.body.classList.contains('is-reading'), 4000);
    assert.equal(window.BookAudio.status().part, 'ostrov', 'на главной — «Остров»');

    // Клик по пилюле не роняет страницу и попадает в статус плеера.
    const pill = doc.querySelector('.chapter__player[data-vch] [data-vplay]');
    assert.ok(pill, 'в пилюле есть кнопка воспроизведения');
    pill.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await waitFor(() => (doc.getElementById('v-status').textContent || '').length > 0, 4000);
    assert.ok(doc.getElementById('v-status').textContent.length > 0, 'плеер отвечает на действие');

    assert.deepEqual(errors, [], 'ошибок выполнения нет');
  } finally {
    if (dom) dom.window.close();
    server.close();
  }
});

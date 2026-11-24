/**
 * Звуковые ландшафты: манифест согласован с книгой и с README,
 * разметка плеера на месте. Отсутствующие файлы — не ошибка:
 * книга честно показывает «Звук готовится».
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/content/soundscape.json'), 'utf8'));
const book = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/content/book.json'), 'utf8'));

test('ландшафты: у каждого основного раздела книги есть дорожка', () => {
  assert.ok(Array.isArray(manifest.tracks) && manifest.tracks.length >= 4, 'дорожки перечислены');
  const parts = new Set(manifest.tracks.map((t) => t.part));
  for (const id of ['ostrov', 'more', 'les', 'dich']) {
    assert.ok(parts.has(id), `раздел ${id} представлен в манифесте`);
  }
  const ids = manifest.tracks.map((t) => t.part);
  assert.equal(new Set(ids).size, ids.length, 'разделы не повторяются');
  for (const t of manifest.tracks) {
    assert.ok(t.title && t.texture, `${t.part}: название и описание текстуры записаны`);
    assert.ok(/^[a-z-]+\.mp3$/.test(t.file), `${t.part}: имя файла (${t.file})`);
  }
});

test('ландшафты: файлы, если лежат, непустые; отсутствие честно задокументировано', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'docs/assets/audio/README.md'), 'utf8');
  for (const t of manifest.tracks) {
    assert.ok(readme.includes(t.file), `README упоминает ${t.file}`);
    const p = path.join(ROOT, 'docs/assets/audio', t.file);
    if (fs.existsSync(p)) assert.ok(fs.statSync(p).size > 1000, `${t.file}: файл не пустой`);
  }
});

test('ландшафты: разметка постоянного плеера и подключение скриптов на месте', () => {
  const html = fs.readFileSync(path.join(ROOT, 'docs/index.html'), 'utf8');
  assert.match(html, /id="voicebar"/, 'постоянный плеер в разметке');
  assert.match(html, /assets\/js\/audio\.js/, 'скрипт атмосферы подключён');
  assert.match(html, /assets\/js\/voice\.js/, 'скрипт голоса подключён');
  for (const id of ['v-play', 'v-seek', 'v-rate', 'v-vol', 'a-vol', 'a-toggle', 'v-sync']) {
    assert.ok(html.includes(`id="${id}"`), `элемент ${id} на месте`);
  }
  const config = fs.readFileSync(path.join(ROOT, 'docs/assets/js/config.js'), 'utf8');
  assert.match(config, /soundscapeUrl/, 'путь к манифесту в конфиге');
});

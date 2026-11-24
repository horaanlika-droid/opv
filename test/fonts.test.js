/**
 * Шрифты: все ссылки из CSS и разметки ведут на существующие файлы,
 * на диске нет «осиротевших» начертаний, лицензии OFL лежат рядом.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FONTS = path.join(ROOT, 'docs', 'assets', 'fonts');

function refsIn(file) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return [...text.matchAll(/assets\/fonts\/([A-Za-z0-9._-]+\.woff2)/g)].map((m) => m[1]);
}

test('шрифты: ссылки book.css ведут на существующие файлы', () => {
  const css = fs.readFileSync(path.join(ROOT, 'docs', 'assets', 'css', 'book.css'), 'utf8');
  const refs = [...css.matchAll(/url\("\.\.\/fonts\/([A-Za-z0-9._-]+\.woff2)"\)/g)].map((m) => m[1]);
  assert.ok(refs.length >= 8, 'в book.css есть @font-face на обе гарнитуры');
  for (const f of refs) {
    assert.ok(fs.existsSync(path.join(FONTS, f)), `${f}: файл на месте`);
    assert.ok(fs.statSync(path.join(FONTS, f)).size > 1000, `${f}: файл не пустой`);
  }
});

test('шрифты: на диске нет начертаний вне book.css', () => {
  const css = fs.readFileSync(path.join(ROOT, 'docs', 'assets', 'css', 'book.css'), 'utf8');
  const declared = new Set([...css.matchAll(/url\("\.\.\/fonts\/([A-Za-z0-9._-]+\.woff2)"\)/g)].map((m) => m[1]));
  const onDisk = fs.readdirSync(FONTS).filter((f) => f.endsWith('.woff2'));
  for (const f of onDisk) assert.ok(declared.has(f), `${f}: нигде не объявлен — лишний файл`);
});

test('шрифты: preload в index.html и @font-face в prototype.html ведут на существующее', () => {
  for (const page of ['docs/index.html', 'docs/prototype.html']) {
    for (const f of refsIn(page)) {
      assert.ok(fs.existsSync(path.join(FONTS, f)), `${page}: ${f} на месте`);
    }
  }
});

test('шрифты: лицензии OFL лежат рядом с файлами', () => {
  for (const lic of ['OFL-CormorantGaramond.txt', 'OFL-IBMPlexMono.txt']) {
    const p = path.join(FONTS, lic);
    assert.ok(fs.existsSync(p), `${lic}: текст лицензии на месте`);
    assert.ok(fs.statSync(p).size > 500, `${lic}: текст лицензии непустой`);
  }
  const onDisk = fs.readdirSync(FONTS).filter((f) => f.startsWith('OFL-'));
  assert.equal(onDisk.length, 2, 'лишние лицензии убраны вместе с гарнитурами');
});

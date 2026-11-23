'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BOOK_PATH = path.join(ROOT, 'docs', 'content', 'book.json');
const MD = require(path.join(ROOT, 'docs', 'assets', 'js', 'markdown.js'));

function loadBook() {
  assert.ok(fs.existsSync(BOOK_PATH), 'docs/content/book.json должен существовать (npm run build:content)');
  return JSON.parse(fs.readFileSync(BOOK_PATH, 'utf8'));
}

test('book.json: структура и метаданные', () => {
  const book = loadBook();
  assert.ok(book.meta.title.includes('Остров'), 'заголовок книги');
  assert.ok(book.meta.author.includes('Тарасенко'), 'автор');
  assert.ok(book.meta.subtitle.length > 10, 'подзаголовок');
  assert.ok(Array.isArray(book.chapters) && book.chapters.length >= 40, 'не меньше 40 глав');
  assert.ok(Array.isArray(book.illustrations) && book.illustrations.length >= 13, 'иллюстрации в манифесте');
});

test('book.json: главы имеют уникальные id, заголовки и текст', () => {
  const book = loadBook();
  const ids = new Set();
  for (const ch of book.chapters) {
    assert.match(ch.id, /^[a-z0-9-]+$/, `id «${ch.id}» — латиница/цифры/дефисы`);
    assert.ok(!ids.has(ch.id), `id не повторяется: ${ch.id}`);
    ids.add(ch.id);
    assert.ok(ch.title.trim().length > 0, 'у каждой главы есть заголовок');
    assert.ok(typeof ch.markdown === 'string', 'markdown — строка');
  }
  assert.ok(ids.has('koryushka'), 'глава «Корюшка» на месте');
  assert.ok(ids.has('filosofiya'), 'глава «Философия» на месте');
});

test('book.json: иллюстрации существуют на диске', () => {
  const book = loadBook();
  const dir = path.join(ROOT, 'docs', 'assets', 'illustrations');
  for (const name of book.illustrations) {
    assert.ok(fs.existsSync(path.join(dir, name)), `файл иллюстрации ${name}`);
  }
  const illustrated = book.chapters.filter((c) => c.illustration);
  assert.ok(illustrated.length >= 13, 'не меньше 13 глав с иллюстрацией');
  for (const ch of illustrated) {
    assert.ok(book.illustrations.includes(ch.illustration), `${ch.title}: ${ch.illustration} есть в манифесте`);
  }
});

test('сервисные главы не попали на сайт', () => {
  const book = loadBook();
  const titles = book.chapters.map((c) => c.title);
  assert.ok(!titles.includes('Содержание'), 'служебное «Содержание» исключено');
  assert.ok(!titles.includes('Шаблон продуктовой главы'), 'шаблон исключён');
});

test('markdown: базовые конструкции', () => {
  const html = MD.render(
    '## Заголовок\n\nАбзац со **жирным** и *курсивом*.\n\n- один\n- два\n\n> цитата\n\n[СОВЕТ: проверить]\n\n[ссылка](https://example.com)\n\nhttps://example.org/x\n'
  );
  assert.match(html, /<h2>Заголовок<\/h2>/);
  assert.match(html, /<strong>жирным<\/strong>/);
  assert.match(html, /<em>курсивом<\/em>/);
  assert.match(html, /<ul><li>один<\/li><li>два<\/li><\/ul>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /class="ed">\[СОВЕТ: проверить\]/);
  assert.match(html, /<a href="https:\/\/example.com"/);
  assert.match(html, /<a href="https:\/\/example.org\/x"/);
});

test('markdown: таблицы и экранирование', () => {
  const html = MD.render('| A | B |\n|---|---|\n| 1 | 2 |\n\n<script>alert(1)</script>\n');
  assert.match(html, /<table>/);
  assert.match(html, /<th>A<\/th>/);
  assert.match(html, /<td>2<\/td>/);
  assert.ok(!html.includes('<script>'), 'HTML экранируется');
  assert.match(html, /&lt;script&gt;/);
});

test('markdown: реальная глава книги рендерится без пустого результата', () => {
  const book = loadBook();
  const ch = book.chapters.find((c) => c.id === 'koryushka');
  const html = MD.render(ch.markdown);
  assert.ok(html.length > 500, 'глава отрендерена');
  assert.match(html, /<h3>/, 'есть подзаголовки');
  assert.match(html, /class="ed"/, 'редакционные маркеры подсвечены');
});

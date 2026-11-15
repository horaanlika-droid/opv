'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractSections, inlineRuns } = require('../layout/build-book');

const manuscript = fs.readFileSync(path.join(__dirname, '..', 'MANUSCRIPT.md'), 'utf8');

test('book assembly discovers all manuscript chapters and skips the template', () => {
  const sections = extractSections(manuscript);
  const titles = sections.map(({ title }) => title);
  assert.equal(titles.length, 43);
  assert.equal(titles[0], 'Философия');
  assert.ok(titles.includes('Корюшка'));
  assert.ok(titles.includes('Кижуч'));
  assert.ok(titles.includes('Заключение'));
  assert.ok(titles.includes('Реестр источников'));
  assert.ok(!titles.includes('Содержание'));
  assert.ok(!titles.includes('Шаблон продуктовой главы'));
});

test('a newly added level-two heading is picked up automatically', () => {
  const sections = extractSections(`${manuscript}\n\n## Новая глава\n\nТекст главы.\n`);
  assert.equal(sections.at(-1).title, 'Новая глава');
  assert.equal(sections.at(-1).lines.join('').includes('Текст главы.'), true);
});

test('inline markdown keeps bold labels and link destinations readable', () => {
  const runs = inlineRuns('**Важно**: [источник](https://example.org/book)');
  assert.deepEqual(runs.map(({ text }) => text), ['Важно', ': ', 'источник (https://example.org/book)']);
  assert.equal(runs[0].options.font, 'Bold');
});

'use strict';

/**
 * Сезонная маркировка: ненавязчивый слой у названия продукта.
 * Проверяем главное правило: отметка не приписывает продукту
 * неподтверждённый сезон и различает три дорожки календаря.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SEASONS = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'content', 'seasons.json'), 'utf8'));
const SL = require(path.join(ROOT, 'docs', 'assets', 'js', 'season-labels.js'));

test('отметка есть там, где сезон подтверждён календарём', () => {
  const m = SL.markFor(SEASONS, 'koryushka');
  assert.equal(m.state, 'scheduled');
  assert.match(m.label, /зима/i, 'корюшка — зима — ранняя весна');
  assert.equal(m.href, '#season-block-winter-early-spring', 'ссылка ведёт на блок календаря');
});

test('продукт нескольких сезонов показывает их все, без единственной ячейки', () => {
  const labels = SL.labelsFor(SEASONS, 'klopovka-krasnika');
  assert.equal(labels.length, 2, 'клоповка — лето и осень');
  const m = SL.markFor(SEASONS, 'klopovka-krasnika');
  assert.match(m.label, /лето/i);
  assert.match(m.label, /осень/i);
});

test('рынок никогда не выдаётся за подтверждённый', () => {
  for (const id of ['koryushka', 'seld', 'brusnika', 'klopovka-krasnika']) {
    for (const l of SL.labelsFor(SEASONS, id)) {
      assert.equal(l.marketState, 'unknown', `${id}: рынок не подтверждён`);
    }
  }
});

test('месяцы показываются только при подтверждённом природном сезоне', () => {
  for (const id of ['koryushka', 'seld', 'brusnika']) {
    const m = SL.markFor(SEASONS, id);
    if (SL.labelsFor(SEASONS, id).every((l) => l.natureState === 'confirmed')) {
      assert.ok(m.months.length > 0, `${id}: месяцы подтверждены — показаны`);
    } else {
      assert.equal(m.months, '', `${id}: месяцы не подтверждены — не показаны`);
    }
  }
});

test('неподтверждённый сезон честно помечен, а не выдуман', () => {
  const m = SL.markFor(SEASONS, 'cheremsha');
  assert.equal(m.state, 'unscheduled');
  assert.match(m.label, /не установлен/i);
  const absent = SL.markFor(SEASONS, 'глава-которой-нет');
  assert.equal(absent.state, 'unscheduled', 'неизвестная глава тоже без выдуманного сезона');
});

test('короткая подпись каталога — только сезон, без служебных слов', () => {
  assert.equal(SL.shortLabel(SEASONS, 'koryushka'), 'Зима — ранняя весна');
  assert.equal(SL.shortLabel(SEASONS, 'klopovka-krasnika'), 'Лето · Осень');
  assert.equal(SL.shortLabel(SEASONS, 'cheremsha'), '', 'без сезона — без подписи');
});

test('ссылки отметок ведут на существующие блоки календаря', () => {
  const ids = new Set(SEASONS.blocks.map((b) => b.id));
  ids.add('not-scheduled');
  for (const id of ['koryushka', 'navaga', 'seld', 'gorbusha', 'cheremsha']) {
    const m = SL.markFor(SEASONS, id);
    const blockId = m.href.replace('#season-block-', '');
    assert.ok(ids.has(blockId), `${id}: блок ${blockId} существует`);
  }
});

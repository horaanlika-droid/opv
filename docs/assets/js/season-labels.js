'use strict';

/**
 * Сезонная маркировка продуктовых глав.
 *
 * Правило — ненавязчивый информационный слой, а не навигация и не бейдж:
 *  • рядом с названием продукта — короткая сезонная отметка из тех данных,
 *    что подтверждены рукописью (docs/content/seasons.json);
 *  • различаются три вещи: природный сезон, сбор/промысел и наличие на рынке;
 *    отметка показывает природный сезон и ведёт к календарю, где видны все три;
 *  • месяцы показываются только там, где период подтверждён;
 *  • неподтверждённый сезон не приписывается продукту: честное
 *    «сезон не установлен» лучше выдуманной даты;
 *  • продуктовая глава может принадлежать нескольким сезонам — тогда
 *    показываются все, компактно.
 *
 * Файл общий: его грузит книга в браузере, его же проверяют тесты в Node.
 */

/** Названия месяцев для подписей (порядок как в range: 0 = январь). */
var MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function normId(x) {
  return String(x == null ? '' : x);
}

/**
 * Сезоны, в которых продукт упомянут, в порядке календаря.
 * @returns {Array<{blockId, title, months, range, natureState, harvestState, marketState}>}
 */
function labelsFor(seasons, chapterId) {
  var out = [];
  if (!seasons || !Array.isArray(seasons.blocks)) return out;
  var id = normId(chapterId);
  seasons.blocks.forEach(function (b) {
    if ((b.chapters || []).indexOf(id) < 0) return;
    var tracks = b.tracks || {};
    out.push({
      blockId: b.id,
      title: b.title,
      months: b.months || '',
      range: b.range || [],
      natureState: (tracks.nature && tracks.nature.state) || 'unknown',
      harvestState: (tracks.harvest && tracks.harvest.state) || 'unknown',
      marketState: (tracks.market && tracks.market.state) || 'unknown',
    });
  });
  return out;
}

/** Глава явно отнесена к «сезон не установлен». */
function isUnscheduled(seasons, chapterId) {
  if (!seasons || !seasons.notScheduled) return false;
  return (seasons.notScheduled.chapters || []).indexOf(normId(chapterId)) >= 0;
}

/**
 * Итоговая отметка для страницы продукта и каталога.
 * @returns {{
 *   state: 'scheduled' | 'unscheduled' | 'no-data',
 *   label: string,        // «Весна · основной сезон», «Лето · осень», «сезон не установлен»
 *   months: string,       // только подтверждённые периоды; иначе ''
 *   href: string,         // якорь соответствующего блока сезонного календаря
 *   title: string,        // полная подсказка с тремя дорожками
 * }}
 */
function markFor(seasons, chapterId) {
  if (!seasons || !Array.isArray(seasons.blocks)) {
    return { state: 'no-data', label: '', months: '', href: '', title: '' };
  }
  var labels = labelsFor(seasons, chapterId);
  if (!labels.length) {
    return {
      state: 'unscheduled',
      label: 'сезон не установлен',
      months: '',
      href: '#season-block-not-scheduled',
      title: 'Сезонные сроки в рукописи не подтверждены. Пустое место честнее выдуманной даты.',
    };
  }
  var titles = labels.map(function (l) {
    // «Зима — ранняя весна» уже описывает период составным именем.
    return l.title.toLocaleLowerCase('ru');
  });
  var joined = titles.join(' · ');
  var single = labels.length === 1;
  var label = single
    ? labels[0].title + ' · основной сезон'
    : joined.charAt(0).toUpperCase() + joined.slice(1) + ' · сезоны продукта';

  // Месяцы — только когда природный сезон подтверждён во всех блоках отметки.
  var months = labels.every(function (l) { return l.natureState === 'confirmed'; })
    ? labels.map(function (l) { return l.months; }).filter(Boolean).join(' · ')
    : '';

  var trackSummary = labels.map(function (l) {
    return l.title + ': природный сезон — ' + stateWord(l.natureState) +
      ', сбор и промысел — ' + stateWord(l.harvestState) +
      ', наличие на рынке — ' + stateWord(l.marketState);
  }).join('; ');

  return {
    state: 'scheduled',
    label: label,
    months: months,
    href: '#season-block-' + labels[0].blockId,
    title: trackSummary + '. Подробности — в сезонном календаре.',
  };
}

function stateWord(s) {
  return s === 'confirmed' ? 'указано в рукописи'
    : s === 'approx' ? 'ориентировочно, требует проверки'
    : 'не подтверждено';
}

/**
 * Короткая подпись для строк каталога: «Весна», «Лето · осень», без пометок.
 * Пустая строка, если сезон не установлен, — каталог не перегружается.
 */
function shortLabel(seasons, chapterId) {
  var m = markFor(seasons, chapterId);
  if (m.state !== 'scheduled') return '';
  return m.label.replace(/\s*·\s*(основной сезон|сезоны продукта)$/, '')
    .split(' · ')
    .map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); })
    .join(' · ');
}

var API = {
  MONTHS_SHORT: MONTHS_SHORT,
  labelsFor: labelsFor,
  markFor: markFor,
  shortLabel: shortLabel,
  isUnscheduled: isUnscheduled,
};

// Работает и в Node (тесты), и в браузере (книга).
if (typeof module === 'object' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.SeasonLabels = API;

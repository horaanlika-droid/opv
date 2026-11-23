'use strict';

/**
 * Разделение продуктовой главы на две части.
 *
 *  1. Литературно-исследовательская часть — история продукта, остров, сезон,
 *     люди. Это основной текст, ради которого книгу читают подряд.
 *  2. Практическая часть («Заметка шефа») — выбор и оценка качества,
 *     первичная обработка, хранение, профессиональные техники, рецепт.
 *     Она не прерывает повествование и открывается отдельно, по ссылке.
 *
 * Модуль ничего не сочиняет. Он раскладывает существующий текст рукописи и
 * отдельно собирает всё, чего в рукописи ещё нет (рецепт, личная заметка,
 * проверенный режим). Такие места не выдумываются, а показываются как
 * «ждёт автора» — это требование редакции, а не заглушка интерфейса.
 */

/** Заголовки, которые целиком относятся к практической части. */
const PRACTICE_HEADINGS = [
  'на кухне',
  'рецепт',
  'выбрать, сохранить, приготовить',
  'кулинарный контекст без инструкции по добыче',
];

/** Заголовки аппарата главы: остаются в повествовании. */
const APPARATUS_HEADINGS = [
  'вопросы автору',
  'редакторские вопросы автору',
  'источники',
  'источники и пометки',
];

/** Служебная шапка главы (редакционный статус), не является её содержанием. */
const SERVICE_NOTE = /^\**\s*(>\s*)?\*\*[^*]*(Редакционный черновик|РАБОЧАЯ КАРТА|Первый рабочий черновик|ЧЕРНОВИК)[^*]*\*\*/i;

/** Параграф, который явно описывает практику (рецепт, обработку, хранение). */
const PRACTICE_PARA = /^(?:\*\*)?(рецепт|на кухне|практическ)/i;

/** Маркер практической части внутри квадратных скобок. */
const PRACTICE_MARKER = /(рецепт|практическ\w*\s+(блок|глав\w*|раздел)|обработк|хранени|технолог|безопасн|холодов\w+ цеп|качеств)/i;

function normHeading(raw) {
  return String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isPracticeHeading(heading) {
  const h = normHeading(heading);
  return PRACTICE_HEADINGS.some((k) => h === k || h.startsWith(k));
}

function isApparatusHeading(heading) {
  const h = normHeading(heading);
  return APPARATUS_HEADINGS.some((k) => h === k || h.startsWith(k));
}

/** Разбивает markdown на блоки { heading, body } по заголовкам ###. */
function splitByH3(md) {
  const lines = String(md || '').split(/\r?\n/);
  const blocks = [];
  let cur = { heading: null, lines: [] };
  for (const line of lines) {
    const m = line.match(/^###\s+(.*)$/);
    if (m) {
      blocks.push(cur);
      cur = { heading: m[1].trim(), lines: [] };
    } else {
      cur.lines.push(line);
    }
  }
  blocks.push(cur);
  return blocks
    .map((b) => ({ heading: b.heading, body: b.lines.join('\n').replace(/^\n+|\n+$/g, '') }))
    .filter((b) => b.heading || b.body.trim());
}

function joinBlocks(blocks) {
  return blocks
    .map((b) => (b.heading ? `### ${b.heading}\n\n${b.body}`.trim() : b.body.trim()))
    .filter(Boolean)
    .join('\n\n');
}

/** Текст без редакционных пометок в квадратных скобках. */
function stripMarkers(md) {
  return String(md || '')
    .replace(/\[[^[\]]{2,}\]/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Сколько содержательного текста в блоке (символы без пометок и разметки). */
function substance(md) {
  return stripMarkers(md).replace(/[#*>|\-:`]/g, '').replace(/\s+/g, '').length;
}

/** Повествовательный текст без заголовков — для метаданных и поиска. */
function proseOf(md) {
  return String(md || '')
    .split(/\r?\n/)
    .filter((l) => !/^#{1,6}\s/.test(l))
    .join('\n')
    .trim();
}

const DRAFT_MARK = /\[[^\]\n]{2,}\]/;

/** Убирает ведущие маркеры в скобках: «[ЗАМЕТКА АВТОРА: …] Текст» → «Текст». */
function dropLeadingMarkers(text) {
  let out = String(text || '').trim();
  for (let i = 0; i < 6; i++) {
    const next = out.replace(/^\[[^[\]]*\]\s*/, '').replace(/^\*\*[^*]*\*\*\s*:?\s*/, '');
    if (next === out) break;
    out = next;
  }
  return out.trim();
}

/** Является ли абзац чистой пометкой (местом для автора), а не текстом. */
function isPlaceholder(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  const withoutBoldLabel = t.replace(/^\*\*[^*]*\*\*\s*:?/, '').trim();
  return /^\[[^[\]]{2,}\]\s*[.!]?$/.test(withoutBoldLabel) || /^\[[^[\]]{2,}\]/.test(withoutBoldLabel) && dropLeadingMarkers(withoutBoldLabel) === '';
}

/**
 * Метка абзаца: «**Рецепт:**», «**На кухне.**» или ведущий маркер [ … ].
 * Именно по метке, а не по всему тексту, определяется принадлежность:
 * иначе слово «рецепт» в литературном абзаце утащило бы его в практику.
 */
function labelOf(text) {
  const t = String(text || '').trim();
  const bold = t.match(/^\*\*([^*]{2,60}?)\*\*/);
  if (bold) return bold[1].replace(/[:.]\s*$/, '').trim();
  const bracket = t.match(/^\[([^[\]]{2,})\]/);
  if (bracket) return bracket[1];
  return '';
}

/**
 * Прямой редакционный запрет: рецепта быть не должно (охраняемый вид,
 * непроверенная безопасность). Такой абзац — не инструкция, а граница.
 */
const BLOCKER = /не публиковать|не включать|не давать (советов|инструкц)|не романтизировать|не готовить|не переносить|перед публикацией/i;

function isBlocker(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  const label = labelOf(t);
  if (/^(рецепт|на кухне)$/i.test(label) && BLOCKER.test(t)) return true;
  return /^\[/.test(t) && BLOCKER.test(t) && /рецепт|добыч|приготовл|сбор/i.test(t);
}

/** Относится ли абзац к практической части. */
function isPracticeParagraph(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  const label = labelOf(t);
  if (label && PRACTICE_PARA.test(label)) return true;
  const rest = dropLeadingMarkers(t);
  if (PRACTICE_PARA.test(rest)) return true;
  // «[ЗАМЕТКА АВТОРА: …] Практический блок — …»
  if (label && PRACTICE_MARKER.test(label) && substance(dropLeadingMarkers(t)) > 0) return true;
  return false;
}

function paragraphKind(text) {
  if (isPracticeParagraph(text)) {
    return isPlaceholder(text) ? 'practical-placeholder' : 'practical';
  }
  return 'story';
}

/** Заголовок раздела для группировки в «Заметке шефа». */
function practiceGroup(heading) {
  const h = normHeading(heading);
  if (!h) return 'note';
  if (h.includes('рецепт')) return 'recipe';
  if (h.includes('кухн') || h.includes('выбрать') || h.includes('кулинар')) return 'kitchen';
  if (h.includes('добыч') || h.includes('сбор')) return 'harvest';
  return 'note';
}

/**
 * Делит главу на повествование и практическую часть.
 *
 * @returns {{
 *   story: string,
 *   practical: null | {markdown: string, sections: Array, placeholders: Array, groups: Array, hasRecipe: boolean, isBlocked: boolean},
 *   hasPractical: boolean,
 *   serviceNote: string,
 *   flags: {recipe: boolean, authorNote: boolean, blocked: boolean}
 * }}
 */
function splitChapter(chapter) {
  const md = String((chapter && chapter.markdown) || '');
  const blocks = splitByH3(md);

  const storyBlocks = [];
  const practiceBlocks = [];

  for (const block of blocks) {
    if (block.heading && isPracticeHeading(block.heading)) {
      practiceBlocks.push({ heading: block.heading, body: block.body });
      continue;
    }
    if (block.heading && isApparatusHeading(block.heading)) {
      storyBlocks.push({ heading: block.heading, body: block.body });
      continue;
    }
    // Блок без заголовка (или с литературным заголовком): абзацы разбираем по одному,
    // чтобы практика не утаскивала за собой повествование.
    const paras = block.body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    let storyPart = [];
    let practicePart = [];
    for (const para of paras) {
      // Запрет на рецепт читается как практика, даже если стоит в повествовании:
      // читатель должен увидеть границу там, где открывает заметку.
      if (isPracticeParagraph(para) || isBlocker(para)) practicePart.push(para);
      else storyPart.push(para);
    }
    if (storyPart.length) storyBlocks.push({ heading: block.heading, body: storyPart.join('\n\n') });
    if (practicePart.length) practiceBlocks.push({ heading: block.heading, body: practicePart.join('\n\n') });
  }

  // Служебную шапку главы снимаем с повествования, но сохраняем для редакции.
  let serviceNote = '';
  if (storyBlocks.length && !storyBlocks[0].heading) {
    const paras = storyBlocks[0].body.split(/\n{2,}/).map((p) => p.trim());
    if (paras.length && SERVICE_NOTE.test(paras[0])) {
      serviceNote = paras.shift();
      storyBlocks[0] = { heading: null, body: paras.join('\n\n') };
    }
  }

  const story = joinBlocks(storyBlocks.filter((b) => b.body.trim() || b.heading));

  const sections = [];
  const allPlaceholders = [];

  for (const block of practiceBlocks) {
    const paras = block.body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const keptParas = [];
    const blockPlaceholders = [];

    for (const para of paras) {
      if (isPlaceholder(para) || isBlocker(para)) blockPlaceholders.push(para);
      else keptParas.push(para);
    }

    if (!block.heading && !keptParas.length && !blockPlaceholders.length) continue;

    sections.push({
      heading: block.heading || null,
      group: practiceGroup(block.heading),
      markdown: keptParas.join('\n\n'),
      chars: substance(keptParas.join('\n\n')),
      placeholders: blockPlaceholders,
    });
    allPlaceholders.push(...blockPlaceholders);
  }

  if (!practiceBlocks.length) {
    return {
      story,
      practical: null,
      hasPractical: false,
      serviceNote,
      flags: { recipe: false, authorNote: false, blocked: false, recipeDeclined: false },
    };
  }

  // Пустые разделы (только «место для автора») сохраняем: читатель должен
  // видеть, что рецепт не спрятан, а ещё не написан.
  const practicalMd = sections
    .map((s) => {
      const head = s.heading ? `### ${s.heading}` : '';
      return [head, s.markdown].filter(Boolean).join('\n\n');
    })
    .filter(Boolean)
    .join('\n\n');

  const blocked = allPlaceholders.some((p) => BLOCKER.test(p) && /рецепт|добыч|приготовл|сбор/i.test(p));
  const flags = {
    // «Рецепт» есть как раздел, но это может быть место под него — см. isEmpty.
    recipe: sections.some((s) => s.group === 'recipe') || allPlaceholders.some((p) => /рецепт/i.test(p)),
    authorNote: allPlaceholders.some((p) => /заметк[аи] автора|авторск/i.test(p)),
    blocked,
    // Рецепт не «ждёт автора», а не будет опубликован вовсе.
    recipeDeclined: blocked || allPlaceholders.some((p) => /^(рецепт:?\s*)?не (включать|публиковать)/i.test(p.trim())),
  };

  const emptyOnly = sections.every((s) => s.chars < 40);

  return {
    story,
    practical: {
      markdown: practicalMd,
      sections,
      placeholders: allPlaceholders,
      hasRecipe: flags.recipe && !flags.recipeDeclined,
      isBlocked: flags.blocked,
      isRecipeDeclined: flags.recipeDeclined,
      isEmpty: emptyOnly,
      wordCount: substance(practicalMd),
    },
    hasPractical: !emptyOnly || allPlaceholders.length > 0,
    serviceNote,
    flags,
  };
}

var API = {
  splitChapter,
  splitByH3,
  isPracticeHeading,
  isApparatusHeading,
  isPracticeParagraph,
  isPlaceholder,
  isBlocker,
  paragraphKind,
  stripMarkers,
  substance,
  proseOf,
  dropLeadingMarkers,
  DRAFT_MARK,
};

// Работает и в Node (сборка контента, тесты), и в браузере (книга).
if (typeof module === 'object' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.ChapterSplit = API;

#!/usr/bin/env node
'use strict';

/**
 * Собирает контент сайта книги (docs/content/book.json) из MANUSCRIPT.md
 * и готовит веб-версии иллюстраций (docs/assets/illustrations/*.webp).
 *
 * Запуск: npm run build:content
 *
 * Внимание: перезаписывает docs/content/book.json целиком, включая правки,
 * сделанные через /admin-панель. Запускать осознанно.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANUSCRIPT = path.join(ROOT, 'MANUSCRIPT.md');
const OUT_DIR = path.join(ROOT, 'docs', 'content');
const OUT_FILE = path.join(OUT_DIR, 'book.json');
const ILLUS_SRC = path.join(ROOT, 'assets', 'illustrations');
const ILLUS_OUT = path.join(ROOT, 'docs', 'assets', 'illustrations');

const { splitChapter, proseOf, substance, stripMarkers } = require('./chapter-split');

const MAX_ILLUS_WIDTH = 1000;

/** Главы, которые не публикуются на сайте (служебные). */
const SKIP_CHAPTERS = new Set(['Содержание', 'Шаблон продуктовой главы']);

/** Соответствие «глава → файл иллюстрации» (исходный PNG). */
const ILLUSTRATION_BY_CHAPTER = {
  'Корюшка': 'korushka-01.png',
  'Навага': 'navaga-01.png',
  'Таймень': 'taimen-01.png',
  'Сельдь': 'seld-01.png',
  'Чека': 'cheka-01.png',
  'Жерих и краснопёрка': 'ugai-01.png',
  'Сима (вишнёвый лосось)': 'sima-01.png',
  'Уёк': 'uek-01.png',
  'Рыба-лапша': 'ryba-lapsha-01.png',
  'Кунжа': 'kunja-01.png',
  'Галец': 'galets-01.png',
  'Горбуша': 'gorbusha-01.png',
  'Кета': 'keta-01.png',
  'Кижуч': 'kizhuch-01.png',
  'Хариус': 'harius-01.png',
  'Краб': 'krab-01.png',
  'Креветка': 'krevetka-01.png',
  'Морской ёж': 'morskoy-ezh-01.png',
  'Гребешок': 'grebeshok-01.png',
  'Трепанг': 'trepang-01.png',
  'Спизула': 'spizula-01.png',
  'Карбикула': 'karbikula-01.png',
};

const TRANSLIT = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e',
  'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
  'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
  'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch',
  'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
};

function slugify(title, used) {
  let out = '';
  const lower = String(title).toLowerCase();
  for (const ch of lower) {
    if (TRANSLIT[ch] !== undefined) out += TRANSLIT[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else if (/[\s._()]/.test(ch)) out += '-';
    else if (ch === '-') out += '-';
    // прочие знаки (скобки, двоеточия и т.п.) пропускаем
  }
  out = out.replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!out) out = 'glava';
  let slug = out;
  let n = 2;
  while (used.has(slug)) slug = `${out}-${n++}`;
  used.add(slug);
  return slug;
}

function parseManuscript(md) {
  const lines = md.split(/\r?\n/);
  const firstH2 = lines.findIndex((l) => /^##\s/.test(l));
  if (firstH2 < 0) throw new Error('В MANUSCRIPT.md не найдено ни одной главы (##)');

  // В начале рукописи бывают «мягкие переносы» (два пробела в конце строки),
  // поэтому перед разбором каждую строку обрезаем по краям.
  const head = lines.slice(0, firstH2).map((l) => l.trim());
  const titleLine = head.find((l) => /^#\s/.test(l));
  const authorLine = head.find((l) => /^\*\*[^*].*\*\*$/.test(l));
  const subtitleLine = head.find((l) => /^\*[^*].*\*$/.test(l));

  const noteLines = [];
  let inNote = false;
  for (const line of head) {
    if (/^>\s?/.test(line)) {
      inNote = true;
      noteLines.push(line.replace(/^>\s?/, ''));
    } else if (inNote && line.trim() === '') {
      inNote = false;
    } else if (inNote) {
      noteLines.push(line);
    }
  }

  const meta = {
    title: titleLine ? titleLine.replace(/^#\s+/, '').trim() : 'Книга',
    author: authorLine ? authorLine.replace(/^\*\*|\*\*$/g, '').trim() : '',
    subtitle: subtitleLine ? subtitleLine.replace(/^\*|\*$/g, '').trim() : '',
    note: noteLines.join('\n').trim(),
  };

  const rawChapters = [];
  let cur = null;
  for (const line of lines.slice(firstH2)) {
    const m = line.match(/^##\s+(.*)$/);
    if (m) {
      if (cur) rawChapters.push(cur);
      cur = { title: m[1].trim(), buf: [] };
      continue;
    }
    if (cur) cur.buf.push(line);
  }
  if (cur) rawChapters.push(cur);

  const used = new Set();
  const chapters = [];
  for (const { title, buf } of rawChapters) {
    if (SKIP_CHAPTERS.has(title)) continue;
    const body = buf
      .filter((l) => !/^#(?!#)\s/.test(l))   // служебные H1-заголовки уровня документа
      .filter((l) => !/^---\s*$/.test(l))    // разделители секций
      .map((l) => l.replace(/\s+$/, ''))
      .join('\n')
      .replace(/^\n+|\n+$/g, '');
    if (!title && !body) continue;
    chapters.push({
      id: slugify(title, used),
      title,
      markdown: body,
      illustration: null,
    });
  }

  return { meta, chapters };
}

/**
 * Разделы и категории — редакционная разметка, а не догадка о тексте.
 * Тип природной среды совпадает с той из пяти зон, в которой продукт живёт:
 * это связывает поиск и сезонный календарь с центральной сценой острова.
 */
const PART_BY_CHAPTER = {
  ostrov: ['filosofiya', 'kuhnya-kotoruyu-sformirovali-more-les-i-vremya', 'ostrov-kak-sostoyanie'],
  more: [
    'koryushka', 'navaga', 'taymen', 'seld', 'cheka', 'zherih-i-krasnoperka', 'sima-vishnevyy-losos',
    'uek', 'ryba-lapsha', 'kunzha', 'galets', 'gorbusha', 'keta', 'kizhuch', 'harius',
    'krab', 'krevetka', 'morskoy-ezh', 'grebeshok', 'trepang', 'spizula', 'karbikula',
    'nazvanie-utochnit-stranitsa-108', 'morskaya-kapusta', 'rakushka',
  ],
  les: [
    'paporotniki-orlyak-i-osmund', 'lapuh', 'kaluzhnitsa', 'krapiva',
    'cheremsha', 'moroshka', 'klopovka-krasnika', 'brusnika',
  ],
  dich: ['gus-i-utka', 'dikiy-golub', 'zayats-belyak', 'olen'],
  spravochnoe: ['sezonnaya-karta-produktov', 'zaklyuchenie', 'reestr-istochnikov'],
};

/**
 * Тип среды: где продукт находится в природе, а не где его продают.
 * Это же значение связывает главу с одним из пяти уровней сцены.
 */
const ENVIRONMENT_BY_CHAPTER = {
  // Море: рыба, моллюски, иглокожие, водоросли.
  more: [
    'koryushka', 'navaga', 'seld', 'cheka', 'zherih-i-krasnoperka', 'sima-vishnevyy-losos', 'uek',
    'ryba-lapsha', 'kunzha', 'galets', 'gorbusha', 'keta', 'kizhuch', 'harius', 'krab', 'krevetka',
    'morskoy-ezh', 'grebeshok', 'trepang', 'spizula', 'karbikula', 'morskaya-kapusta', 'rakushka',
    'nazvanie-utochnit-stranitsa-108',
  ],
  river: ['taymen'],
  // Лес: дикоросы, травы, ягоды.
  les: ['paporotniki-orlyak-i-osmund', 'lapuh', 'kaluzhnitsa', 'krapiva', 'cheremsha', 'moroshka', 'klopovka-krasnika', 'brusnika'],
  // Дичь — обитатели леса и побережья; в сцене это пояс леса и берега.
  les_dich: ['gus-i-utka', 'dikiy-golub', 'zayats-belyak', 'olen'],
};

const CATEGORY_BY_CHAPTER = {
  fish: [
    'koryushka', 'navaga', 'taymen', 'seld', 'cheka', 'zherih-i-krasnoperka', 'sima-vishnevyy-losos',
    'uek', 'ryba-lapsha', 'kunzha', 'galets', 'gorbusha', 'keta', 'kizhuch', 'harius',
  ],
  // Раздел «страница 108» — редакционный стоп: название и вид не установлены,
  // поэтому категории у него нет. Пустая категория честнее угаданной.
  shellfish: ['krab', 'krevetka', 'morskoy-ezh', 'grebeshok', 'trepang', 'spizula', 'karbikula', 'rakushka'],
  seaweed: ['morskaya-kapusta'],
  plants: ['paporotniki-orlyak-i-osmund', 'lapuh', 'kaluzhnitsa', 'krapiva', 'cheremsha'],
  berries: ['moroshka', 'klopovka-krasnika', 'brusnika'],
  game: ['gus-i-utka', 'dikiy-golub', 'zayats-belyak', 'olen'],
};

/**
 * География — только там, где рукопись действительно называет район.
 * Пустое значение честнее выдуманного «везде на Сахалине».
 */
const REGION_BY_CHAPTER = {
  navaga: 'Западный Сахалин, Татарский пролив',
  seld: 'Западный Сахалин, Татарский пролив',
  cheka: 'Юго-восточное побережье',
  sima: 'Южный Сахалин',
  'sima-vishnevyy-losos': 'Южный Сахалин',
  uek: 'Северный Сахалин',
  kunzha: 'Восточное побережье',
  krevetka: 'Северный Сахалин',
  trepang: 'Восточное побережье',
  koryushka: 'Сахалин, прибрежные районы',
};

function invertMap(map) {
  const out = {};
  for (const [key, ids] of Object.entries(map)) {
    for (const id of ids) out[id] = key;
  }
  return out;
}

async function buildIllustrations() {
  let sharp = null;
  try {
    sharp = require('sharp');
  } catch (err) {
    console.warn('[иллюстрации] sharp не установлен, копирую PNG как есть:', err.message);
  }

  fs.mkdirSync(ILLUS_OUT, { recursive: true });
  for (const name of fs.readdirSync(ILLUS_OUT)) {
    if (name === '.gitkeep') continue;
    fs.rmSync(path.join(ILLUS_OUT, name), { force: true });
  }

  const files = fs.readdirSync(ILLUS_SRC).filter((f) => f.toLowerCase().endsWith('.png')).sort();
  const outNames = new Map(); // png -> webp/png в docs

  for (const file of files) {
    const base = file.replace(/\.png$/i, '');
    const src = path.join(ILLUS_SRC, file);
    if (sharp) {
      const dest = path.join(ILLUS_OUT, `${base}.webp`);
      await sharp(src)
        .resize({ width: MAX_ILLUS_WIDTH, withoutEnlargement: true })
        .webp({ quality: 82, smartSubsample: true })
        .toFile(dest);
      outNames.set(file, `${base}.webp`);
      const kb = Math.round(fs.statSync(dest).size / 1024);
      console.log(`  ${file} → ${base}.webp (${kb} КБ)`);
    } else {
      fs.copyFileSync(src, path.join(ILLUS_OUT, file));
      outNames.set(file, file);
      console.log(`  ${file} → копия PNG`);
    }
  }
  return outNames;
}

async function main() {
  console.log('Читаю MANUSCRIPT.md…');
  const md = fs.readFileSync(MANUSCRIPT, 'utf8');
  const { meta, chapters } = parseManuscript(md);
  console.log(`  мета: «${meta.title}», глав: ${chapters.length}`);

  console.log('Готовлю иллюстрации…');
  const outNames = await buildIllustrations();

  for (const ch of chapters) {
    const srcPng = ILLUSTRATION_BY_CHAPTER[ch.title];
    if (srcPng && outNames.has(srcPng)) ch.illustration = outNames.get(srcPng);
  }

  // Разделение литературной и практической частей + навигационные метаданные.
  const partOf = invertMap(PART_BY_CHAPTER);
  const envOf = invertMap(ENVIRONMENT_BY_CHAPTER);
  const catOf = invertMap(CATEGORY_BY_CHAPTER);

  for (const ch of chapters) {
    const split = splitChapter(ch);
    ch.part = partOf[ch.id] || 'spravochnoe';
    ch.environment = envOf[ch.id] || null;
    ch.category = catOf[ch.id] || null;
    ch.region = REGION_BY_CHAPTER[ch.id] || null;
    // Повествование дублируем только там, где оно отличается от полного текста:
    // иначе файл книги зря тяжелеет в два раза.
    if (split.hasPractical) ch.story = split.story;

    if (split.hasPractical) {
      ch.practical = {
        markdown: split.practical.markdown,
        sections: split.practical.sections.map((s) => ({
          heading: s.heading,
          group: s.group,
          chars: s.chars,
          placeholders: s.placeholders,
        })),
        hasRecipe: split.practical.hasRecipe,
        isBlocked: split.practical.isBlocked,
        isRecipeDeclined: split.practical.isRecipeDeclined,
        isEmpty: split.practical.isEmpty,
        placeholders: split.practical.placeholders,
      };
    }
    if (split.serviceNote) ch.serviceNote = split.serviceNote;

    // Абстракт для карточек поиска: только повествование, без пометок.
    ch.abstract = stripMarkers(
      proseOf(split.story)
        .split(/\r?\n/)
        .filter((l) => !/^\s*\|/.test(l))   // таблицы в карточку поиска не нужны
        .join(' ')
    )
      .replace(/\[\d[\d,\s–-]*\]/g, ' ')      // ссылочные номера вида [1], [2]
      .replace(/\(\s*\)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Обрезаем по границе слова: в карточке не должно быть обрывков.
    if (ch.abstract.length > 240) {
      ch.abstract = ch.abstract.slice(0, 240).replace(/\s+\S*$/, '') + '…';
    }
    // Состояние рецепта: не «есть/нет», а «что с ним сейчас».
    const recipeSection = ch.practical
      ? ch.practical.sections.find((s) => s.group === 'recipe')
      : null;
    ch.recipeState = !ch.practical
      ? 'none'
      : ch.practical.isRecipeDeclined
        ? 'blocked'
        : recipeSection && recipeSection.chars >= 80
          ? 'ready'
          : 'awaiting-author';
  }

  const practicalCount = chapters.filter((c) => c.practical).length;

  const book = {
    meta: {
      ...meta,
      updated: new Date().toISOString().slice(0, 10),
    },
    illustrations: [...new Set(outNames.values())].sort(),
    chapters,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(book, null, 2) + '\n', 'utf8');
  const kb = Math.round(fs.statSync(OUT_FILE).size / 1024);
  console.log(`Записан ${path.relative(ROOT, OUT_FILE)} (${kb} КБ), иллюстраций в главах: ${chapters.filter((c) => c.illustration).length}/${chapters.length}`);
  console.log(`  заметок шефа: ${practicalCount}, из них с авторским рецептом: ${chapters.filter((c) => c.recipeState === 'ready').length}, ждут автора: ${chapters.filter((c) => c.recipeState === 'awaiting-author').length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

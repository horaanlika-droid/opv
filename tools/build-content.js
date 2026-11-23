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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

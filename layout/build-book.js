#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const MANUSCRIPT = path.join(ROOT, 'MANUSCRIPT.md');
const COVER = path.join(ROOT, '1.png');
const DEFAULT_OUTPUT = path.join(ROOT, 'book-draft.pdf');
const FONT_CANDIDATES = {
  regular: [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/dejavu/DejaVuSans.ttf',
  ],
  bold: [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
  ],
};

const ILLUSTRATIONS = [
  [/^корюшка/i, 'korushka-01.png'],
  [/^навага/i, 'navaga-01.png'],
  [/^таймень/i, 'taimen-01.png'],
  [/^сельдь/i, 'seld-01.png'],
  [/^чека/i, 'cheka-01.png'],
  [/^жерих|^красноп/i, 'ugai-01.png'],
  [/^сима/i, 'sima-01.png'],
  [/^уёк|^уек/i, 'uek-01.png'],
  [/^рыба-лапша|^рыба лапша/i, 'ryba-lapsha-01.png'],
  [/^кунжа/i, 'kunja-01.png'],
  [/^галец|^голец/i, 'galets-01.png'],
  [/^горбуша/i, 'gorbusha-01.png'],
  [/^кета/i, 'keta-01.png'],
];

const PAGE_W = 760;
const PAGE_H = PAGE_W * 1545 / 2000;
const MARGIN_X = 52;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const COLORS = {
  paper: '#f8f3e4', ink: '#20201d', muted: '#77766f', line: '#dedbd1',
  rust: '#94563d', rustPale: '#f6eee8', notePale: '#f5f1e6', noteInk: '#76543d',
  white: '#ffffff',
};

function findFile(candidates) {
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function extractSections(markdown) {
  const skipped = new Set([
    'содержание',
    'шаблон продуктовой главы',
    'как читать этот документ',
    'редакторская карта: что ещё нужно сделать',
  ]);
  const sections = [];
  let current = null;

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      if (current) sections.push(current);
      const title = heading[1].trim();
      current = skipped.has(title.toLocaleLowerCase('ru')) ? null : { title, lines: [] };
      continue;
    }
    if (/^#\s+Главы о продуктах\s*$/i.test(line)) continue;
    if (current) current.lines.push(line);
  }
  if (current) sections.push(current);
  return sections;
}

function inlineRuns(text) {
  const runs = [];
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(`[^`]+`)/g;
  let cursor = 0;
  let match;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) runs.push({ text: text.slice(cursor, match.index) });
    if (match[1]) runs.push({ text: `${match[1]} (${match[2]})` });
    else if (match[3]) runs.push({ text: match[3].slice(2, -2), options: { font: 'Bold' } });
    else if (match[4]) runs.push({ text: match[4].slice(1, -1), options: { oblique: true } });
    else if (match[5]) runs.push({ text: match[5].slice(1, -1), options: { font: 'Bold' } });
    cursor = pattern.lastIndex;
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor) });
  return runs.length ? runs : [{ text }];
}

function displayText(text) {
  return text
    .replace(/\\([\\`*_{}\[\]()#+\-.!>])/g, '$1')
    .replace(/  +$/g, '')
    .trim();
}

function parseTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => displayText(cell));
}

async function createBuilder({ manuscript = MANUSCRIPT, cover = COVER, output = DEFAULT_OUTPUT } = {}) {
  const regularFont = findFile(FONT_CANDIDATES.regular);
  const boldFont = findFile(FONT_CANDIDATES.bold);
  if (!regularFont || !boldFont) {
    throw new Error('DejaVu Sans fonts were not found. Install DejaVu Sans or configure FONT_CANDIDATES.');
  }
  for (const file of [manuscript, cover]) {
    if (!fs.existsSync(file)) throw new Error(`Missing required file: ${file}`);
  }

  const markdown = fs.readFileSync(manuscript, 'utf8');
  const sections = extractSections(markdown);
  if (!sections.length) throw new Error('No level-two manuscript chapters found.');

  // Downsample large source PNGs for screen-proof use without altering the originals.
  const imagePaths = [...new Set(sections.flatMap((section) => {
    const entry = ILLUSTRATIONS.find(([pattern]) => pattern.test(section.title));
    const file = entry && path.join(ROOT, 'assets', 'illustrations', entry[1]);
    return file && fs.existsSync(file) ? [file] : [];
  }))];
  const imageBuffers = new Map(await Promise.all(imagePaths.map(async (file) => [
    file,
    await sharp(file).rotate().resize({ width: 900, height: 700, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: COLORS.paper }).jpeg({ quality: 83, mozjpeg: true }).toBuffer(),
  ])));

  const doc = new PDFDocument({
    size: [PAGE_W, PAGE_H], margin: 0, autoFirstPage: true, bufferPages: true,
    compress: true,
    info: {
      Title: 'Остров. Продукт. Вкус — рабочая сборка книги',
      Author: 'Егор Тарасенко',
      Subject: 'Редакционный PDF-черновик из MANUSCRIPT.md; не финальный макет',
      Keywords: 'Сахалин, кухня, рукопись, рабочая сборка',
    },
  });
  const stream = fs.createWriteStream(output);
  doc.pipe(stream);
  doc.registerFont('Body', regularFont);
  doc.registerFont('Bold', boldFont);
  doc.font('Body').fillColor(COLORS.ink);

  let interiorPage = 0;
  let runningTitle = 'Содержание';
  let isCover = true;

  doc.on('pageAdded', () => {
    if (isCover) return;
    interiorPage += 1;
    doc.save();
    doc.rect(0, 0, PAGE_W, PAGE_H).fill(COLORS.paper);
    doc.restore();
    const savedX = doc.x;
    const savedY = doc.y;
    doc.save();
    doc.font('Body').fontSize(7.5).fillColor(COLORS.muted);
    doc.text(runningTitle.toLocaleUpperCase('ru'), MARGIN_X, 24, {
      width: CONTENT_W - 70, lineBreak: false, characterSpacing: 0.55,
    });
    doc.moveTo(MARGIN_X, 39).lineTo(PAGE_W - MARGIN_X, 39).lineWidth(0.5).stroke(COLORS.line);
    doc.moveTo(MARGIN_X, PAGE_H - 35).lineTo(PAGE_W - MARGIN_X, PAGE_H - 35).lineWidth(0.5).stroke(COLORS.line);
    doc.text(String(interiorPage).padStart(2, '0'), PAGE_W - MARGIN_X - 32, PAGE_H - 27, {
      width: 32, align: 'right', lineBreak: false,
    });
    doc.restore();
    doc.x = savedX;
    doc.y = savedY;
  });

  // Preserve the supplied cover artwork as-is.
  doc.image(cover, 0, 0, { width: PAGE_W, height: PAGE_H });
  isCover = false;

  const addPage = (title) => {
    runningTitle = title;
    doc.addPage({ size: [PAGE_W, PAGE_H], margin: 0 });
    doc.x = MARGIN_X;
    doc.y = 56;
  };

  const heading = (text, level = 3) => {
    const size = level === 3 ? 17 : 13;
    const gapBefore = level === 3 ? 18 : 11;
    const gapAfter = level === 3 ? 7 : 5;
    ensureSpace(size + gapBefore + gapAfter);
    doc.moveDown(0.15);
    doc.font('Bold').fontSize(size).fillColor(level === 3 ? COLORS.ink : COLORS.rust)
      .text(text, MARGIN_X, doc.y + gapBefore, { width: CONTENT_W, lineGap: 1 });
    doc.moveDown(0.08);
    doc.font('Body').fontSize(10.5).fillColor(COLORS.ink);
  };

  function ensureSpace(height) {
    if (doc.y + height > PAGE_H - 52) {
      addPage(runningTitle);
    }
  }

  function drawParagraph(text, { quote = false, callout = false } = {}) {
    const clean = displayText(text);
    if (!clean) return;
    const width = CONTENT_W - (quote ? 24 : 0);
    const fontSize = quote ? 10.3 : 10.5;
    const textOptions = { width, fontSize, lineGap: 3.1, paragraphGap: 0, align: 'left' };
    const runs = inlineRuns(clean);
    const height = doc.heightOfString(runs, textOptions);
    const padding = callout ? 8 : quote ? 10 : 0;
    ensureSpace(height + padding * 2 + 8);
    const startY = doc.y;

    if (callout || quote) {
      const x = MARGIN_X;
      const boxWidth = CONTENT_W;
      const bg = quote ? '#f1f0eb' : (clean.toLocaleUpperCase('ru').includes('ГОНЗО') ? COLORS.rustPale : COLORS.notePale);
      doc.save();
      doc.roundedRect(x, startY, boxWidth, height + padding * 2, 3).fill(bg);
      if (!quote) {
        const accent = clean.toLocaleUpperCase('ru').includes('ГОНЗО') ? COLORS.rust : '#b19a73';
        doc.rect(x, startY, 3, height + padding * 2).fill(accent);
      }
      doc.restore();
      doc.font('Body').fontSize(fontSize).fillColor(quote ? '#45443f' : COLORS.noteInk)
        .text(runs, x + padding + (quote ? 0 : 5), startY + padding, textOptions);
      doc.y = startY + height + padding * 2 + 7;
    } else {
      doc.font('Body').fontSize(fontSize).fillColor(COLORS.ink)
        .text(runs, MARGIN_X, startY, textOptions);
      doc.y = startY + height + 8;
    }
  }

  function drawListItem(text, ordered, number) {
    const clean = displayText(text);
    const marker = ordered ? `${number}.` : '•';
    const runs = inlineRuns(clean);
    const opts = { width: CONTENT_W - 28, fontSize: 10.2, lineGap: 2.7 };
    const height = doc.heightOfString(runs, opts);
    ensureSpace(height + 6);
    const y = doc.y;
    doc.font('Bold').fontSize(10).fillColor(COLORS.rust).text(marker, MARGIN_X + 3, y, { width: 22, lineBreak: false });
    doc.font('Body').fontSize(10.2).fillColor(COLORS.ink).text(runs, MARGIN_X + 25, y, opts);
    doc.y = y + height + 4;
  }

  function drawTable(rows) {
    if (!rows.length) return;
    const columnCount = Math.max(...rows.map((row) => row.length));
    const widths = columnCount === 3
      ? [CONTENT_W * 0.22, CONTENT_W * 0.30, CONTENT_W * 0.48]
      : Array(columnCount).fill(CONTENT_W / columnCount);
    const fontSize = 8.7;
    const padY = 6;
    let y = doc.y + 5;

    rows.forEach((row, rowIndex) => {
      const cells = Array.from({ length: columnCount }, (_, i) => row[i] || '');
      const heights = cells.map((cell, i) => doc.heightOfString(inlineRuns(cell), {
        width: widths[i] - 12, fontSize, lineGap: 2,
      }));
      const rowH = Math.max(...heights) + padY * 2;
      if (y + rowH > PAGE_H - 51) {
        addPage(runningTitle);
        y = doc.y;
      }
      if (rowIndex === 0) {
        doc.rect(MARGIN_X, y, CONTENT_W, rowH).fill('#eae7de');
      } else if (rowIndex % 2 === 0) {
        doc.rect(MARGIN_X, y, CONTENT_W, rowH).fill('#f6f4ee');
      }
      let x = MARGIN_X;
      cells.forEach((cell, i) => {
        const runs = rowIndex === 0
          ? inlineRuns(cell).map((run) => ({ ...run, options: { ...(run.options || {}), font: 'Bold' } }))
          : inlineRuns(cell);
        doc.font(rowIndex === 0 ? 'Bold' : 'Body').fontSize(fontSize)
          .fillColor(rowIndex === 0 ? COLORS.ink : '#44433e')
          .text(runs, x + 6, y + padY, { width: widths[i] - 12, fontSize, lineGap: 2 });
        x += widths[i];
      });
      doc.moveTo(MARGIN_X, y + rowH).lineTo(MARGIN_X + CONTENT_W, y + rowH).lineWidth(0.35).stroke(COLORS.line);
      y += rowH;
    });
    doc.y = y + 12;
  }

  function renderBlocks(lines) {
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line || /^---+$/.test(line)) { i += 1; continue; }

      if (line.startsWith('|')) {
        const tableLines = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          const row = lines[i].trim();
          if (!/^\|?\s*:?-{3,}/.test(row.replace(/\|/g, '').trim())) tableLines.push(parseTableRow(row));
          i += 1;
        }
        drawTable(tableLines);
        continue;
      }

      const subheading = line.match(/^(#{3,6})\s+(.+)$/);
      if (subheading) {
        heading(displayText(subheading[2]), subheading[1].length === 3 ? 3 : 4);
        i += 1;
        continue;
      }

      const quote = line.startsWith('>');
      if (quote) {
        const chunks = [];
        while (i < lines.length && lines[i].trim().startsWith('>')) {
          chunks.push(lines[i].trim().replace(/^>\s?/, ''));
          i += 1;
        }
        drawParagraph(chunks.join(' '), { quote: true });
        continue;
      }

      const list = line.match(/^\s*([-*+]\s+|\d+[.)]\s+)(.*)$/);
      if (list) {
        const ordered = /^\d/.test(list[1].trim());
        let number = ordered ? Number.parseInt(list[1], 10) : 0;
        while (i < lines.length) {
          const item = lines[i].match(/^\s*([-*+]\s+|\d+[.)]\s+)(.*)$/);
          if (!item) break;
          drawListItem(item[2], ordered, number || 1);
          if (ordered) number += 1;
          i += 1;
        }
        doc.moveDown(0.25);
        continue;
      }

      const paragraph = [line];
      i += 1;
      while (i < lines.length) {
        const next = lines[i].trim();
        if (!next || /^---+$/.test(next) || next.startsWith('|') || next.startsWith('>') ||
            /^(#{3,6})\s+/.test(next) || /^\s*([-*+]\s+|\d+[.)]\s+)/.test(next)) break;
        paragraph.push(next);
        i += 1;
      }
      const text = paragraph.join(' ').replace(/\s+/g, ' ');
      const isEditorialNote = /^\[/.test(text) || /\[(?:АВТОР|ЗАМЕТКА|ЧЕРНОВИК|ПРОВЕРИТЬ|МЕСТО ДЛЯ|ИСХОДНЫЙ|ГОНЗО|НАЗВАНИЕ)/i.test(text);
      drawParagraph(text, { callout: isEditorialNote });
    }
  }

  // A quiet, readable contents list is generated from actual manuscript headings.
  const contents = sections.map((section) => section.title);
  const contentsRows = [];
  const sectionPages = [];
  const PER_CONTENTS_PAGE = 24;
  for (let start = 0; start < contents.length; start += PER_CONTENTS_PAGE) {
    addPage('Содержание');
    doc.font('Bold').fontSize(26).fillColor(COLORS.ink)
      .text(start === 0 ? 'СОДЕРЖАНИЕ' : 'СОДЕРЖАНИЕ · ПРОДОЛЖЕНИЕ', MARGIN_X, 63, { width: CONTENT_W });
    doc.font('Body').fontSize(9.2).fillColor(COLORS.muted)
      .text('Рабочая сборка рукописи · редакционные заметки и рецептурные поля пока сохранены', MARGIN_X, 101, { width: CONTENT_W });
    let y = 132;
    contents.slice(start, start + PER_CONTENTS_PAGE).forEach((title, index) => {
      const ordinal = String(start + index + 1).padStart(2, '0');
      doc.font('Body').fontSize(10.1).fillColor(COLORS.rust)
        .text(ordinal, MARGIN_X, y, { width: 27, lineBreak: false });
      doc.font('Body').fontSize(10.1).fillColor(COLORS.ink)
        .text(title, MARGIN_X + 32, y, { width: CONTENT_W - 72, lineBreak: false });
      doc.moveTo(MARGIN_X + 32, y + 15).lineTo(PAGE_W - MARGIN_X, y + 15).lineWidth(0.25).stroke('#e6e3da');
      contentsRows.push({ pageIndex: interiorPage, y, sectionIndex: start + index });
      y += 17;
    });
  }

  sections.forEach((section) => {
    addPage(section.title);
    sectionPages.push(interiorPage + 1);
    doc.font('Bold').fontSize(31).fillColor(COLORS.ink)
      .text(section.title.toLocaleUpperCase('ru'), MARGIN_X, 60, {
        width: CONTENT_W, lineGap: 1, characterSpacing: -0.4,
      });
    doc.moveTo(MARGIN_X, doc.y + 10).lineTo(MARGIN_X + 74, doc.y + 10).lineWidth(2).stroke(COLORS.rust);
    doc.y += 26;

    const illustrationEntry = ILLUSTRATIONS.find(([pattern]) => pattern.test(section.title));
    if (illustrationEntry) {
      const imagePath = path.join(ROOT, 'assets', 'illustrations', illustrationEntry[1]);
      if (fs.existsSync(imagePath)) {
        const imageY = doc.y;
        doc.image(imageBuffers.get(imagePath), PAGE_W - MARGIN_X - 145, imageY, { fit: [145, 105], align: 'center', valign: 'center' });
        doc.font('Body').fontSize(7.5).fillColor(COLORS.muted)
          .text('Иллюстрация к главе', PAGE_W - MARGIN_X - 145, imageY + 107, { width: 145, align: 'center' });
        doc.y += 121;
      }
    }
    renderBlocks(section.lines);
  });

  // Fill in the live page numbers after chapters have flowed across any continuation pages.
  contentsRows.forEach(({ pageIndex, y, sectionIndex }) => {
    doc.switchToPage(pageIndex);
    doc.font('Body').fontSize(9).fillColor(COLORS.rust)
      .text(String(sectionPages[sectionIndex]), PAGE_W - MARGIN_X - 28, y, { width: 28, align: 'right', lineBreak: false });
  });
  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve({ output, pages: interiorPage + 1, chapters: sections.length }));
    stream.on('error', reject);
    doc.on('error', reject);
  });
}

if (require.main === module) {
  const requestedOutput = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : DEFAULT_OUTPUT;
  createBuilder({ output: requestedOutput })
    .then(({ output, pages, chapters }) => {
      console.log(`Built ${chapters} manuscript sections into ${output} (${pages} pages including cover).`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = { extractSections, inlineRuns, createBuilder };

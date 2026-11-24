#!/usr/bin/env node
/**
 * Конвертер тестовых иллюстраций визуального языка (MASTER PROMPT 03, этап 3).
 *
 * Мастера:      все PNG в assets/tests, включая подпапки (слои «бумажного театра»)
 * Результат:    webp в docs/assets/tests, структура папок сохраняется
 *
 * PNG-мастера остаются в assets/ (для печати), в docs/ попадают только webp —
 * как и для остальных иллюстраций книги.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'tests');
const OUT = path.join(ROOT, 'docs', 'assets', 'tests');
const WIDTH = 1600;

let sharp = null;
try {
  sharp = require('sharp');
} catch (err) {
  console.warn('[тесты] sharp не установлен, копирую PNG как есть:', err.message);
}

/** Собирает относительные пути всех PNG внутри каталога (рекурсивно). */
function walk(dir, rel = '') {
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    const r = rel ? path.join(rel, name) : name;
    if (fs.statSync(abs).isDirectory()) out.push(...walk(abs, r));
    else if (name.toLowerCase().endsWith('.png')) out.push(r);
  }
  return out;
}

async function main() {
  if (!fs.existsSync(SRC)) {
    console.log('[тесты] assets/tests не найден — пропускаю.');
    return;
  }

  fs.mkdirSync(OUT, { recursive: true });
  for (const name of fs.readdirSync(OUT)) {
    fs.rmSync(path.join(OUT, name), { force: true, recursive: true });
  }

  for (const rel of walk(SRC)) {
    const src = path.join(SRC, rel);
    const base = rel.replace(/\.png$/i, '');
    const destDir = path.join(OUT, path.dirname(rel));
    fs.mkdirSync(destDir, { recursive: true });
    if (sharp) {
      const dest = path.join(OUT, `${base}.webp`);
      await sharp(src)
        .resize({ width: WIDTH, withoutEnlargement: true })
        .webp({ quality: 82, smartSubsample: true })
        .toFile(dest);
      const kb = Math.round(fs.statSync(dest).size / 1024);
      console.log(`  ${rel} → ${base}.webp (${kb} КБ)`);
    } else {
      fs.copyFileSync(src, path.join(OUT, rel));
      console.log(`  ${rel} → копия PNG`);
    }
  }

  // Метаданные сцен копируем как есть: их читает рантайм «бумажного театра».
  for (const rel of walk(SRC)) {
    const metaSrc = path.join(SRC, path.dirname(rel), 'scene_metadata.json');
    if (fs.existsSync(metaSrc)) {
      const metaDest = path.join(OUT, path.dirname(rel), 'scene_metadata.json');
      fs.copyFileSync(metaSrc, metaDest);
    }
  }
  for (const name of fs.readdirSync(SRC)) {
    const abs = path.join(SRC, name);
    if (fs.statSync(abs).isDirectory()) {
      const metaSrc = path.join(abs, 'scene_metadata.json');
      if (fs.existsSync(metaSrc)) {
        const metaDest = path.join(OUT, name, 'scene_metadata.json');
        fs.mkdirSync(path.dirname(metaDest), { recursive: true });
        fs.copyFileSync(metaSrc, metaDest);
      }
    }
  }
  console.log('[тесты] готово.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

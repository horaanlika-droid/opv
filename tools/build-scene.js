#!/usr/bin/env node
'use strict';

/**
 * Слои центральной сцены «Сахалин в разрезе».
 *
 * Генерирует акварельно-тушевые SVG-слои для пяти природных уровней книги:
 * горы, лес, реки и долины, побережье, море. Каждый слой — отдельный файл
 * с прозрачным фоном, чтобы в браузере двигать планы с разной скоростью
 * и не перерисовывать сцену при прокрутке.
 *
 * Запуск: npm run build:art
 *
 * Генерация детерминированная (фиксированные зёрна), поэтому повторная
 * сборка даёт те же файлы. Это не замена авторским иллюстрациям продуктов:
 * здесь только среда — рельеф, лес, вода и берег.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'assets', 'art');
const GEO = path.join(ROOT, 'docs', 'assets', 'geo', 'sakhalin.json');

/* ——— Палитра: старая бумага, серо-голубой, морской синий, мшистый и
       хвойный зелёный, приглушённый охристый, графит, туманный серый. ——— */

const C = {
  paper: '#f2ede0',
  paperDeep: '#e6dfcd',
  paperWarm: '#efe6d2',
  ink: '#243134',
  inkSoft: '#46585c',
  mist: '#c9d3d1',
  mistDeep: '#aab8b8',
  slate: '#7d9094',
  slateDeep: '#5b7177',
  sea: '#3f6068',
  seaDeep: '#28454f',
  seaInk: '#1b333c',
  moss: '#7c8b62',
  mossDeep: '#5c6c48',
  conifer: '#3f5647',
  coniferDeep: '#2b3d35',
  ochre: '#b08a5d',
  ochreDeep: '#8a6840',
  graphite: '#3a4344',
  clay: '#a9744f',
  ice: '#dfe8e7',
  shell: '#e8ddc9',
  blush: '#c58f78',
};

/* ——— Детерминированный случай ——— */

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRandom(seed) {
  const rnd = mulberry32(seed);
  return {
    next: rnd,
    range: (a, b) => a + (b - a) * rnd(),
    int: (a, b) => Math.floor(a + (b - a + 1) * rnd()),
    chance: (p) => rnd() < p,
    pick: (arr) => arr[Math.floor(rnd() * arr.length)],
  };
}

/* ——— Геометрия путей ——— */

const n = (v) => Math.round(v * 10) / 10;

function moveTo(p) {
  return `M${n(p.x)} ${n(p.y)}`;
}

function lineTo(p) {
  return `L${n(p.x)} ${n(p.y)}`;
}

function pointsToPath(points, close) {
  if (!points.length) return '';
  let d = moveTo(points[0]);
  for (let i = 1; i < points.length; i++) d += lineTo(points[i]);
  return d + (close ? 'Z' : '');
}

/** Гладкая кривая по точкам (Catmull-Rom → кубические Безье). */
function smoothPath(points, close, tension) {
  if (points.length < 2) return pointsToPath(points, close);
  const t = tension == null ? 0.5 : tension;
  const pts = points.slice();
  if (close) pts.push(points[0]);

  let d = moveTo(pts[0]);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[0];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1 = { x: p1.x + ((p2.x - p0.x) / 6) * t * 2, y: p1.y + ((p2.y - p0.y) / 6) * t * 2 };
    const c2 = { x: p2.x - ((p3.x - p1.x) / 6) * t * 2, y: p2.y - ((p3.y - p1.y) / 6) * t * 2 };
    d += `C${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(p2.x)} ${n(p2.y)}`;
  }
  return d + (close ? 'Z' : '');
}

/** Хребет: неровная линия с мягкими вершинами и распадками. */
function ridge(opts) {
  const rnd = makeRandom(opts.seed);
  const { x0, x1, baseY, height, peaks, wide } = opts;
  const pts = [];
  const step = (x1 - x0) / (peaks * 5);
  // опорные вершины
  const summits = [];
  for (let i = 0; i < peaks; i++) {
    const t = (i + 0.5) / peaks;
    summits.push({
      x: x0 + t * (x1 - x0) + rnd.range(-step, step),
      y: baseY - height * rnd.range(0.55, 1),
      w: (wide || 1) * rnd.range(0.7, 1.25),
    });
  }
  for (let x = x0; x <= x1 + 0.1; x += step) {
    // выпуклость от ближайших вершин
    let y = baseY;
    for (const s of summits) {
      const d = Math.abs(x - s.x) / (step * 5.5 * s.w);
      if (d < 1) {
        const shape = Math.pow(Math.cos((d * Math.PI) / 2), 1.6);
        y = Math.min(y, s.y + (baseY - s.y) * (1 - shape));
      }
    }
    // мелкая неровность: сколы и распадки
    y += rnd.range(-1, 1) * height * 0.035;
    pts.push({ x, y });
  }
  return pts;
}

/* ——— Фрагменты рисунка ——— */

function group(attrs, children) {
  return `<g ${attrs}>${children.join('')}</g>`;
}

function defsCommon(seed) {
  return `
  <filter id="wash" x="-20%" y="-20%" width="140%" height="140%">
    <feTurbulence type="fractalNoise" baseFrequency="0.006 0.026" numOctaves="4" seed="${seed}" result="noise"/>
    <feDisplacementMap in="SourceGraphic" in2="noise" scale="18" xChannelSelector="R" yChannelSelector="G" result="shape"/>
    <feGaussianBlur in="shape" stdDeviation="1.6"/>
  </filter>
  <filter id="washSoft" x="-25%" y="-25%" width="150%" height="150%">
    <feTurbulence type="fractalNoise" baseFrequency="0.01 0.035" numOctaves="3" seed="${seed + 3}" result="noise"/>
    <feDisplacementMap in="SourceGraphic" in2="noise" scale="26" xChannelSelector="R" yChannelSelector="G" result="shape"/>
    <feGaussianBlur in="shape" stdDeviation="7"/>
  </filter>
  <filter id="ink" x="-20%" y="-20%" width="140%" height="140%">
    <feTurbulence type="fractalNoise" baseFrequency="0.028 0.05" numOctaves="2" seed="${seed + 7}" result="noise"/>
    <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.4" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
  <filter id="grain" x="0%" y="0%" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${seed + 11}" result="t"/>
    <feColorMatrix in="t" type="saturate" values="0"/>
    <feComponentTransfer><feFuncA type="linear" slope="0.5"/></feComponentTransfer>
  </filter>
  <filter id="soften" x="-15%" y="-15%" width="130%" height="130%">
    <feGaussianBlur stdDeviation="2.6"/>
  </filter>`;
}

function grainOverlay(w, h, opacity) {
  return `<rect width="${w}" height="${h}" filter="url(#grain)" opacity="${opacity}" style="mix-blend-mode:multiply"/>`;
}

/** Акварельная заливка: цвет + второй слой с другим смещением. */
function washShape(d, color, opacity, opts) {
  const o = opts || {};
  const filterId = o.soft ? 'url(#washSoft)' : 'url(#wash)';
  let out = `<path d="${d}" fill="${color}" opacity="${opacity}" filter="${filterId}"/>`;
  if (o.second !== false) {
    out += `<path d="${d}" fill="${o.secondColor || color}" opacity="${(opacity * 0.42).toFixed(2)}" filter="url(#washSoft)" transform="translate(${n(o.dx || 3)} ${n(o.dy || 4)})"/>`;
  }
  return out;
}

/** Тушевой контур: дрожащая линия. */
function inkLine(d, color, width, opacity) {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}" filter="url(#ink)"/>`;
}

/** Сухая кисть: короткие штрихи вдоль поверхности. */
function hatch(rnd, x0, x1, yFn, count, opts) {
  const o = opts || {};
  const parts = [];
  for (let i = 0; i < count; i++) {
    const x = rnd.range(x0, x1);
    const y = yFn(x) + rnd.range(-1, 1) * (o.spread || 6);
    const len = rnd.range(o.minLen || 6, o.maxLen || 26);
    const slope = rnd.range(-0.35, 0.35) + (o.slope || 0);
    const d = `M${n(x)} ${n(y)}q${n(len * 0.5)} ${n(len * slope * 0.4)} ${n(len)} ${n(len * slope)}`;
    parts.push(
      `<path d="${d}" fill="none" stroke="${o.color || C.inkSoft}" stroke-width="${n(rnd.range(0.4, 1.1))}" opacity="${n(rnd.range((o.minOp || 0.1) , (o.maxOp || 0.42)))}" stroke-linecap="round"/>`
    );
  }
  return parts.join('');
}

/* ——— Облака и туман ——— */

function cloudBand(rnd, opts) {
  const o = opts || {};
  const count = o.count || 7;
  const parts = [];
  for (let i = 0; i < count; i++) {
    const cx = rnd.range(o.x0, o.x1);
    const cy = rnd.range(o.y0, o.y1);
    const rx = rnd.range(o.minR || 60, o.maxR || 150);
    const ry = rx * rnd.range(0.18, 0.34);
    parts.push(
      `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" fill="${o.color || C.paperWarm}" opacity="${n(rnd.range(0.35, 0.7))}" filter="url(#washSoft)"/>`
    );
  }
  return parts.join('');
}

module.exports = {
  C,
  makeRandom,
  ridge,
  smoothPath,
  pointsToPath,
  defsCommon,
  grainOverlay,
  washShape,
  inkLine,
  hatch,
  cloudBand,
  group,
  n,
};

/* ——— Сборка файлов ——— */

const SCENES = {};

function svgDoc(w, h, seed, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-hidden="true">
<defs>${defsCommon(seed)}</defs>
${body}
</svg>
`;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const written = [];
  for (const [name, make] of Object.entries(SCENES)) {
    const file = make();
    if (!file) continue;
    const dest = path.join(OUT_DIR, `${name}.svg`);
    fs.writeFileSync(dest, file, 'utf8');
    written.push({ name, size: fs.statSync(dest).size });
  }
  for (const w of written) {
    console.log(`  ${w.name}.svg — ${Math.round(w.size / 1024)} КБ`);
  }
  console.log(`Готово: ${written.length} слоёв в ${path.relative(ROOT, OUT_DIR)}`);
}

if (require.main === module) main();

module.exports.SCENES = SCENES;
module.exports.svgDoc = svgDoc;
module.exports.OUT_DIR = OUT_DIR;
module.exports.GEO = GEO;

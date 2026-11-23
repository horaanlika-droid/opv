#!/usr/bin/env node
'use strict';

/**
 * Сборка художественных слоёв сайта книги.
 *
 * Исходники — рукописные акварельно-тушевые листы в assets/art/tex-*.png
 * (бумага + пигмент). Скрипт переводит бумагу в прозрачность: плотность
 * пигмента становится альфой, поэтому разливы и мягкие края сохраняются
 * без «вырезанных» границ. Остров режется по настоящей береговой линии
 * Сахалина из docs/assets/geo/sakhalin.json (Natural Earth, public domain).
 *
 * Запуск: npm run build:art
 * Результат: docs/assets/art/*.webp с прозрачным фоном.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'art');
const OUT = path.join(ROOT, 'docs', 'assets', 'art');
const GEO = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'assets', 'geo', 'sakhalin.json'), 'utf8'));

const INK = '#1b2c31';
const SLATE = '#5b7277';

/* ——— Утилиты ——— */

function textureFile(name) {
  const file = path.join(SRC, `tex-${name}.png`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `Нет исходного листа ${path.relative(ROOT, file)}. ` +
        'assets/art/tex-*.png — рукописные фактуры книги; см. assets/art/README.md'
    );
  }
  return file;
}

/** Цвет бумаги листа: самый частый светлый тон (не белая подложка PNG). */
async function paperColor(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const hist = new Map();
  for (let y = Math.floor(H * 0.12); y < H * 0.88; y += 6) {
    for (let x = Math.floor(W * 0.12); x < W * 0.88; x += 6) {
      const i = (y * W + x) * C;
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      if (r + g + b < 660) continue;
      const k = `${r >> 2},${g >> 2},${b >> 2}`;
      hist.set(k, (hist.get(k) || 0) + 1);
    }
  }
  let best = null;
  let count = 0;
  for (const [k, c] of hist) if (c > count) { count = c; best = k; }
  if (!best) return [242, 236, 218];
  return best.split(',').map((v) => Number(v) * 4 + 2);
}

/**
 * Бумага → прозрачность.
 * a = max(по каналам, насколько тон темнее бумаги) · gain.
 * Цвет разуплотняется, чтобы полупрозрачный пигмент не светлел.
 */
/** Тон листа приводится к бумаге страницы и слегка сглаживается от сетки сканера. */
async function toned(name, opts) {
  const o = opts || {};
  return sharp(textureFile(name))
    .blur(o.blur == null ? 0.5 : o.blur)
    .modulate({ brightness: o.brightness || 0.995, saturation: o.saturation || 0.92 })
    .linear(o.contrast == null ? 1 : o.contrast, o.offset || 0)
    .png()
    .toBuffer();
}

/**
 * Бумага → прозрачность.
 * Плотность краски считается по локальной (усреднённой) бумаге каждого канала,
 * поэтому неровная подсветка листа не становится «пигментом».
 */
async function paperToAlpha(name, gain, opts) {
  const o = opts || {};
  const file = textureFile(name);
  const base = await toned(name, o);
  const { data, info } = await sharp(base).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const ref = o.paper || [241, 234, 216];

  const sw = Math.max(6, Math.round(W / 46));
  const sh = Math.max(6, Math.round(H / 46));
  const planes = [];
  for (let ch = 0; ch < 3; ch++) {
    const plane = Buffer.alloc(W * H);
    for (let p = 0, i = ch; p < W * H; p++, i += C) plane[p] = data[i];
    const small = await sharp(plane, { raw: { width: W, height: H, channels: 1 } })
      .resize(sw, sh, { fit: 'fill' })
      .toBuffer();
    planes.push(
      await sharp(small, { raw: { width: sw, height: sh, channels: 1 } })
        .resize(W, H, { fit: 'fill' })
        .raw()
        .toBuffer()
    );
  }

  const out = Buffer.alloc(W * H * 4);
  for (let p = 0, i = 0; p < W * H; p++, i += C) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const dr = 1 - r / Math.max(40, planes[0][p]);
    const dg = 1 - g / Math.max(40, planes[1][p]);
    const db = 1 - b / Math.max(40, planes[2][p]);
    let a = Math.max(0, Math.max(dr, dg, db)) * gain;
    a = Math.min(1, a);
    if (a < 0.035) continue;

    const o4 = p * 4;
    out[o4] = Math.max(0, Math.min(255, Math.round(ref[0] - (ref[0] - r) / Math.max(a, 0.4))));
    out[o4 + 1] = Math.max(0, Math.min(255, Math.round(ref[1] - (ref[1] - g) / Math.max(a, 0.4))));
    out[o4 + 2] = Math.max(0, Math.min(255, Math.round(ref[2] - (ref[2] - b) / Math.max(a, 0.4))));
    out[o4 + 3] = Math.round(Math.min(1, a * 1.2) * 255);
  }
  return sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

async function svgPng(buf, w, h) {
  return sharp(buf).resize(w, h, { fit: 'fill' }).png().toBuffer();
}
function svgBuf(w, h, body) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`
  );
}

async function maskInto(buffer, maskPng) {
  return sharp(buffer).composite([{ input: maskPng, blend: 'dest-in' }]).png().toBuffer();
}

/** Вертикальное затухание: прозрачность по краям, чтобы слои срастались. */
function fadeMask(w, h, stops) {
  const s = stops.map(([o, op]) => `<stop offset="${o}" stop-color="#fff" stop-opacity="${op}"/>`).join('');
  return svgPng(
    svgBuf(
      w,
      h,
      `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">${s}</linearGradient></defs>
       <rect width="${w}" height="${h}" fill="url(#g)"/>`
    ),
    w,
    h
  );
}

async function save(buffer, file, quality) {
  const dest = path.join(OUT, file);
  await sharp(buffer)
    .webp({ quality: quality || 82, alphaQuality: 95, effort: 6 })
    .toFile(dest);
  const kb = Math.round(fs.statSync(dest).size / 1024);
  console.log(`  ${file} — ${kb} КБ`);
}

/* ——— Остров ——— */

function islandTransform(canvasW, canvasH, pad) {
  const bb = GEO.bbox;
  const s = Math.min((canvasW - pad * 2) / (bb.x1 - bb.x0), (canvasH - pad * 2) / (bb.y1 - bb.y0));
  return {
    s,
    ox: (canvasW - (bb.x1 - bb.x0) * s) / 2 - bb.x0 * s,
    oy: (canvasH - (bb.y1 - bb.y0) * s) / 2 - bb.y0 * s,
  };
}
function islandGroup(t) {
  return `<g transform="translate(${t.ox.toFixed(1)} ${t.oy.toFixed(1)}) scale(${t.s.toFixed(4)})">`;
}

/** Контур берега с рукописным дрожанием: не картографическая линейка. */
function coastBuffer(w, h, opts) {
  const o = opts || {};
  const t = islandTransform(w, h, o.pad == null ? w * 0.05 : o.pad);
  const sw = (o.width || 0.75) / t.s;
  return svgPng(
    svgBuf(
      w,
      h,
      `<defs>
        <filter id="wob" x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency="0.006 0.012" numOctaves="3" seed="29" result="n"/>
          <feDisplacementMap in="SourceGraphic" in2="n" scale="${(3.0 / t.s).toFixed(2)}" xChannelSelector="R" yChannelSelector="G" result="d"/>
          <feGaussianBlur in="d" stdDeviation="${(0.5 / t.s).toFixed(2)}"/>
        </filter>
        <filter id="bleed" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="${(6 / t.s).toFixed(2)}"/>
        </filter>
      </defs>
      ${islandGroup(t)}
        <path d="${GEO.sakhalin}" fill="none" stroke="${INK}" stroke-width="${(sw * 2.2).toFixed(2)}" opacity="0.07" filter="url(#bleed)"/>
        <path d="${GEO.sakhalin}" fill="none" stroke="${INK}" stroke-width="${sw.toFixed(2)}" opacity="${o.opacity || 0.46}" filter="url(#wob)" stroke-linejoin="round"/>
      </g>`
    ),
    w,
    h
  );
}

/** Материк и Хоккайдо — намёком: важно положение, а не подробность. */
function neighboursBuffer(w, h, pad) {
  const t = islandTransform(w, h, pad);
  const mainland = (GEO.mainland || [])
    .map((d) => `<path d="${d}" fill="none" stroke="${SLATE}" stroke-width="1.2" stroke-opacity="0.3" stroke-linecap="round"/>`)
    .join('');
  const hok = GEO.hokkaido
    ? `<path d="${GEO.hokkaido}" fill="${SLATE}" fill-opacity="0.1" stroke="${SLATE}" stroke-width="0.9" stroke-opacity="0.26"/>`
    : '';
  return svgPng(svgBuf(w, h, `${islandGroup(t)}${mainland}${hok}</g>`), w, h);
}

async function buildIsland() {
  const w = 1240;
  const h = 1460;
  const pad = 104;
  const t = islandTransform(w, h, pad);

  const mask = await svgPng(svgBuf(w, h, `${islandGroup(t)}<path d="${GEO.sakhalin}" fill="#fff"/></g>`), w, h);

  // Суша: живопись листа обрезается по берегу и остаётся непрозрачной —
  // так сохраняются разливы и штриховка без потерь на извлечении альфы.
  const land = await toned('landform', { saturation: 0.95 });
  const landMeta = await sharp(land).metadata();
  const landLayer = await maskInto(
    await sharp(land)
      .extract({
        left: Math.round(landMeta.width * 0.18),
        top: Math.round(landMeta.height * 0.14),
        width: Math.round(landMeta.width * 0.64),
        height: Math.round(landMeta.height * 0.72),
      })
      .resize(w, h, { fit: 'cover', position: 'centre' })
      .toBuffer(),
    mask
  );

  // Рельеф: второй лист поверх, мягко и только внутри острова.
  const relief = await toned('ridges', { saturation: 0.9 });
  const rMeta = await sharp(relief).metadata();
  const reliefCut = await maskInto(
    await sharp(relief)
      .extract({
        left: Math.round(rMeta.width * 0.22),
        top: Math.round(rMeta.height * 0.3),
        width: Math.round(rMeta.width * 0.58),
        height: Math.round(rMeta.height * 0.46),
      })
      .resize(w, h, { fit: 'cover', position: 'centre' })
      .ensureAlpha(0.28)
      .toBuffer(),
    mask
  );

  const shadowAlpha = await sharp(mask).extractChannel(3).blur(Math.round(w * 0.007)).toBuffer();
  const shadow = await sharp(shadowAlpha).linear(-150, 255).toColourspace('b-w').png().toBuffer();

  const coast = await coastBuffer(w, h, { pad });
  const neighbours = await neighboursBuffer(w, h, pad);
  const paperBg = await sharp(await toned('paper', { contrast: 1, brightness: 1 }))
    .resize(w, h, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();

  const poster = await sharp(paperBg)
    .composite([
      { input: shadow, blend: 'multiply', opacity: 0.8 },
      { input: neighbours },
      { input: landLayer },
      { input: reliefCut },
      { input: coast },
    ])
    .png()
    .toBuffer();
  await save(poster, 'island-poster.webp', 82);

  const cut = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: landLayer }, { input: reliefCut }, { input: coast }])
    .png()
    .toBuffer();
  await save(await sharp(cut).trim({ threshold: 4 }).toBuffer(), 'island-cut.webp', 82);

  const silhouette = await sharp({
    create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: await maskInto(
          await sharp({ create: { width: w, height: h, channels: 3, background: '#93a19d' } }).png().toBuffer(),
          mask
        ),
      },
      { input: coast },
    ])
    .png()
    .toBuffer();
  await save(await sharp(silhouette).trim({ threshold: 4 }).toBuffer(), 'island-silhouette.webp', 78);
}

/* ——— Природные уровни ——— */

/**
 * Ширина поясов. 1440 px — предел, после которого на акварели перестают
 * проступать новые детали, зато вес растёт линейно: шесть поясов сцены
 * должны оставаться в разумном бюджете загрузки.
 */
const BAND_W = 1440;
const BAND_QUALITY = 68;

/**
 * Полоса природной среды: лист переводится в прозрачность, вертикальные
 * края мягко гаснут, чтобы уровни срастались при прокрутке.
 */
async function band(spec) {
  const { texture, gain, box, w, h, file, quality, fadeTop, fadeBottom } = spec;
  const alpha = await paperToAlpha(texture, gain);
  const meta = await sharp(alpha).metadata();
  const left = Math.round((box.left || 0) * meta.width);
  const top = Math.round((box.top || 0) * meta.height);
  const width = Math.min(meta.width - left, Math.round((box.width || 1) * meta.width));
  const height = Math.min(meta.height - top, Math.round((box.height || 1) * meta.height));
  const cropped = await sharp(alpha).extract({ left, top, width, height }).toBuffer();
  const scaled = await sharp(cropped).resize(w, h, { fit: 'cover', position: 'centre' }).toBuffer();
  const faded = await maskInto(
    scaled,
    await fadeMask(w, h, [
      [0, fadeTop == null ? 0 : fadeTop],
      [0.12, 1],
      [0.86, 1],
      [1, fadeBottom == null ? 0 : fadeBottom],
    ])
  );
  await save(faded, file, quality || 78);
}

async function buildBands() {
  await band({
    texture: 'ridges',
    gain: 3.0,
    box: { left: 0.01, top: 0.06, width: 0.98, height: 0.8 },
    w: BAND_W,
    h: 900,
    file: 'band-mountains.webp',
    fadeTop: 0,
    fadeBottom: 0.55,
    quality: BAND_QUALITY,
  });
  await band({
    texture: 'forest',
    gain: 3.3,
    box: { left: 0.02, top: 0.06, width: 0.96, height: 0.88 },
    w: BAND_W,
    h: 780,
    file: 'band-forest.webp',
    fadeTop: 0,
    fadeBottom: 0,
    quality: BAND_QUALITY,
  });
  await band({
    texture: 'river',
    gain: 3.1,
    box: { left: 0.01, top: 0.08, width: 0.98, height: 0.84 },
    w: BAND_W,
    h: 720,
    file: 'band-river.webp',
    fadeTop: 0,
    fadeBottom: 0,
    quality: BAND_QUALITY,
  });
  await band({
    texture: 'coast',
    gain: 3.2,
    box: { left: 0.0, top: 0.02, width: 1, height: 0.96 },
    w: BAND_W,
    h: 640,
    file: 'band-coast.webp',
    fadeTop: 0,
    fadeBottom: 0.3,
    quality: BAND_QUALITY,
  });
  await band({
    texture: 'water',
    gain: 3.0,
    box: { left: 0.0, top: 0.02, width: 1, height: 0.92 },
    w: BAND_W,
    h: 800,
    file: 'band-sea.webp',
    fadeTop: 0.3,
    fadeBottom: 0,
    quality: BAND_QUALITY,
  });
  await band({
    texture: 'depth',
    gain: 2.6,
    box: { left: 0.01, top: 0.02, width: 0.98, height: 0.96 },
    w: BAND_W,
    h: 860,
    file: 'band-depth.webp',
    fadeTop: 0,
    fadeBottom: 0.2,
    quality: BAND_QUALITY,
  });
}

/* ——— Туман и бумага ——— */

async function buildAtmosphere() {
  const w = 1700;
  const h = 1200;
  const sheet = await sharp(await toned('paper')).resize(w, h, { fit: 'cover', position: 'centre' }).toBuffer();

  const specs = [
    { file: 'fog-near.webp', blur: 22, opacity: 0.92, tint: '#f8f2e2' },
    { file: 'fog-mid.webp', blur: 40, opacity: 0.8, tint: '#f3eddd' },
    { file: 'fog-far.webp', blur: 60, opacity: 0.66, tint: '#ecE6d5' },
  ];

  for (const s of specs) {
    const soft = await sharp(sheet).blur(s.blur).tint(s.tint).ensureAlpha(s.opacity).toBuffer();
    const cloudMask = await svgPng(
      svgBuf(
        w,
        h,
        `<defs>
          <filter id="cl" x="-15%" y="-15%" width="130%" height="130%">
            <feTurbulence type="fractalNoise" baseFrequency="0.0016 0.0032" numOctaves="5" seed="7" result="n"/>
            <feComponentTransfer in="n" result="c">
              <feFuncR type="table" tableValues="0.15 0.55 0.8 1 0.85"/>
              <feFuncG type="table" tableValues="0.15 0.55 0.8 1 0.85"/>
              <feFuncB type="table" tableValues="0.15 0.55 0.8 1 0.85"/>
            </feComponentTransfer>
            <feGaussianBlur in="c" stdDeviation="9"/>
          </filter>
        </defs>
        <rect width="${w}" height="${h}" fill="#fff" filter="url(#cl)"/>`
      ),
      w,
      h
    );
    await save(await maskInto(soft, cloudMask), s.file, 76);
  }

  // Бумага страницы (плитка).
  const tile = await sharp(sheet).resize(900, 900, { fit: 'cover' }).webp({ quality: 76 }).toBuffer();
  fs.writeFileSync(path.join(OUT, 'paper.webp'), tile);
  console.log(`  paper.webp — ${Math.round(tile.length / 1024)} КБ`);
}

/* ——— Запуск ——— */

if (require.main === module) {
  fs.mkdirSync(OUT, { recursive: true });
  console.log('Остров…');
  buildIsland()
    .then(() => {
      console.log('Природные уровни…');
      return buildBands();
    })
    .then(() => {
      console.log('Туман и бумага…');
      return buildAtmosphere();
    })
    .then(() => console.log('Готово: docs/assets/art/'))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

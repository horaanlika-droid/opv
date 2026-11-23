#!/usr/bin/env node
'use strict';

/**
 * Геометрия острова для центральной сцены книги.
 *
 * Берёт открытые данные Natural Earth (public domain, ne_10m_land) и
 * пересчитывает очертания Сахалина, Хоккайдо и ближайшего материка в
 * локальную плоскую проекцию, пригодную для SVG.
 *
 * Запуск: npm run build:geo
 *
 * Источник (скачать один раз в tools/vendor/, папка в .gitignore):
 *   https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_land.geojson
 *
 * Результат: docs/assets/geo/sakhalin.json — компактные контуры в
 * координатах viewBox 0 0 620 1150 (портретная композиция сцены).
 * Остров не стилизуется и не «сочиняется»: береговая линия, пропорции,
 * северная и южная части и положение относительно материка и Хоккайдо
 * сохраняются как в исходных данных.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'tools', 'vendor', 'ne_10m_land.geojson');
const OUT_DIR = path.join(ROOT, 'docs', 'assets', 'geo');
const OUT_FILE = path.join(OUT_DIR, 'sakhalin.json');

/** Точка с известными координатами — маяк Анива / мыс Анива, юг Сахалина. */
const ANCHOR = { lon: 143.42, lat: 46.02, x: 310, y: 1010 };

/** Метров в единице viewBox. Остров ~950 км длиной занимает ~950 единиц. */
const UNITS_PER_KM = 1;

/** Точность округления координат в JSON (в единицах viewBox). */
const PRECISION = 1;

const VIEW = { w: 620, h: 1150 };

function readFeatures() {
  if (!fs.existsSync(SRC)) {
    throw new Error(
      `Не найден ${path.relative(ROOT, SRC)}.\n` +
        'Скачайте исходные данные Natural Earth:\n' +
        '  curl -L -o tools/vendor/ne_10m_land.geojson \\\n' +
        '    https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson'
    );
  }
  return JSON.parse(fs.readFileSync(SRC, 'utf8')).features;
}

/** Все внешние кольца полигонов, пересекающиеся с окном вокруг Сахалина. */
function ringsInWindow(features, win) {
  const out = [];
  for (const f of features) {
    if (!f.geometry) continue;
    const g = f.geometry;
    const parts = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
    for (const part of parts) {
      const ring = part[0];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const c of ring) {
        if (c[0] < x0) x0 = c[0];
        if (c[0] > x1) x1 = c[0];
        if (c[1] < y0) y0 = c[1];
        if (c[1] > y1) y1 = c[1];
      }
      if (x1 > win[0] && x0 < win[2] && y1 > win[1] && y0 < win[3]) {
        out.push({ ring, bbox: [x0, y0, x1, y1] });
      }
    }
  }
  return out;
}

/** Вырезает из кольца участок, попадающий в окно, и обрезает по его краям. */
function clipRing(ring, win) {
  const pts = ring.filter(
    (c) => c[0] >= win[0] && c[0] <= win[2] && c[1] >= win[1] && c[1] <= win[3]
  );
  return pts;
}

/**
 * Кольцо материка в данных Natural Earth огромное (вся Евразия).
 * Для сцены нужен только ближний берег: берём точки в окне и режем
 * на непрерывные сегменты, чтобы не тянуть линию через весь остров.
 */
function segments(ring, win) {
  const segs = [];
  let cur = null;
  for (const c of ring) {
    const inside = c[0] >= win[0] && c[0] <= win[2] && c[1] >= win[1] && c[1] <= win[3];
    if (inside) {
      if (!cur) {
        cur = [];
        segs.push(cur);
      }
      cur.push(c);
    } else if (cur) {
      cur = null;
    }
  }
  return segs.filter((s) => s.length > 1);
}

function equirectangular(lon, lat) {
  const lat0 = (ANCHOR.lat * Math.PI) / 180;
  const kmPerDegLat = 111.32;
  const kmPerDegLon = 111.32 * Math.cos(lat0);
  const xKm = (lon - ANCHOR.lon) * kmPerDegLon;
  const yKm = -(lat - ANCHOR.lat) * kmPerDegLat;
  return {
    x: ANCHOR.x + xKm * UNITS_PER_KM,
    y: ANCHOR.y + yKm * UNITS_PER_KM,
  };
}

function round(n) {
  const p = Math.pow(10, PRECISION);
  return Math.round(n * p) / p;
}

/** Упрощение Дугласа—Пикера: убирает лишние точки, сохраняя силуэт. */
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const sqTol = tolerance * tolerance;

  function sqSegDist(p, a, b) {
    let x = a.x, y = a.y;
    let dx = b.x - x, dy = b.y - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = b.x; y = b.y; }
      else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = p.x - x; dy = p.y - y;
    return dx * dx + dy * dy;
  }

  function step(first, last, out) {
    let maxDist = sqTol;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = sqSegDist(points[i], points[first], points[last]);
      if (d > maxDist) { index = i; maxDist = d; }
    }
    if (index > 0) {
      if (index - first > 1) step(first, index, out);
      out.push(points[index]);
      if (last - index > 1) step(index, last, out);
    }
  }

  const out = [points[0]];
  step(0, points.length - 1, out);
  out.push(points[points.length - 1]);
  return out;
}

function toPath(points, close) {
  if (!points.length) return '';
  let d = `M${round(points[0].x)} ${round(points[0].y)}`;
  for (let i = 1; i < points.length; i++) {
    d += `L${round(points[i].x)} ${round(points[i].y)}`;
  }
  return d + (close ? 'Z' : '');
}

function main() {
  const features = readFeatures();

  // Окно сцены: Сахалин целиком, ближний берег материка и север Хоккайдо.
  const WIN = [140.2, 44.6, 145.6, 54.9];
  const rings = ringsInWindow(features, WIN);

  // Сахалин — кольцо с bbox 141.6..144.8 / 45.9..54.4.
  const isSakhalin = (b) => b[0] > 141.5 && b[0] < 141.8 && b[1] > 45.8 && b[1] < 46.0;
  // Хоккайдо — крупное кольцо южнее 46° с западной границей у 139.8°.
  const isHokkaido = (b) => b[0] < 140.0 && b[3] < 46.0 && b[2] > 144.0;

  const sakhalinRing = rings.find((r) => isSakhalin(r.bbox));
  const hokkaidoRing = rings.find((r) => isHokkaido(r.bbox));
  if (!sakhalinRing) throw new Error('В данных Natural Earth не найден контур Сахалина');

  const project = (ring) => ring.map((c) => equirectangular(c[0], c[1]));

  const sakhalin = simplify(project(sakhalinRing.ring), 0.4);
  const hokkaido = hokkaidoRing ? simplify(project(hokkaidoRing.ring), 0.8) : [];

  // Материк: только те куски колец, что попадают в окно и лежат западнее Сахалина.
  const mainlandSegs = [];
  for (const r of rings) {
    if (r === sakhalinRing || r === hokkaidoRing) continue;
    if (r.bbox[2] < 140.2) continue;
    for (const seg of segments(r.ring, WIN)) {
      const mid = seg[Math.floor(seg.length / 2)];
      const x = equirectangular(mid[0], mid[1]).x;
      if (x > 330) continue; // не тащим восточный берег через остров
      mainlandSegs.push(simplify(project(seg), 0.9));
    }
  }

  // Границы сцены для среза береговой линии.
  const xs = sakhalin.map((p) => p.x);
  const ys = sakhalin.map((p) => p.y);
  const bbox = {
    x0: round(Math.min(...xs)),
    y0: round(Math.min(...ys)),
    x1: round(Math.max(...xs)),
    y1: round(Math.max(...ys)),
  };

  const data = {
    source: 'Natural Earth 1:10m land (public domain)',
    projection: 'equirectangular, anchor = Cape Aniva (143.42E, 46.02N)',
    units: 'km',
    view: VIEW,
    anchor: ANCHOR,
    bbox,
    sakhalin: toPath(sakhalin, true),
    hokkaido: hokkaido.length ? toPath(hokkaido, true) : '',
    mainland: mainlandSegs.map((s) => toPath(s, false)),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
  const kb = Math.round(fs.statSync(OUT_FILE).size / 1024);
  console.log(
    `Записан ${path.relative(ROOT, OUT_FILE)} (${kb} КБ): Сахалин ${sakhalin.length} точек, ` +
      `Хоккайдо ${hokkaido.length}, материк ${mainlandSegs.length} линий`
  );
  console.log(
    `Остров в сцене: x ${bbox.x0}..${bbox.x1}, y ${bbox.y0}..${bbox.y1} ` +
      `(${bbox.x1 - bbox.x0} × ${bbox.y1 - bbox.y0} единиц)`
  );
}

main();

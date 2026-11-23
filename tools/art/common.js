'use strict';

/**
 * Общие приёмы рисунка для слоёв сцены: палитра, детерминированный
 * случай, геометрия пути, акварельные разливы, тушь, бумажное зерно.
 *
 * Всё строится из простых SVG-примитивов и фильтров, поэтому слои
 * остаются лёгкими, масштабируются без потерь и не требуют растра
 * под каждый размер экрана.
 */

/* ——— Палитра ——— */

const C = {
  paper: '#f3eee1',
  paperDeep: '#e4dcc7',
  paperWarm: '#efe6d0',
  mist: '#cfd8d4',
  mistDeep: '#aebbb8',
  slate: '#7f9396',
  slateDeep: '#5a7075',
  sea: '#3e6169',
  seaDeep: '#274450',
  seaInk: '#172f38',
  moss: '#7e8c62',
  mossDeep: '#5b6b47',
  conifer: '#3e5647',
  coniferDeep: '#2a3c34',
  ochre: '#b28b5d',
  ochreDeep: '#8a6740',
  graphite: '#323c3f',
  clay: '#a8734f',
  ice: '#e2eae7',
  shell: '#e9dfc9',
  blush: '#c08e77',
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
  const api = {
    next: rnd,
    range: (a, b) => a + (b - a) * rnd(),
    int: (a, b) => Math.floor(a + (b - a + 1) * rnd()),
    chance: (p) => rnd() < p,
    pick: (arr) => arr[Math.floor(rnd() * arr.length)],
    sign: () => (rnd() < 0.5 ? -1 : 1),
  };
  return api;
}

/* ——— Числа и пути ——— */

function round(v) {
  return Math.round(v * 10) / 10;
}

function pointsToPath(points, close) {
  if (!points.length) return '';
  let d = `M${round(points[0].x)} ${round(points[0].y)}`;
  for (let i = 1; i < points.length; i++) d += `L${round(points[i].x)} ${round(points[i].y)}`;
  return d + (close ? 'Z' : '');
}

/** Гладкая кривая по точкам (Catmull–Rom в кубические Безье). */
function smoothPath(points, close, tension) {
  if (points.length < 3) return pointsToPath(points, close);
  const t = tension == null ? 0.5 : tension;
  const pts = points.slice();
  if (close) pts.push(points[0]);
  let d = `M${round(pts[0].x)} ${round(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[0];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1 = { x: p1.x + ((p2.x - p0.x) / 6) * t * 2, y: p1.y + ((p2.y - p0.y) / 6) * t * 2 };
    const c2 = { x: p2.x - ((p3.x - p1.x) / 6) * t * 2, y: p2.y - ((p3.y - p1.y) / 6) * t * 2 };
    d += `C${round(c1.x)} ${round(c1.y)} ${round(c2.x)} ${round(c2.y)} ${round(p2.x)} ${round(p2.y)}`;
  }
  return d + (close ? 'Z' : '');
}

/**
 * Хребет: неровная линия с округлыми сопками и распадками.
 * opts: { x0, x1, baseY, height, peaks, seed, sharp, settle }
 */
function ridge(opts) {
  const rnd = makeRandom(opts.seed || 1);
  const { x0, x1, baseY, height } = opts;
  const peaks = opts.peaks || 4;
  const sharp = opts.sharp == null ? 1.6 : opts.sharp;
  const step = (x1 - x0) / (peaks * 6);
  const summits = [];
  for (let i = 0; i < peaks; i++) {
    const t = (i + 0.5) / peaks;
    summits.push({
      x: x0 + t * (x1 - x0) + rnd.range(-step * 1.6, step * 1.6),
      y: baseY - height * rnd.range(opts.minH || 0.55, 1),
      w: rnd.range(0.65, 1.35),
    });
  }
  const pts = [];
  for (let x = x0; x <= x1 + 0.1; x += step) {
    let y = baseY;
    for (const s of summits) {
      const d = Math.abs(x - s.x) / (step * 6.2 * s.w);
      if (d < 1) {
        const shape = Math.pow(Math.cos((d * Math.PI) / 2), sharp);
        const target = s.y + (baseY - s.y) * (1 - shape);
        if (target < y) y = target;
      }
    }
    y += rnd.range(-1, 1) * height * 0.028;
    pts.push({ x, y });
  }
  // «посадка» к краям, чтобы слой не обрывался вертикально
  if (opts.settle !== false) {
    pts.unshift({ x: x0 - step * 2, y: baseY });
    pts.push({ x: x1 + step * 2, y: baseY });
  }
  return pts;
}

/** Замкнутая форма ландшафта: хребет + подошва вниз. */
function terrainShape(points, bottom) {
  const d = smoothPath(points, false, 0.55);
  const last = points[points.length - 1];
  const first = points[0];
  return (
    d +
    `L${round(last.x)} ${round(bottom)}L${round(first.x)} ${round(bottom)}Z`
  );
}

/* ——— Фильтры ——— */

function defs(seed) {
  const s = seed || 1;
  return `
  <filter id="wash" x="-25%" y="-25%" width="150%" height="150%">
    <feTurbulence type="fractalNoise" baseFrequency="0.0045 0.02" numOctaves="4" seed="${s}" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="16" xChannelSelector="R" yChannelSelector="G" result="d"/>
    <feGaussianBlur in="d" stdDeviation="1.5"/>
  </filter>
  <filter id="washEdge" x="-30%" y="-30%" width="160%" height="160%">
    <feTurbulence type="fractalNoise" baseFrequency="0.012 0.03" numOctaves="3" seed="${s + 2}" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="30" xChannelSelector="R" yChannelSelector="G" result="d"/>
    <feGaussianBlur in="d" stdDeviation="6"/>
  </filter>
  <filter id="bloom" x="-30%" y="-30%" width="160%" height="160%">
    <feGaussianBlur stdDeviation="18"/>
  </filter>
  <filter id="ink" x="-15%" y="-15%" width="130%" height="130%">
    <feTurbulence type="fractalNoise" baseFrequency="0.02 0.055" numOctaves="2" seed="${s + 5}" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="3" xChannelSelector="R" yChannelSelector="G" result="d"/>
    <feGaussianBlur in="d" stdDeviation="0.25"/>
  </filter>
  <filter id="grain" x="0%" y="0%" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="3" seed="${s + 9}" result="t"/>
    <feColorMatrix in="t" type="saturate" values="0"/>
    <feComponentTransfer><feFuncA type="linear" slope="0.6"/></feComponentTransfer>
  </filter>
  <filter id="fiber" x="0%" y="0%" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.006 0.9" numOctaves="2" seed="${s + 13}" result="t"/>
    <feColorMatrix in="t" type="saturate" values="0"/>
    <feComponentTransfer><feFuncA type="linear" slope="0.3"/></feComponentTransfer>
  </filter>`;
}

/* ——— Живописные примитивы ——— */

/** Акварельная заливка формы: основной тон, разлив и мягкий край. */
function wash(d, opts) {
  const o = opts || {};
  const op = o.opacity == null ? 0.8 : o.opacity;
  let out = '';
  if (o.bloom) {
    out += `<path d="${d}" fill="${o.color}" opacity="${round(op * 0.35)}" filter="url(#bloom)"/>`;
  }
  out += `<path d="${d}" fill="${o.color}" opacity="${op}" filter="url(#wash)"/>`;
  if (o.deep) {
    out += `<path d="${d}" fill="${o.deep}" opacity="${round(op * 0.38)}" filter="url(#washEdge)" transform="translate(${round(o.dx || 4)} ${round(o.dy || 8)})"/>`;
  }
  return out;
}

function ink(d, opts) {
  const o = opts || {};
  return `<path d="${d}" fill="none" stroke="${o.color || C.graphite}" stroke-width="${o.width || 1.1}" opacity="${o.opacity == null ? 0.6 : o.opacity}" stroke-linecap="round" stroke-linejoin="round" filter="url(#ink)"/>`;
}

function grain(w, h, opacity) {
  return (
    `<rect width="${w}" height="${h}" filter="url(#grain)" opacity="${opacity}" style="mix-blend-mode:multiply"/>` +
    `<rect width="${w}" height="${h}" filter="url(#fiber)" opacity="${round(opacity * 0.4)}" style="mix-blend-mode:multiply"/>`
  );
}

/** Мазки сухой кистью вдоль поверхности. */
function strokes(rnd, count, make, opts) {
  const o = opts || {};
  const out = [];
  for (let i = 0; i < count; i++) {
    const s = make(i);
    if (!s) continue;
    const width = round(rnd.range(o.minW == null ? 0.4 : o.minW, o.maxW == null ? 1.2 : o.maxW));
    const op = round(rnd.range(o.minOp == null ? 0.08 : o.minOp, o.maxOp == null ? 0.34 : o.maxOp));
    out.push(
      `<path d="${s.d}" fill="none" stroke="${s.color || o.color || C.graphite}" stroke-width="${width}" opacity="${op}" stroke-linecap="round"/>`
    );
  }
  return out.join('');
}

/** Мягкий блик/дымка — большие эллипсы с размытием. */
function haze(rnd, count, opts) {
  const o = opts || {};
  const parts = [];
  for (let i = 0; i < count; i++) {
    const cx = rnd.range(o.x0, o.x1);
    const cy = rnd.range(o.y0, o.y1);
    const rx = rnd.range(o.minR || 90, o.maxR || 260);
    const ry = rx * rnd.range(o.minRatio || 0.12, o.maxRatio || 0.3);
    parts.push(
      `<ellipse cx="${round(cx)}" cy="${round(cy)}" rx="${round(rx)}" ry="${round(ry)}" fill="${o.color || C.paperWarm}" opacity="${round(rnd.range(o.minOp || 0.2, o.maxOp || 0.55))}" filter="url(#washEdge)"/>`
    );
  }
  return parts.join('');
}

/* ——— Растительность ——— */

/** Хвойное дерево: тёмный силуэт с рваной кроной. */
function conifer(rnd, x, baseY, h, opts) {
  const o = opts || {};
  const w = h * rnd.range(0.22, 0.34);
  const tiers = Math.max(3, Math.round(h / 22));
  const parts = [];
  // ствол
  parts.push(
    `<path d="M${round(x)} ${round(baseY)}L${round(x + rnd.range(-1.5, 1.5))} ${round(baseY - h)}" stroke="${o.color || C.coniferDeep}" stroke-width="${round(Math.max(0.6, h * 0.02))}" opacity="0.75"/>`
  );
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const yy = baseY - h * (0.18 + t * 0.8);
    const halfW = (w / 2) * (1 - t) * rnd.range(0.8, 1.15);
    const drop = h / tiers * rnd.range(0.7, 1.1);
    parts.push(
      `<path d="M${round(x - halfW)} ${round(yy)}L${round(x + rnd.range(-1.5, 1.5))} ${round(yy - drop)}L${round(x + halfW)} ${round(yy)}Q${round(x)} ${round(yy + drop * 0.28)} ${round(x - halfW)} ${round(yy)}Z" fill="${o.color || C.coniferDeep}" opacity="${o.opacity == null ? 0.8 : o.opacity}"/>`
    );
  }
  return `<g filter="url(#ink)">${parts.join('')}</g>`;
}

/** Берёза каменная / листва: округлая неровная крона. */
function broadleaf(rnd, x, baseY, h, opts) {
  const o = opts || {};
  const color = o.color || C.mossDeep;
  const pts = [];
  const count = 7;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const r = h * 0.26 * rnd.range(0.7, 1.15);
    pts.push({
      x: x + Math.cos(a) * r * 1.1,
      y: baseY - h * 0.7 + Math.sin(a) * r,
    });
  }
  const d =
    `M${round(x)} ${round(baseY)}L${round(x + rnd.range(-1, 1))} ${round(baseY - h * 0.55)}` +
    `<path d="${smoothPath(pts, true, 0.6)}" fill="${color}" opacity="${o.opacity == null ? 0.72 : o.opacity}"/>`;
  return `<g filter="url(#ink)"><path d="M${round(x)} ${round(baseY)}L${round(x)} ${round(baseY - h * 0.5)}" stroke="${color}" stroke-width="1.2" opacity="0.7"/>${d.slice(d.indexOf('<path'))}</g>`;
}

/** Курильский бамбучник: плотная штриховка низкой травы. */
function bambooGrass(rnd, x0, x1, yFn, count, color, opacity) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const x = rnd.range(x0, x1);
    const base = yFn(x) + rnd.range(-2, 3);
    const h = rnd.range(5, 16);
    const lean = rnd.range(-7, 7);
    parts.push(
      `<path d="M${round(x)} ${round(base)}q${round(lean * 0.4)} ${round(-h * 0.6)} ${round(lean)} ${round(-h)}" stroke="${color}" stroke-width="${round(rnd.range(0.5, 1.2))}" fill="none" opacity="${round(rnd.range(opacity * 0.5, opacity))}" stroke-linecap="round"/>`
    );
  }
  return parts.join('');
}

/** Папоротник: вайя с зубцами, свободная тушевая линия. */
function fern(rnd, x, baseY, h, color, opacity) {
  const parts = [];
  const stems = rnd.int(4, 7);
  for (let s = 0; s < stems; s++) {
    const angle = rnd.range(-1.1, 1.1) + (s / stems - 0.5) * 1.1;
    const len = h * rnd.range(0.7, 1);
    const tipX = x + Math.sin(angle) * len;
    const tipY = baseY - Math.cos(angle) * len;
    const cx = x + Math.sin(angle) * len * 0.55;
    const cy = baseY - Math.cos(angle) * len * 0.62;
    parts.push(
      `<path d="M${round(x)} ${round(baseY)}Q${round(cx)} ${round(cy - 6)} ${round(tipX)} ${round(tipY)}" stroke="${color}" stroke-width="${round(rnd.range(0.6, 1.1))}" fill="none" opacity="${opacity}"/>`
    );
    const leaflets = Math.max(4, Math.round(len / 6));
    for (let i = 1; i < leaflets; i++) {
      const t = i / leaflets;
      const px = x + Math.sin(angle) * len * t;
      const py = baseY - Math.cos(angle) * len * t;
      const leaf = len * 0.16 * (1 - t * 0.6);
      parts.push(
        `<path d="M${round(px)} ${round(py)}q${round(leaf * 0.9)} ${round(-leaf * 0.4)} ${round(leaf)} ${round(leaf * 0.5)}" stroke="${color}" stroke-width="0.8" fill="none" opacity="${round(opacity * 0.85)}"/>` +
          `<path d="M${round(px)} ${round(py)}q${round(-leaf * 0.9)} ${round(-leaf * 0.4)} ${round(-leaf)} ${round(leaf * 0.5)}" stroke="${color}" stroke-width="0.8" fill="none" opacity="${round(opacity * 0.85)}"/>`
      );
    }
  }
  return parts.join('');
}

/* ——— Материалы ——— */

function svg(w, h, seed, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" focusable="false">
<defs>${defs(seed)}</defs>
${body}
</svg>
`;
}

module.exports = {
  C,
  makeRandom,
  round,
  pointsToPath,
  smoothPath,
  ridge,
  terrainShape,
  defs,
  wash,
  ink,
  grain,
  strokes,
  haze,
  conifer,
  broadleaf,
  bambooGrass,
  fern,
  svg,
};

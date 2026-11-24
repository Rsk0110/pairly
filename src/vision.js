// Pairly — sock finding and pairing on raw pixels. Pure functions over
// ImageData-like objects ({ data: Uint8ClampedArray RGBA, width, height }),
// so the same code runs in the browser and in Node tests.

// ---------- colour ----------

const srgbToLinear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const LIN = Array.from({ length: 256 }, (_, i) => srgbToLinear(i));
const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

/** sRGB (0–255) → CIE Lab (D65). */
export const rgbToLab = (r, g, b) => {
  const R = LIN[r];
  const G = LIN[g];
  const B = LIN[b];
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};

const median = (arr) => {
  const s = Float64Array.from(arr).sort();
  return s.length ? s[s.length >> 1] : 0;
};

// ---------- segmentation ----------

/** Lab image as three Float32Arrays. */
export const toLab = (img) => {
  const n = img.width * img.height;
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [l, a, b] = rgbToLab(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]);
    L[i] = l;
    A[i] = a;
    B[i] = b;
  }
  return { L, A, B, width: img.width, height: img.height };
};

/** Background colour = median of a band around the image border. */
export const backgroundColour = (lab, band = 6) => {
  const { width: w, height: h } = lab;
  const ls = [];
  const as = [];
  const bs = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (x >= band && x < w - band && y >= band && y < h - band) continue;
      const i = y * w + x;
      ls.push(lab.L[i]);
      as.push(lab.A[i]);
      bs.push(lab.B[i]);
    }
  return [median(ls), median(as), median(bs)];
};

/**
 * Background model with lighting: fits value = c0 + c1·x + c2·y per Lab
 * channel to the border band (least squares), so a floor that is brighter on
 * one side doesn't look like a sock.
 */
export const backgroundPlane = (lab, band = 8) => {
  const { width: w, height: h } = lab;
  // normal equations for [1, x, y]
  const S = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const T = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const chans = [lab.L, lab.A, lab.B];
  for (let y = 0; y < h; y += 2)
    for (let x = 0; x < w; x += 2) {
      if (x >= band && x < w - band && y >= band && y < h - band) continue;
      const v = [1, x / w, y / h];
      const i = y * w + x;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) S[r][c] += v[r] * v[c];
        for (let k = 0; k < 3; k++) T[k][r] += v[r] * chans[k][i];
      }
    }
  const solve3 = (A, b) => {
    const M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < 3; c++) {
      let p = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < 3; r++) {
        if (r === c || !M[c][c]) continue;
        const fct = M[r][c] / M[c][c];
        for (let k = c; k < 4; k++) M[r][k] -= fct * M[c][k];
      }
    }
    return M.map((row, i) => row[3] / (row[i] || 1));
  };
  const coef = T.map((t) => solve3(S, t));
  return (x, y) => coef.map(([c0, c1, c2]) => c0 + (c1 * x) / w + (c2 * y) / h);
};

/** Otsu threshold on a non-negative Float32Array (histogram of 256 bins up to max). */
export const otsu = (values) => {
  let max = 0;
  for (const v of values) if (v > max) max = v;
  if (max === 0) return 0;
  const hist = new Float64Array(256);
  for (const v of values) hist[Math.min(255, Math.floor((v / max) * 255))]++;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 0;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      thr = i;
    }
  }
  return ((thr + 1) / 255) * max;
};

const erode = (m, w, h) => {
  const o = new Uint8Array(m.length);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      o[i] = m[i] && m[i - 1] && m[i + 1] && m[i - w] && m[i + w] ? 1 : 0;
    }
  return o;
};
const dilate = (m, w, h) => {
  const o = new Uint8Array(m.length);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      o[i] = m[i] || m[i - 1] || m[i + 1] || m[i - w] || m[i + w] ? 1 : 0;
    }
  return o;
};

/** Foreground mask: pixels whose colour differs from the background, cleaned with open/close. */
export const foregroundMask = (lab, { minDelta = 12 } = {}) => {
  const { width: w, height: h } = lab;
  const bg = backgroundColour(lab);
  const plane = backgroundPlane(lab);
  const d = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const [l, a, b] = plane(x, y);
      // lightness differences matter less than colour differences (shadows, folds)
      d[i] = Math.hypot((lab.L[i] - l) * 0.8, (lab.A[i] - a) * 1.3, (lab.B[i] - b) * 1.3);
    }
  // threshold from how much the floor itself varies along the border, not from the socks
  const border = [];
  const band = 8;
  for (let y = 0; y < h; y += 2)
    for (let x = 0; x < w; x += 2) if (x < band || x >= w - band || y < band || y >= h - band) border.push(d[y * w + x]);
  border.sort((p, q) => p - q);
  const p95 = border[Math.floor(border.length * 0.95)] ?? 0;
  const thr = Math.max(minDelta, p95 * 1.8);
  let m = new Uint8Array(w * h);
  for (let i = 0; i < d.length; i++) m[i] = d[i] > thr ? 1 : 0;
  m = dilate(erode(m, w, h), w, h); // open: drop specks
  m = erode(dilate(m, w, h), w, h); // close: fill small holes (e.g. stripes matching the floor)
  return { mask: m, background: bg, threshold: thr };
};

/** 4-connected components; returns blobs with pixel indices, bbox and area. */
export const components = (mask, w, h, minArea) => {
  const label = new Int32Array(mask.length).fill(-1);
  const blobs = [];
  const stack = new Int32Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || label[i] !== -1) continue;
    const id = blobs.length;
    let sp = 0;
    stack[sp++] = i;
    label[i] = id;
    const px = [];
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    while (sp) {
      const p = stack[--sp];
      px.push(p);
      const x = p % w;
      const y = (p / w) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb)
        if (q >= 0 && mask[q] && label[q] === -1) {
          label[q] = id;
          stack[sp++] = q;
        }
    }
    blobs.push({ id, px, bbox: { x0, y0, x1, y1 }, area: px.length });
  }
  return blobs.filter((b) => b.area >= minArea);
};

// ---------- features ----------

const HUE_BINS = 12;
const LIGHT_BINS = 4;

/**
 * Describe a sock: a colour histogram that's robust to lighting
 * (hue × lightness bins, with greys in their own bins), a texture score
 * (how much colour changes between neighbouring pixels — stripes and dots
 * score high), and its size and elongation.
 */
export const describe = (blob, lab) => {
  const { width: w } = lab;
  const hist = new Float64Array(HUE_BINS * LIGHT_BINS + LIGHT_BINS);
  let edge = 0;
  let edgeN = 0;
  let sx = 0;
  let sy = 0;
  const inBlob = new Set(blob.px);
  for (const p of blob.px) {
    const L = lab.L[p];
    const a = lab.A[p];
    const b = lab.B[p];
    const chroma = Math.hypot(a, b);
    const li = Math.min(LIGHT_BINS - 1, Math.floor((L / 100) * LIGHT_BINS));
    if (chroma < 10) hist[HUE_BINS * LIGHT_BINS + li] += 1; // grey/black/white
    else {
      const hue = (Math.atan2(b, a) + Math.PI) / (2 * Math.PI);
      const hi = Math.min(HUE_BINS - 1, Math.floor(hue * HUE_BINS));
      hist[hi * LIGHT_BINS + li] += 1;
    }
    const q = p + 1;
    if (inBlob.has(q)) {
      edge += Math.hypot(L - lab.L[q], a - lab.A[q], b - lab.B[q]);
      edgeN++;
    }
    sx += p % w;
    sy += (p / w) | 0;
  }
  const n = blob.px.length;
  for (let i = 0; i < hist.length; i++) hist[i] /= n;
  // second moments → elongation (socks are long; touching pairs look fat)
  const cx = sx / n;
  const cy = sy / n;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const p of blob.px) {
    const dx = (p % w) - cx;
    const dy = ((p / w) | 0) - cy;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  }
  xx /= n;
  yy /= n;
  xy /= n;
  const tr = xx + yy;
  const det = xx * yy - xy * xy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const major = Math.sqrt(tr / 2 + disc);
  const minor = Math.sqrt(Math.max(1e-6, tr / 2 - disc));
  return { hist: Array.from(hist), texture: edgeN ? edge / edgeN : 0, area: n, elongation: major / minor, centre: { x: cx, y: cy } };
};

/** Distance between two sock descriptions (0 = identical). */
export const sockDistance = (a, b) => {
  // chi-square histogram distance
  let chi = 0;
  for (let i = 0; i < a.hist.length; i++) {
    const s = a.hist[i] + b.hist[i];
    if (s > 0) chi += (a.hist[i] - b.hist[i]) ** 2 / s;
  }
  chi /= 2; // 0..1
  const tex = Math.abs(a.texture - b.texture) / (Math.max(a.texture, b.texture) + 2);
  const size = Math.abs(Math.log(a.area / b.area)); // 0 when equal
  return chi * 1.0 + tex * 0.35 + size * 0.45;
};

// ---------- pairing ----------

/**
 * Pair socks to minimise total distance. Exact for up to 16 socks (bitmask
 * DP over subsets), greedy + 2-swap improvement above that. Pairs worse than
 * `maxDistance` are left unpaired ("odd socks").
 */
export const pairSocks = (descs, { maxDistance = 0.55 } = {}) => {
  const n = descs.length;
  const D = descs.map((a) => descs.map((b) => sockDistance(a, b)));
  const cost = (i, j) => (D[i][j] > maxDistance ? Infinity : D[i][j]);
  const UNPAIRED = maxDistance * 1.05; // leaving a sock alone is cheaper than a bad pair

  let pairs = [];
  if (n <= 16) {
    const memo = new Map();
    const solve = (mask) => {
      if (mask === (1 << n) - 1) return { c: 0, p: [] };
      if (memo.has(mask)) return memo.get(mask);
      let i = 0;
      while (mask & (1 << i)) i++;
      // option 1: sock i stays odd
      const rest = solve(mask | (1 << i));
      let best = { c: rest.c + UNPAIRED, p: rest.p };
      for (let j = i + 1; j < n; j++) {
        if (mask & (1 << j)) continue;
        const c = cost(i, j);
        if (c === Infinity) continue;
        const r = solve(mask | (1 << i) | (1 << j));
        if (r.c + c < best.c) best = { c: r.c + c, p: [[i, j], ...r.p] };
      }
      memo.set(mask, best);
      return best;
    };
    pairs = solve(0).p;
  } else {
    const used = new Set();
    const edges = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (cost(i, j) < Infinity) edges.push([D[i][j], i, j]);
    edges.sort((a, b) => a[0] - b[0]);
    for (const [, i, j] of edges) {
      if (used.has(i) || used.has(j)) continue;
      used.add(i);
      used.add(j);
      pairs.push([i, j]);
    }
    // 2-swap improvement
    for (let changed = true; changed; ) {
      changed = false;
      for (let a = 0; a < pairs.length; a++)
        for (let b = a + 1; b < pairs.length; b++) {
          const [p, q] = pairs[a];
          const [r, s] = pairs[b];
          const now = D[p][q] + D[r][s];
          if (D[p][r] + D[q][s] < now - 1e-9 && cost(p, r) < Infinity && cost(q, s) < Infinity) {
            pairs[a] = [p, r];
            pairs[b] = [q, s];
            changed = true;
          } else if (D[p][s] + D[q][r] < now - 1e-9 && cost(p, s) < Infinity && cost(q, r) < Infinity) {
            pairs[a] = [p, s];
            pairs[b] = [q, r];
            changed = true;
          }
        }
    }
  }
  const paired = new Set(pairs.flat());
  const odd = descs.map((_, i) => i).filter((i) => !paired.has(i));
  return { pairs: pairs.map(([i, j]) => ({ a: i, b: j, distance: D[i][j], confidence: Math.max(0, 1 - D[i][j] / maxDistance) })), odd, distances: D };
};

/** Full pipeline on an image: find socks, describe them, pair them. */
export const analysePile = (img, opts = {}) => {
  const lab = toLab(img);
  const { mask } = foregroundMask(lab, opts);
  const minArea = Math.max(80, Math.round(img.width * img.height * 0.004));
  const blobs = components(mask, img.width, img.height, minArea);
  const descs = blobs.map((b) => describe(b, lab));
  // blobs that are far larger than the typical sock are probably several touching socks
  const areas = descs.map((d) => d.area).sort((a, b) => a - b);
  const typical = areas[areas.length >> 1] || 1;
  const merged = descs.map((d) => d.area > typical * 2.3 && d.elongation < 2);
  const result = pairSocks(descs, opts);
  return { socks: blobs.map((b, i) => ({ bbox: b.bbox, px: b.px, desc: descs[i], touching: merged[i] })), ...result };
};

/** Compare new socks against saved lonely socks; returns best matches under the threshold. */
export const matchLonely = (newDescs, lonely, { maxDistance = 0.45 } = {}) => {
  const out = [];
  newDescs.forEach((d, i) => {
    let best = null;
    lonely.forEach((l, j) => {
      const dist = sockDistance(d, l.desc);
      if (dist <= maxDistance && (!best || dist < best.distance)) best = { sock: i, lonely: j, distance: dist };
    });
    if (best) out.push(best);
  });
  return out;
};

import { analysePile, matchLonely, sockDistance } from './vision.js';
import { samplePile } from './sample.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// ---------- navigation ----------
const show = (name) => {
  for (const v of ['pair', 'drawer']) $(`#view-${v}`).hidden = v !== name;
  for (const t of $$('.tab')) {
    const on = t.dataset.view === name;
    t.classList.toggle('is-on', on);
    if (on) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  }
  if (name === 'drawer') renderDrawer();
};
for (const t of $$('.tab')) t.addEventListener('click', () => show(t.dataset.view));

// ---------- lonely sock drawer (on-device) ----------
const KEY = 'pairly:drawer';
const loadDrawer = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
};
const saveDrawer = (d) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* storage full or blocked */
  }
  updateBadge();
};
const updateBadge = () => {
  const n = loadDrawer().length;
  $('#drawer-count').textContent = n;
  $('#drawer-count').hidden = n === 0;
};
updateBadge();

// ---------- state ----------
const PALETTE = ['#ff5c8a', '#2f80ed', '#27ae60', '#f2994a', '#9b51e0', '#00b8a9', '#eb5757', '#f2c94c', '#56ccf2', '#6fcf97', '#bb6bd9', '#219653'];
const photo = $('#photo');
const overlay = $('#overlay');
let res = null; // analysis result
let pairOf = []; // sock index -> pair number (0-based) or -1
let labels = null; // Int16Array pixel -> sock index
let selected = -1;
let drawerHits = []; // {sock, lonely}

const buildLabels = () => {
  labels = new Int16Array(photo.width * photo.height).fill(-1);
  res.socks.forEach((s, i) => {
    for (const p of s.px) labels[p] = i;
  });
};

const recomputePairs = (pairs) => {
  pairOf = res.socks.map(() => -1);
  pairs.forEach(([a, b], k) => {
    pairOf[a] = k;
    pairOf[b] = k;
  });
};
const currentPairs = () => {
  const by = new Map();
  pairOf.forEach((k, i) => {
    if (k < 0) return;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(i);
  });
  return [...by.values()].filter((p) => p.length === 2);
};

// ---------- drawing ----------
const draw = () => {
  const w = photo.width;
  const h = photo.height;
  overlay.width = w;
  overlay.height = h;
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const pairs = currentPairs();
  const numberOf = new Map();
  pairs.forEach((p, k) => p.forEach((i) => numberOf.set(i, k)));
  const img = ctx.createImageData(w, h);
  // outlines: blob pixels with a neighbour outside the blob, thickened
  res.socks.forEach((s, i) => {
    const k = numberOf.get(i);
    const hex = k === undefined ? '#e02424' : PALETTE[k % PALETTE.length];
    const rgb = [1, 3, 5].map((o) => parseInt(hex.slice(o, o + 2), 16));
    for (const p of s.px) {
      const x = p % w;
      const y = (p / w) | 0;
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 || labels[p - 1] !== i || labels[p + 1] !== i || labels[p - w] !== i || labels[p + w] !== i;
      if (!edge) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const q = (y + dy) * w + (x + dx);
          if (q < 0 || q >= labels.length) continue;
          img.data[q * 4] = rgb[0];
          img.data[q * 4 + 1] = rgb[1];
          img.data[q * 4 + 2] = rgb[2];
          img.data[q * 4 + 3] = 255;
        }
    }
  });
  ctx.putImageData(img, 0, 0);
  // badges
  const r = Math.max(16, Math.round(Math.min(w, h) / 22));
  res.socks.forEach((s, i) => {
    const k = numberOf.get(i);
    const { x, y } = s.desc.centre;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = k === undefined ? '#ffffff' : PALETTE[k % PALETTE.length];
    ctx.fill();
    ctx.lineWidth = Math.max(2, r / 6);
    ctx.strokeStyle = i === selected ? '#111' : k === undefined ? '#e02424' : '#fff';
    if (k === undefined) ctx.setLineDash([r / 3, r / 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = k === undefined ? '#e02424' : '#fff';
    ctx.font = `800 ${Math.round(r * 1.15)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const hit = drawerHits.find((d) => d.sock === i);
    ctx.fillText(hit ? '★' : k === undefined ? '?' : String(k + 1), x, y + 1);
    if (i === selected) {
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#111';
      ctx.beginPath();
      ctx.arc(x, y, r + 7, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
};

const thumb = (s, size = 120) => {
  const { x0, y0, x1, y1 } = s.bbox;
  const c = document.createElement('canvas');
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const k = size / Math.max(bw, bh);
  c.width = Math.round(bw * k);
  c.height = Math.round(bh * k);
  c.getContext('2d').drawImage(photo, x0, y0, bw, bh, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
};

const renderSummary = () => {
  const pairs = currentPairs();
  const odd = res.socks.length - pairs.length * 2;
  const touching = res.socks.filter((s) => s.touching).length;
  const box = $('#summary');
  box.replaceChildren();
  const h = document.createElement('h2');
  h.textContent = res.socks.length ? `${pairs.length} pair${pairs.length === 1 ? '' : 's'} found${odd ? ` · ${odd} odd sock${odd === 1 ? '' : 's'}` : ''}` : 'No socks found';
  box.append(h);
  const p = document.createElement('p');
  p.className = 'small';
  const bits = [];
  if (!res.socks.length) bits.push('Try a plainer background and make sure the socks are spread out.');
  if (touching) bits.push(`${touching} shape${touching === 1 ? ' looks' : 's look'} like socks touching each other: spread them apart and try again.`);
  if (drawerHits.length) bits.push(`★ ${drawerHits.length} sock${drawerHits.length === 1 ? '' : 's'} match${drawerHits.length === 1 ? 'es' : ''} a lonely sock in your drawer!`);
  if (!bits.length) bits.push(odd ? 'Odd socks have a red “?”. Save them to the drawer and Pairly will look for their partners next time.' : 'Everything is paired up.');
  p.textContent = bits.join(' ');
  box.append(p);
  $('#save-odd').hidden = odd === 0;

  const ul = $('#pairs');
  ul.replaceChildren(
    ...pairs.map(([a, b], k) => {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'num';
      dot.textContent = String(k + 1);
      dot.style.background = PALETTE[k % PALETTE.length];
      const ia = new Image();
      ia.src = thumb(res.socks[a], 80);
      ia.alt = `sock ${a + 1}`;
      const ib = new Image();
      ib.src = thumb(res.socks[b], 80);
      ib.alt = `sock ${b + 1}`;
      const conf = document.createElement('span');
      conf.className = 'small';
      const d = sockDistance(res.socks[a].desc, res.socks[b].desc);
      conf.textContent = d < 0.18 ? 'sure' : d < 0.35 ? 'likely' : 'check this one';
      li.append(dot, ia, ib, conf);
      return li;
    })
  );
};

// ---------- analysis ----------
const MAX_SIDE = 900;
const loadImageToCanvas = (img) => {
  const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  photo.width = Math.round(img.width * k);
  photo.height = Math.round(img.height * k);
  photo.getContext('2d').drawImage(img, 0, 0, photo.width, photo.height);
};

const run = async () => {
  $('#start').hidden = true;
  $('#result').hidden = false;
  $('#summary').replaceChildren(Object.assign(document.createElement('h2'), { textContent: 'Matching socks…' }));
  await new Promise((r) => setTimeout(r, 30)); // let the message paint
  const t0 = performance.now();
  const data = photo.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, photo.width, photo.height);
  res = analysePile(data);
  res.ms = Math.round(performance.now() - t0);
  buildLabels();
  recomputePairs(res.pairs.map((p) => [p.a, p.b]));
  const drawer = loadDrawer();
  drawerHits = matchLonely(
    res.socks.map((s) => s.desc),
    drawer
  ).filter((h) => pairOf[h.sock] === -1);
  selected = -1;
  draw();
  renderSummary();
  overlay.dataset.ms = res.ms;
};

const fromFile = (file) => {
  if (!file) return;
  const url = URL.createObjectURL(file); // stays on this device
  const img = new Image();
  img.onload = () => {
    loadImageToCanvas(img);
    URL.revokeObjectURL(url);
    run();
  };
  img.src = url;
};
$('#camera').addEventListener('change', (e) => fromFile(e.target.files?.[0]));
$('#file').addEventListener('change', (e) => fromFile(e.target.files?.[0]));
$('#sample').addEventListener('click', () => {
  const pile = samplePile({ seed: 1 + Math.floor(Math.random() * 1000) });
  photo.width = pile.width;
  photo.height = pile.height;
  photo.getContext('2d').putImageData(new ImageData(pile.data, pile.width, pile.height), 0, 0);
  run();
});
$('#again').addEventListener('click', () => {
  $('#result').hidden = true;
  $('#start').hidden = false;
  $('#camera').value = '';
  $('#file').value = '';
});

// ---------- manual fixes: tap two socks to pair, tap a paired sock to split ----------
overlay.addEventListener('click', (e) => {
  if (!res) return;
  const r = overlay.getBoundingClientRect();
  const x = Math.round(((e.clientX - r.left) / r.width) * overlay.width);
  const y = Math.round(((e.clientY - r.top) / r.height) * overlay.height);
  // badges first: an L-shaped sock's centre (where its badge is drawn) can lie outside the sock itself
  let hit = -1;
  const badgeR = Math.max(16, Math.round(Math.min(overlay.width, overlay.height) / 22)) * 1.5;
  let bestD = badgeR;
  res.socks.forEach((s, i) => {
    const d = Math.hypot(s.desc.centre.x - x, s.desc.centre.y - y);
    if (d < bestD) {
      bestD = d;
      hit = i;
    }
  });
  // otherwise the sock under the finger, searching a small radius (fingers are fat)
  for (let rad = 0; rad <= 14 && hit < 0; rad += 2)
    for (let dy = -rad; dy <= rad && hit < 0; dy += 2)
      for (let dx = -rad; dx <= rad && hit < 0; dx += 2) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < overlay.width && yy < overlay.height) hit = labels[yy * overlay.width + xx];
      }
  if (hit < 0) {
    selected = -1;
    draw();
    return;
  }
  if (selected < 0) {
    if (pairOf[hit] >= 0) {
      // split this pair
      const k = pairOf[hit];
      pairOf = pairOf.map((v) => (v === k ? -1 : v));
    } else selected = hit;
  } else if (selected === hit) selected = -1;
  else {
    // pair selected with hit (breaking any existing pair of hit)
    if (pairOf[hit] >= 0) {
      const k = pairOf[hit];
      pairOf = pairOf.map((v) => (v === k ? -1 : v));
    }
    const k = Math.max(-1, ...pairOf) + 1;
    pairOf[selected] = k;
    pairOf[hit] = k;
    selected = -1;
  }
  // renumber pairs 0..n-1 in order
  const order = [...new Set(pairOf.filter((v) => v >= 0))];
  pairOf = pairOf.map((v) => (v >= 0 ? order.indexOf(v) : -1));
  draw();
  renderSummary();
});

// ---------- drawer ----------
$('#save-odd').addEventListener('click', () => {
  const drawer = loadDrawer();
  const pairedNow = new Set(currentPairs().flat());
  let added = 0;
  res.socks.forEach((s, i) => {
    if (pairedNow.has(i) || drawerHits.some((h) => h.sock === i)) return;
    drawer.push({ id: `${Date.now()}-${i}`, date: new Date().toISOString().slice(0, 10), img: thumb(s), desc: { hist: s.desc.hist, texture: s.desc.texture, area: s.desc.area, elongation: s.desc.elongation } });
    added++;
  });
  saveDrawer(drawer);
  const btn = $('#save-odd');
  btn.textContent = added ? `Saved ${added} to the drawer ✓` : 'Nothing new to save';
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = 'Save odd socks to drawer';
    btn.disabled = false;
  }, 2200);
});

const renderDrawer = () => {
  const drawer = loadDrawer();
  const ul = $('#drawer');
  ul.replaceChildren(
    ...drawer.map((s, i) => {
      const li = document.createElement('li');
      const img = new Image();
      img.src = s.img;
      img.alt = 'lonely sock';
      const meta = document.createElement('span');
      meta.className = 'small';
      meta.textContent = `waiting since ${s.date}`;
      const rm = document.createElement('button');
      rm.className = 'btn ghost small-btn';
      rm.textContent = 'Found it';
      rm.addEventListener('click', () => {
        const d = loadDrawer();
        d.splice(i, 1);
        saveDrawer(d);
        renderDrawer();
      });
      li.append(img, meta, rm);
      return li;
    })
  );
  $('#drawer-empty').hidden = drawer.length > 0;
  $('#drawer-clear').hidden = drawer.length === 0;
};
$('#drawer-clear').addEventListener('click', () => {
  saveDrawer([]);
  renderDrawer();
});

// read-only hook for automated UI tests
Object.defineProperty(window, '__pairly', { value: { socks: () => res?.socks.map((s) => s.desc.centre), pairs: () => currentPairs() } });

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

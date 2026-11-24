import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analysePile, components, matchLonely, otsu, pairSocks, rgbToLab, sockDistance } from '../src/vision.js';
import { DESIGNS, samplePile } from '../src/sample.js';

test('rgbToLab reference values', () => {
  const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.6);
  assert.ok(close(rgbToLab(255, 255, 255), [100, 0, 0]));
  assert.ok(close(rgbToLab(0, 0, 0), [0, 0, 0]));
  assert.ok(close(rgbToLab(255, 0, 0), [53.24, 80.09, 67.2]));
});

test('otsu splits a bimodal distribution', () => {
  const v = Float32Array.from([...Array(500).fill(2), ...Array(500).fill(40)]);
  const t = otsu(v);
  assert.ok(t > 2 && t < 40, String(t));
});

test('components finds separate blobs and drops specks', () => {
  const w = 20;
  const h = 10;
  const m = new Uint8Array(w * h);
  for (let y = 1; y < 5; y++) for (let x = 1; x < 6; x++) m[y * w + x] = 1; // 20 px
  for (let y = 2; y < 8; y++) for (let x = 10; x < 15; x++) m[y * w + x] = 1; // 30 px
  m[9 * w + 19] = 1; // speck
  const b = components(m, w, h, 5);
  assert.deepEqual(b.map((x) => x.area).sort((a, c) => a - c), [20, 30]);
});

const truthFor = (img, res) =>
  res.socks.map((s) => {
    // nearest generated sock to each detected blob centre
    let best = null;
    for (const t of img.truth) {
      const d = Math.hypot(t.cx - s.desc.centre.x, t.cy - s.desc.centre.y);
      if (!best || d < best.d) best = { d, design: t.design };
    }
    return best.design;
  });

for (const seed of [7, 11, 23, 42, 99]) {
  test(`sample pile ${seed}: finds every sock, pairs them correctly, leaves the odd one`, () => {
    const img = samplePile({ seed });
    const res = analysePile(img);
    const expected = DESIGNS.reduce((n, d) => n + (d.odd ? 1 : 2), 0);
    assert.equal(res.socks.length, expected, `found ${res.socks.length} socks`);
    const design = truthFor(img, res);
    for (const p of res.pairs) assert.equal(design[p.a], design[p.b], `paired ${DESIGNS[design[p.a]].name} with ${DESIGNS[design[p.b]].name}`);
    assert.equal(res.pairs.length, DESIGNS.filter((d) => !d.odd).length);
    assert.equal(res.odd.length, 1);
    assert.ok(DESIGNS[design[res.odd[0]]].odd, 'the odd sock is the unpaired design');
  });
}

test('navy and charcoal (similar dark socks) are not confused', () => {
  const img = samplePile({ seed: 5 });
  const res = analysePile(img);
  const design = truthFor(img, res);
  const navy = DESIGNS.findIndex((d) => d.name === 'Navy');
  const charcoal = DESIGNS.findIndex((d) => d.name === 'Charcoal');
  for (const p of res.pairs) assert.ok(!([navy, charcoal].includes(design[p.a]) && design[p.a] !== design[p.b]));
});

test('pairSocks leaves a sock alone rather than forcing a bad pair', () => {
  const mk = (bin, area = 1000) => {
    const hist = Array(52).fill(0);
    hist[bin] = 1;
    return { hist, texture: 5, area, elongation: 3 };
  };
  const r = pairSocks([mk(3), mk(3), mk(20)]);
  assert.equal(r.pairs.length, 1);
  assert.deepEqual(r.odd, [2]);
  // size matters: a child's sock and an adult's sock of the same colour aren't a pair
  assert.ok(sockDistance(mk(3, 400), mk(3, 1200)) > sockDistance(mk(3, 1000), mk(3, 1050)));
});

test('greedy path (more than 16 socks) still pairs correctly', () => {
  const mk = (bin) => {
    const hist = Array(52).fill(0);
    hist[bin] = 1;
    return { hist, texture: 5, area: 1000, elongation: 3 };
  };
  const socks = [];
  for (let k = 0; k < 10; k++) socks.push(mk(k * 4), mk(k * 4));
  const r = pairSocks(socks);
  assert.equal(r.pairs.length, 10);
  for (const p of r.pairs) assert.equal(socks[p.a].hist.indexOf(1), socks[p.b].hist.indexOf(1));
});

test('lonely sock drawer finds a match in a later load', () => {
  const first = analysePile(samplePile({ seed: 7 }));
  const lonely = first.odd.map((i) => ({ desc: first.socks[i].desc }));
  // next load contains the odd sock's partner (same design, different position/lighting)
  const second = analysePile(samplePile({ seed: 31 }));
  const hits = matchLonely(second.socks.map((s) => s.desc), lonely);
  assert.ok(hits.length >= 1, 'found the partner of the lonely sock');
});

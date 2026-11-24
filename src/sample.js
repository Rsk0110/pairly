// Generates a realistic-looking "laundry pile" photo as raw RGBA pixels:
// socks with different colours and patterns, laid on a textured floor with
// uneven lighting and sensor noise. Used for the demo and for tests.

const rng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Sock designs: base colour, pattern and accent. Each appears twice unless `odd`. */
export const DESIGNS = [
  { name: 'Navy', base: [32, 44, 92], pattern: 'solid' },
  { name: 'Grey with red stripes', base: [150, 150, 150], accent: [196, 40, 44], pattern: 'stripes' },
  { name: 'White, black heel & toe', base: [236, 236, 232], accent: [28, 28, 30], pattern: 'heeltoe' },
  { name: 'Teal with yellow dots', base: [20, 128, 128], accent: [248, 208, 40], pattern: 'dots' },
  { name: 'Charcoal', base: [58, 58, 62], pattern: 'solid' },
  { name: 'Orange & purple stripes', base: [240, 128, 30], accent: [110, 50, 150], pattern: 'stripes', odd: true },
];

const capsuleDist = (px, py, ax, ay, bx, by) => {
  const vx = bx - ax;
  const vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  return [Math.hypot(px - (ax + t * vx), py - (ay + t * vy)), t];
};

/**
 * @returns {{data: Uint8ClampedArray, width: number, height: number, truth: {design: number, cx: number, cy: number}[]}}
 */
export const samplePile = ({ width = 900, height = 680, seed = 7, designs = DESIGNS } = {}) => {
  const r = rng(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  // pale wooden floor with grain, lighting gradient and noise
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const grain = Math.sin(y * 0.09 + Math.sin(x * 0.01) * 3) * 6;
      const light = 1 - 0.12 * ((x / width) * 0.7 + (y / height) * 0.3);
      data[i] = (214 + grain) * light;
      data[i + 1] = (190 + grain) * light;
      data[i + 2] = (156 + grain * 0.6) * light;
      data[i + 3] = 255;
    }

  const socks = [];
  designs.forEach((d, di) => {
    socks.push(di);
    if (!d.odd) socks.push(di);
  });
  // shuffle placement
  for (let i = socks.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [socks[i], socks[j]] = [socks[j], socks[i]];
  }
  const cols = 4;
  const rows = Math.ceil(socks.length / cols);
  const cw = width / cols;
  const ch = height / rows;
  const truth = [];
  const scale = Math.min(cw, ch) / 150;

  socks.forEach((di, k) => {
    const d = designs[di];
    const cx = (k % cols) * cw + cw / 2 + (r() - 0.5) * cw * 0.15;
    const cy = Math.floor(k / cols) * ch + ch / 2 + (r() - 0.5) * ch * 0.15;
    const ang = r() * Math.PI * 2;
    const flip = r() < 0.5 ? -1 : 1;
    const legLen = 62 * scale;
    const footLen = 40 * scale;
    const rad = 15 * scale;
    // local frame: leg from (0,-legLen/2) to (0,legLen/2), foot bends 100° at the bottom
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const toWorld = (lx, ly) => [cx + lx * cos - ly * sin, cy + lx * sin + ly * cos];
    const fa = (100 * Math.PI) / 180;
    const legA = [0, -legLen / 2];
    const legB = [0, legLen / 2];
    const footB = [flip * Math.sin(fa) * footLen, legLen / 2 - Math.cos(fa) * footLen];
    const ext = legLen + footLen + rad * 2;
    const tint = 0.92 + r() * 0.12; // slight lighting difference per sock
    for (let y = Math.max(0, Math.floor(cy - ext)); y < Math.min(height, cy + ext); y++)
      for (let x = Math.max(0, Math.floor(cx - ext)); x < Math.min(width, cx + ext); x++) {
        // back to local coords
        const dx = x - cx;
        const dy = y - cy;
        const lx = dx * cos + dy * sin;
        const ly = -dx * sin + dy * cos;
        const [dl, tl] = capsuleDist(lx, ly, ...legA, ...legB);
        const [df, tf] = capsuleDist(lx, ly, ...legB, ...footB);
        if (dl > rad && df > rad * 0.95) continue;
        let col = d.base;
        const onLeg = dl <= rad;
        if (d.pattern === 'stripes' && onLeg && Math.floor(tl * 9) % 2 === 1) col = d.accent;
        if (d.pattern === 'heeltoe' && !onLeg && (tf > 0.72 || tf < 0.2)) col = d.accent;
        if (d.pattern === 'dots') {
          const gx = ((lx / (9 * scale)) % 1 + 1) % 1;
          const gy = ((ly / (9 * scale)) % 1 + 1) % 1;
          if (Math.hypot(gx - 0.5, gy - 0.5) < 0.22) col = d.accent;
        }
        if (onLeg && tl < 0.08) col = col.map((c) => c * 0.85); // ribbed cuff, a bit darker
        // shading toward the edges + noise
        const edge = Math.min(dl, df) / rad;
        const shade = tint * (1 - 0.18 * edge * edge);
        const i = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) data[i + c] = col[c] * shade + (r() - 0.5) * 10;
      }
    const [tx, ty] = toWorld(0, 0);
    truth.push({ design: di, cx: tx, cy: ty });
  });
  return { data, width, height, truth };
};

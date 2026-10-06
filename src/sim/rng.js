// Small seeded PRNG (mulberry32) so runs and tests are reproducible.
export function createRng(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (min, max) => min + (max - min) * next();
  next.normal = () => {
    const u = 1 - next();
    const v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  next.pick = (weighted) => {
    let total = 0;
    for (const [, w] of weighted) total += w;
    let r = next() * total;
    for (const [item, w] of weighted) {
      r -= w;
      if (r <= 0) return item;
    }
    return weighted[weighted.length - 1][0];
  };
  return next;
}

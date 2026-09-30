/** Small seeded PRNG (mulberry32), so the scene looks the same on every load. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample (Box-Muller) clamped to ±limit. */
export function gaussian(random, limit = 2.5) {
  const u = Math.max(random(), 1e-6);
  const v = random();
  const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.min(Math.max(n, -limit), limit);
}

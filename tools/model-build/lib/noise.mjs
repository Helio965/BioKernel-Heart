/**
 * Deterministic 3D noise for the model pipeline (fat patches and lobules).
 * Same result on every build: the hashes are integer-based, no Math.random.
 */

function hash3(x, y, z, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 144665) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** Smooth value noise in [0, 1]. */
export function valueNoise3([px, py, pz], seed = 0) {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const iz = Math.floor(pz);
  const fx = fade(px - ix);
  const fy = fade(py - iy);
  const fz = fade(pz - iz);
  const lerp = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz, seed);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), fx), lerp(c(0, 1, 0), c(1, 1, 0), fx), fy),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), fx), lerp(c(0, 1, 1), c(1, 1, 1), fx), fy),
    fz,
  );
}

/**
 * Rounded lobules (cellular noise): 1 at the centre of a lobule, falling to 0
 * where lobules meet. `cell` is the lobule size in the units of p.
 */
export function lobules([px, py, pz], cell, seed = 0) {
  const x = px / cell;
  const y = py / cell;
  const z = pz / cell;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  let f1 = Infinity;
  let f2 = Infinity;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cx = ix + dx;
        const cy = iy + dy;
        const cz = iz + dz;
        const fx = cx + hash3(cx, cy, cz, seed + 1);
        const fy = cy + hash3(cx, cy, cz, seed + 2);
        const fz = cz + hash3(cx, cy, cz, seed + 3);
        const d = Math.hypot(fx - x, fy - y, fz - z);
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
  }
  // Distance to the border between the two nearest lobules, normalised.
  const edge = Math.min(1, (f2 - f1) * 1.6);
  return Math.sqrt(edge);
}

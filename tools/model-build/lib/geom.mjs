/** Vector helpers, PCA, spatial hashing and vessel centre-line tracing. */

export const v3 = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  norm: (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  at: (positions, i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]],
};

export function centroid(positions, subset = null) {
  let x = 0;
  let y = 0;
  let z = 0;
  const count = subset ? subset.length : positions.length / 3;
  for (let k = 0; k < count; k++) {
    const i = subset ? subset[k] : k;
    x += positions[i * 3];
    y += positions[i * 3 + 1];
    z += positions[i * 3 + 2];
  }
  return [x / count, y / count, z / count];
}

/** Symmetric 3×3 eigen-decomposition (Jacobi). Returns values desc + vectors. */
export function eigenSymmetric3(m) {
  const a = m.map((row) => row.slice());
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] * a[p][q];
    if (off < 1e-18) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-20) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const pairs = [0, 1, 2].map((i) => ({ value: a[i][i], vector: [v[0][i], v[1][i], v[2][i]] }));
  pairs.sort((x, y) => y.value - x.value);
  return { values: pairs.map((p) => p.value), vectors: pairs.map((p) => p.vector) };
}

/** Principal axes of a point set. */
export function pca(positions, subset = null) {
  const mean = centroid(positions, subset);
  const cov = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const count = subset ? subset.length : positions.length / 3;
  for (let k = 0; k < count; k++) {
    const i = subset ? subset[k] : k;
    const d = [positions[i * 3] - mean[0], positions[i * 3 + 1] - mean[1], positions[i * 3 + 2] - mean[2]];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cov[r][c] += d[r] * d[c];
  }
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cov[r][c] /= count;
  const { values, vectors } = eigenSymmetric3(cov);
  return { mean, axes: vectors, values };
}

/** Uniform hash grid for radius / nearest queries on a point set. */
export class PointGrid {
  constructor(positions, cellSize, subset = null) {
    this.positions = positions;
    this.cell = cellSize;
    this.map = new Map();
    const count = subset ? subset.length : positions.length / 3;
    for (let k = 0; k < count; k++) {
      const i = subset ? subset[k] : k;
      const key = this.key(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      let bucket = this.map.get(key);
      if (!bucket) this.map.set(key, (bucket = []));
      bucket.push(i);
    }
  }
  key(x, y, z) {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
  }
  radius(p, r, out = []) {
    const P = this.positions;
    const c = this.cell;
    const r2 = r * r;
    const x0 = Math.floor((p[0] - r) / c);
    const x1 = Math.floor((p[0] + r) / c);
    const y0 = Math.floor((p[1] - r) / c);
    const y1 = Math.floor((p[1] + r) / c);
    const z0 = Math.floor((p[2] - r) / c);
    const z1 = Math.floor((p[2] + r) / c);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          const bucket = this.map.get(`${x},${y},${z}`);
          if (!bucket) continue;
          for (const i of bucket) {
            const dx = P[i * 3] - p[0];
            const dy = P[i * 3 + 1] - p[1];
            const dz = P[i * 3 + 2] - p[2];
            if (dx * dx + dy * dy + dz * dz <= r2) out.push(i);
          }
        }
      }
    }
    return out;
  }
  nearest(p, maxRadius = Infinity) {
    let r = this.cell;
    const P = this.positions;
    for (;;) {
      const found = this.radius(p, r);
      if (found.length) {
        let best = -1;
        let bestD = Infinity;
        for (const i of found) {
          const d = Math.hypot(P[i * 3] - p[0], P[i * 3 + 1] - p[1], P[i * 3 + 2] - p[2]);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        return { index: best, distance: bestD };
      }
      r *= 2;
      if (r > maxRadius * 2 || r > 1e4) return { index: -1, distance: Infinity };
    }
  }
}

/**
 * Traces the centre line of a tubular mesh by marching cross-sections:
 * every step moves forward along the current direction and re-centres on the
 * vertices of the local slab (the tube wall), which follows curves well.
 * Returns [{ p: [x,y,z], r: radius }] from `startPoint`'s end to the other end.
 */
export function traceCenterline(positions, { start = null, step = null } = {}) {
  const count = positions.length / 3;
  const axes = pca(positions);
  const main = axes.axes[0];

  // Start at the vertex with the smallest projection on the main axis
  // (or the one nearest to the requested start point).
  let first = 0;
  let best = Infinity;
  for (let i = 0; i < count; i++) {
    const p = v3.at(positions, i);
    const score = start ? v3.dist(p, start) : v3.dot(p, main);
    if (score < best) {
      best = score;
      first = i;
    }
  }
  // Orientation: point into the tube.
  let direction = v3.norm(v3.sub(axes.mean, v3.at(positions, first)));
  if (!start && v3.dot(direction, main) < 0) direction = v3.scale(direction, -1);

  const extent = Math.sqrt(Math.max(axes.values[0], 1e-9)) * 3.5;
  const grid = new PointGrid(positions, Math.max(extent / 30, 0.25));

  // Initial section around the starting vertex.
  let radius = estimateRadius(positions, grid, v3.at(positions, first), direction, extent / 6);
  let center = sectionCenter(positions, grid, v3.add(v3.at(positions, first), v3.scale(direction, radius * 0.8)), direction, radius * 2.2) ??
    v3.at(positions, first);
  const points = [{ p: center, r: radius }];
  const stepLength = step ?? Math.max(radius * 0.6, 0.35);

  for (let iteration = 0; iteration < 2000; iteration++) {
    const guess = v3.add(center, v3.scale(direction, stepLength));
    const section = sectionStats(positions, grid, guess, direction, Math.max(radius * 2.4, stepLength * 2), stepLength * 0.6);
    if (!section) break;
    const moved = v3.sub(section.center, center);
    const advance = v3.dot(moved, direction);
    if (advance < stepLength * 0.25) break; // reached the closed end
    const newDirection = v3.norm(v3.add(v3.scale(direction, 0.55), v3.scale(v3.norm(moved), 0.45)));
    center = section.center;
    radius = radius * 0.6 + section.radius * 0.4;
    direction = newDirection;
    points.push({ p: center, r: radius });
  }
  return points;
}

function sectionStats(positions, grid, guess, direction, searchRadius, halfThickness) {
  const found = grid.radius(guess, searchRadius);
  let x = 0;
  let y = 0;
  let z = 0;
  let n = 0;
  const members = [];
  for (const i of found) {
    const p = v3.at(positions, i);
    const along = v3.dot(v3.sub(p, guess), direction);
    if (Math.abs(along) > halfThickness) continue;
    x += p[0];
    y += p[1];
    z += p[2];
    n++;
    members.push(p);
  }
  if (n < 3) return null;
  const center = [x / n, y / n, z / n];
  let r = 0;
  for (const p of members) {
    const d = v3.sub(p, center);
    const along = v3.dot(d, direction);
    r += Math.sqrt(Math.max(v3.dot(d, d) - along * along, 0));
  }
  return { center, radius: r / n };
}

function sectionCenter(positions, grid, guess, direction, searchRadius) {
  const s = sectionStats(positions, grid, guess, direction, searchRadius, searchRadius * 0.35);
  return s ? s.center : null;
}

function estimateRadius(positions, grid, point, direction, maxRadius) {
  const s = sectionStats(positions, grid, point, direction, maxRadius, maxRadius * 0.25);
  return s ? Math.max(s.radius, 0.3) : maxRadius / 3;
}

/** Resamples a polyline of {p, r} to a fixed spacing, with light smoothing. */
export function resamplePolyline(points, spacing, smoothIterations = 2) {
  if (points.length < 2) return points.slice();
  let pts = points.map((q) => ({ p: q.p.slice(), r: q.r }));
  for (let it = 0; it < smoothIterations; it++) {
    pts = pts.map((q, i) => {
      if (i === 0 || i === pts.length - 1) return q;
      const a = pts[i - 1];
      const b = pts[i + 1];
      return {
        p: [0, 1, 2].map((c) => 0.25 * a.p[c] + 0.5 * q.p[c] + 0.25 * b.p[c]),
        r: 0.25 * a.r + 0.5 * q.r + 0.25 * b.r,
      };
    });
  }
  const lengths = [0];
  for (let i = 1; i < pts.length; i++) lengths.push(lengths[i - 1] + v3.dist(pts[i - 1].p, pts[i].p));
  const total = lengths[lengths.length - 1];
  const count = Math.max(2, Math.ceil(total / spacing) + 1);
  const out = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const s = (total * k) / (count - 1);
    while (seg < pts.length - 2 && lengths[seg + 1] < s) seg++;
    const span = lengths[seg + 1] - lengths[seg] || 1;
    const t = Math.min(Math.max((s - lengths[seg]) / span, 0), 1);
    out.push({ p: v3.lerp(pts[seg].p, pts[seg + 1].p, t), r: pts[seg].r + (pts[seg + 1].r - pts[seg].r) * t });
  }
  return out;
}

export function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += v3.dist(points[i - 1].p ?? points[i - 1], points[i].p ?? points[i]);
  return total;
}

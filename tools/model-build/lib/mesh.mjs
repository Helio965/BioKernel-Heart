/**
 * Small triangle-mesh toolkit used by the model pipeline.
 *
 * A mesh is { positions: Float64Array(n*3), indices: Uint32Array(m*3),
 * attributes: { name: { size, array: Float32Array } } }. Everything here is
 * plain JavaScript so the pipeline has no native dependencies.
 */

export function createMesh(positions, indices, attributes = {}) {
  return {
    positions: positions instanceof Float64Array ? positions : Float64Array.from(positions),
    indices: indices instanceof Uint32Array ? indices : Uint32Array.from(indices),
    attributes,
  };
}

export const vertexCount = (mesh) => mesh.positions.length / 3;
export const triangleCount = (mesh) => mesh.indices.length / 3;

/** Parses a BodyParts3D OBJ file (header comments + v/vn/f records). */
export function parseObj(text) {
  const positions = [];
  const indices = [];
  const header = {};
  for (const line of text.split('\n')) {
    if (line.charCodeAt(0) === 35 /* # */) {
      const match = /^#\s*([^:]+?)\s*:\s*(.*)$/.exec(line.trim());
      if (match) header[match[1]] = match[2].trim();
    } else if (line.startsWith('v ')) {
      const parts = line.trim().split(/\s+/);
      positions.push(+parts[1], +parts[2], +parts[3]);
    } else if (line.startsWith('f ')) {
      const parts = line.trim().split(/\s+/).slice(1).map((token) => parseInt(token, 10) - 1);
      for (let i = 1; i < parts.length - 1; i++) indices.push(parts[0], parts[i], parts[i + 1]);
    }
  }
  return { mesh: createMesh(positions, indices), header };
}

/** Merges vertices closer than `epsilon` and removes degenerate/duplicate triangles. */
export function weld(mesh, epsilon = 1e-4) {
  const n = vertexCount(mesh);
  const remap = new Uint32Array(n);
  const keys = new Map();
  const positions = [];
  const attrNames = Object.keys(mesh.attributes);
  const attrOut = Object.fromEntries(attrNames.map((k) => [k, []]));
  const inv = 1 / epsilon;
  for (let i = 0; i < n; i++) {
    const x = mesh.positions[i * 3];
    const y = mesh.positions[i * 3 + 1];
    const z = mesh.positions[i * 3 + 2];
    const key = `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}`;
    let index = keys.get(key);
    if (index === undefined) {
      index = positions.length / 3;
      keys.set(key, index);
      positions.push(x, y, z);
      for (const k of attrNames) {
        const { size, array } = mesh.attributes[k];
        for (let c = 0; c < size; c++) attrOut[k].push(array[i * size + c]);
      }
    }
    remap[i] = index;
  }
  const indices = [];
  const seen = new Set();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = remap[mesh.indices[t]];
    const b = remap[mesh.indices[t + 1]];
    const c = remap[mesh.indices[t + 2]];
    if (a === b || b === c || a === c) continue;
    const sorted = [a, b, c].sort((p, q) => p - q).join(',');
    if (seen.has(sorted)) continue;
    seen.add(sorted);
    indices.push(a, b, c);
  }
  const attributes = Object.fromEntries(
    attrNames.map((k) => [k, { size: mesh.attributes[k].size, array: Float32Array.from(attrOut[k]) }]),
  );
  return createMesh(positions, indices, attributes);
}

/** Concatenates meshes (attributes must match). */
export function mergeMeshes(meshes) {
  const positions = [];
  const indices = [];
  const attrNames = meshes.length ? Object.keys(meshes[0].attributes) : [];
  const attrOut = Object.fromEntries(attrNames.map((k) => [k, []]));
  let offset = 0;
  for (const mesh of meshes) {
    for (const v of mesh.positions) positions.push(v);
    for (const i of mesh.indices) indices.push(i + offset);
    for (const k of attrNames) for (const v of mesh.attributes[k].array) attrOut[k].push(v);
    offset += vertexCount(mesh);
  }
  const attributes = Object.fromEntries(
    attrNames.map((k) => [k, { size: meshes[0].attributes[k].size, array: Float32Array.from(attrOut[k]) }]),
  );
  return createMesh(positions, indices, attributes);
}

/**
 * Cuts the mesh with an axis-aligned plane and keeps one side. Triangles that
 * cross the plane are split exactly, so the cut is clean and flat.
 * @param {'x'|'y'|'z'} axis
 * @param {'<'|'>'} keep
 */
export function clipAxis(mesh, axis, keep, value) {
  const a = { x: 0, y: 1, z: 2 }[axis];
  const sign = keep === '>' ? 1 : -1;
  const d = new Float64Array(vertexCount(mesh));
  for (let i = 0; i < d.length; i++) d[i] = sign * (mesh.positions[i * 3 + a] - value);
  return clipByDistance(mesh, d);
}

/**
 * Keeps the part of the mesh where the per-vertex signed distance `d` is >= 0.
 * Triangles that cross the zero level are split on their edges (linear
 * interpolation), so a plane cut stays clean and flat.
 */
export function clipByDistance(mesh, d) {
  const positions = Array.from(mesh.positions);
  const edgeCache = new Map();
  function cutPoint(i, j) {
    const key = i < j ? `${i}_${j}` : `${j}_${i}`;
    let index = edgeCache.get(key);
    if (index !== undefined) return index;
    const t = d[i] / (d[i] - d[j]);
    index = positions.length / 3;
    for (let c = 0; c < 3; c++) positions.push(positions[i * 3 + c] + (positions[j * 3 + c] - positions[i * 3 + c]) * t);
    edgeCache.set(key, index);
    return index;
  }

  const indices = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const tri = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]];
    const inside = tri.map((i) => d[i] >= 0);
    const count = inside.filter(Boolean).length;
    if (count === 3) {
      indices.push(...tri);
    } else if (count === 1) {
      const k = inside.indexOf(true);
      const p = tri[k];
      const q = tri[(k + 1) % 3];
      const r = tri[(k + 2) % 3];
      indices.push(p, cutPoint(p, q), cutPoint(p, r));
    } else if (count === 2) {
      const k = inside.indexOf(false);
      const p = tri[k];
      const q = tri[(k + 1) % 3];
      const r = tri[(k + 2) % 3];
      const pq = cutPoint(p, q);
      const pr = cutPoint(p, r);
      indices.push(pq, q, r, pq, r, pr);
    }
  }
  if (Object.keys(mesh.attributes).length) throw new Error('clipByDistance: attributes are not supported');
  return compact(createMesh(positions, indices));
}

/** Drops unreferenced vertices. */
export function compact(mesh) {
  const n = vertexCount(mesh);
  const used = new Int32Array(n).fill(-1);
  let next = 0;
  for (const i of mesh.indices) if (used[i] < 0) used[i] = next++;
  const positions = new Float64Array(next * 3);
  const attributes = {};
  for (const [k, { size }] of Object.entries(mesh.attributes)) attributes[k] = { size, array: new Float32Array(next * size) };
  for (let i = 0; i < n; i++) {
    const j = used[i];
    if (j < 0) continue;
    positions.set(mesh.positions.subarray(i * 3, i * 3 + 3), j * 3);
    for (const [k, { size, array }] of Object.entries(mesh.attributes)) {
      attributes[k].array.set(array.subarray(i * size, i * size + size), j * size);
    }
  }
  const indices = Uint32Array.from(mesh.indices, (i) => used[i]);
  return createMesh(positions, indices, attributes);
}

/**
 * Vertex adjacency in CSR form plus edge information.
 * boundary[i] = 1 when the vertex lies on an open edge (used by one triangle).
 */
export function adjacency(mesh) {
  const n = vertexCount(mesh);
  const edgeFaces = new Map();
  const idx = mesh.indices;
  for (let t = 0; t < idx.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e];
      const b = idx[t + ((e + 1) % 3)];
      const key = a < b ? a * n + b : b * n + a;
      edgeFaces.set(key, (edgeFaces.get(key) || 0) + 1);
    }
  }
  const degree = new Uint32Array(n);
  for (const key of edgeFaces.keys()) {
    degree[Math.floor(key / n)]++;
    degree[key % n]++;
  }
  const start = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + degree[i];
  const neighbors = new Uint32Array(start[n]);
  const fill = start.slice(0, n);
  const boundary = new Uint8Array(n);
  for (const [key, count] of edgeFaces) {
    const a = Math.floor(key / n);
    const b = key % n;
    neighbors[fill[a]++] = b;
    neighbors[fill[b]++] = a;
    if (count !== 2) {
      boundary[a] = 1;
      boundary[b] = 1;
    }
  }
  return { start, neighbors, boundary, edgeFaces, n };
}

/**
 * Taubin λ|μ smoothing: removes the staircase / faceting of segmented meshes
 * without the shrinking of plain Laplacian smoothing. Open (cut) boundaries
 * stay fixed so vessel cuts remain flat.
 */
export function taubinSmooth(mesh, iterations = 6, lambda = 0.5, mu = -0.53, adj = adjacency(mesh)) {
  const n = vertexCount(mesh);
  const p = mesh.positions;
  const tmp = new Float64Array(n * 3);
  const step = (factor) => {
    for (let i = 0; i < n; i++) {
      const s = adj.start[i];
      const e = adj.start[i + 1];
      if (adj.boundary[i] || e === s) {
        tmp[i * 3] = p[i * 3];
        tmp[i * 3 + 1] = p[i * 3 + 1];
        tmp[i * 3 + 2] = p[i * 3 + 2];
        continue;
      }
      let x = 0;
      let y = 0;
      let z = 0;
      for (let k = s; k < e; k++) {
        const j = adj.neighbors[k];
        x += p[j * 3];
        y += p[j * 3 + 1];
        z += p[j * 3 + 2];
      }
      const inv = 1 / (e - s);
      tmp[i * 3] = p[i * 3] + factor * (x * inv - p[i * 3]);
      tmp[i * 3 + 1] = p[i * 3 + 1] + factor * (y * inv - p[i * 3 + 1]);
      tmp[i * 3 + 2] = p[i * 3 + 2] + factor * (z * inv - p[i * 3 + 2]);
    }
    p.set(tmp);
  };
  for (let it = 0; it < iterations; it++) {
    step(lambda);
    step(mu);
  }
  return mesh;
}

/**
 * One level of Loop subdivision. Custom attributes are interpolated linearly
 * (odd vertices = edge midpoints). Non-manifold and open edges use the
 * boundary rules, so cut vessel ends keep their outline.
 */
export function loopSubdivide(mesh) {
  const n = vertexCount(mesh);
  const adj = adjacency(mesh);
  const idx = mesh.indices;
  const P = mesh.positions;

  // Opposite vertices of every edge (for interior edges).
  const opposite = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e];
      const b = idx[t + ((e + 1) % 3)];
      const c = idx[t + ((e + 2) % 3)];
      const key = a < b ? a * n + b : b * n + a;
      const list = opposite.get(key);
      if (list) list.push(c);
      else opposite.set(key, [c]);
    }
  }

  const edgeIndex = new Map();
  const positions = new Float64Array((n + opposite.size) * 3);
  const attrNames = Object.keys(mesh.attributes);
  const attributes = {};
  for (const k of attrNames) {
    const { size, array } = mesh.attributes[k];
    attributes[k] = { size, array: new Float32Array((n + opposite.size) * size) };
    attributes[k].array.set(array);
  }

  // Even (original) vertices.
  for (let i = 0; i < n; i++) {
    const s = adj.start[i];
    const e = adj.start[i + 1];
    const valence = e - s;
    let x = 0;
    let y = 0;
    let z = 0;
    if (adj.boundary[i]) {
      // Boundary rule: only the neighbours along open edges.
      let count = 0;
      for (let k = s; k < e; k++) {
        const j = adj.neighbors[k];
        const key = i < j ? i * n + j : j * n + i;
        if (adj.edgeFaces.get(key) !== 2) {
          x += P[j * 3];
          y += P[j * 3 + 1];
          z += P[j * 3 + 2];
          count++;
        }
      }
      if (count === 2) {
        positions[i * 3] = 0.75 * P[i * 3] + 0.125 * x;
        positions[i * 3 + 1] = 0.75 * P[i * 3 + 1] + 0.125 * y;
        positions[i * 3 + 2] = 0.75 * P[i * 3 + 2] + 0.125 * z;
      } else {
        positions.set(P.subarray(i * 3, i * 3 + 3), i * 3);
      }
      continue;
    }
    for (let k = s; k < e; k++) {
      const j = adj.neighbors[k];
      x += P[j * 3];
      y += P[j * 3 + 1];
      z += P[j * 3 + 2];
    }
    const beta = valence > 3 ? 3 / (8 * valence) : 3 / 16;
    const keep = 1 - valence * beta;
    positions[i * 3] = keep * P[i * 3] + beta * x;
    positions[i * 3 + 1] = keep * P[i * 3 + 1] + beta * y;
    positions[i * 3 + 2] = keep * P[i * 3 + 2] + beta * z;
  }

  // Odd (edge) vertices.
  let next = n;
  for (const [key, opp] of opposite) {
    const a = Math.floor(key / n);
    const b = key % n;
    const o = next++;
    edgeIndex.set(key, o);
    for (let c = 0; c < 3; c++) {
      if (opp.length === 2) {
        positions[o * 3 + c] =
          0.375 * (P[a * 3 + c] + P[b * 3 + c]) + 0.125 * (P[opp[0] * 3 + c] + P[opp[1] * 3 + c]);
      } else {
        positions[o * 3 + c] = 0.5 * (P[a * 3 + c] + P[b * 3 + c]);
      }
    }
    for (const k of attrNames) {
      const { size, array } = mesh.attributes[k];
      for (let c = 0; c < size; c++) {
        attributes[k].array[o * size + c] = 0.5 * (array[a * size + c] + array[b * size + c]);
      }
    }
  }

  const indices = new Uint32Array(idx.length * 4);
  let w = 0;
  const mid = (a, b) => edgeIndex.get(a < b ? a * n + b : b * n + a);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t];
    const b = idx[t + 1];
    const c = idx[t + 2];
    const ab = mid(a, b);
    const bc = mid(b, c);
    const ca = mid(c, a);
    indices.set([a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca], w);
    w += 12;
  }
  return createMesh(positions, indices, attributes);
}

/** Area-weighted smooth vertex normals. */
export function computeNormals(mesh) {
  const n = vertexCount(mesh);
  const normals = new Float64Array(n * 3);
  const P = mesh.positions;
  const idx = mesh.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3;
    const b = idx[t + 1] * 3;
    const c = idx[t + 2] * 3;
    const ux = P[b] - P[a];
    const uy = P[b + 1] - P[a + 1];
    const uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a];
    const vy = P[c + 1] - P[a + 1];
    const vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      normals[v] += nx;
      normals[v + 1] += ny;
      normals[v + 2] += nz;
    }
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = normals[i * 3];
    const y = normals[i * 3 + 1];
    const z = normals[i * 3 + 2];
    const len = Math.hypot(x, y, z) || 1;
    out[i * 3] = x / len;
    out[i * 3 + 1] = y / len;
    out[i * 3 + 2] = z / len;
  }
  return out;
}

export function meanEdgeLength(mesh) {
  const P = mesh.positions;
  const idx = mesh.indices;
  let total = 0;
  for (let t = 0; t < idx.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e] * 3;
      const b = idx[t + ((e + 1) % 3)] * 3;
      total += Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]);
    }
  }
  return total / idx.length;
}

/**
 * Splits a mesh into sub-meshes by a label per triangle. Vertices on the seams
 * are duplicated; normals/attributes computed before the split keep the
 * shading continuous across the seams.
 */
export function splitByFaceLabel(mesh, faceLabels) {
  const groups = new Map();
  for (let t = 0; t < faceLabels.length; t++) {
    const label = faceLabels[t];
    if (label === null || label === undefined) continue;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(t);
  }
  const result = new Map();
  for (const [label, faces] of groups) {
    const indices = new Uint32Array(faces.length * 3);
    faces.forEach((t, i) => indices.set(mesh.indices.subarray(t * 3, t * 3 + 3), i * 3));
    const sub = compact(createMesh(mesh.positions, indices, mesh.attributes));
    sub.sourceIndex = remapOf(mesh, indices);
    result.set(label, sub);
  }
  return result;
}

function remapOf(mesh, indices) {
  // Original vertex index for every vertex of the compacted sub-mesh.
  const n = vertexCount(mesh);
  const used = new Int32Array(n).fill(-1);
  const order = [];
  for (const i of indices) {
    if (used[i] < 0) {
      used[i] = order.length;
      order.push(i);
    }
  }
  return Uint32Array.from(order);
}

/** Axis-aligned bounds. */
export function bounds(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      min[c] = Math.min(min[c], positions[i + c]);
      max[c] = Math.max(max[c], positions[i + c]);
    }
  }
  return { min, max };
}

/** Binary-heap Dijkstra over the mesh graph (edge weight = length × weightFn). */
export function dijkstra(mesh, adj, sources, { weight = null, allowed = null, maxDistance = Infinity } = {}) {
  const n = vertexCount(mesh);
  const P = mesh.positions;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const heap = new MinHeap();
  for (const [index, d0] of sources) {
    if (d0 < dist[index]) {
      dist[index] = d0;
      heap.push(index, d0);
    }
  }
  while (heap.size) {
    const [i, d] = heap.pop();
    if (d > dist[i] || d > maxDistance) continue;
    for (let k = adj.start[i]; k < adj.start[i + 1]; k++) {
      const j = adj.neighbors[k];
      if (allowed && !allowed[j]) continue;
      let w = Math.hypot(P[i * 3] - P[j * 3], P[i * 3 + 1] - P[j * 3 + 1], P[i * 3 + 2] - P[j * 3 + 2]);
      if (weight) w *= weight(i, j);
      const nd = d + w;
      if (nd < dist[j]) {
        dist[j] = nd;
        prev[j] = i;
        heap.push(j, nd);
      }
    }
  }
  return { dist, prev };
}

export class MinHeap {
  constructor() {
    this.keys = [];
    this.values = [];
  }
  get size() {
    return this.keys.length;
  }
  push(value, key) {
    const keys = this.keys;
    const values = this.values;
    let i = keys.length;
    keys.push(key);
    values.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      keys[i] = keys[parent];
      values[i] = values[parent];
      i = parent;
    }
    keys[i] = key;
    values[i] = value;
  }
  pop() {
    const keys = this.keys;
    const values = this.values;
    const topValue = values[0];
    const topKey = keys[0];
    const lastKey = keys.pop();
    const lastValue = values.pop();
    if (keys.length) {
      let i = 0;
      const n = keys.length;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && keys[child + 1] < keys[child]) child++;
        if (keys[child] >= lastKey) break;
        keys[i] = keys[child];
        values[i] = values[child];
        i = child;
      }
      keys[i] = lastKey;
      values[i] = lastValue;
    }
    return [topValue, topKey];
  }
}

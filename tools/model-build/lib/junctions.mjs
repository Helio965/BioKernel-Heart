/**
 * Joins vessel segments that BodyParts3D models as separate closed pieces
 * meeting end to end (ascending aorta -> arch -> descending aorta, right
 * brachiocephalic vein -> superior vena cava).
 *
 * In the source data each segment is a closed tube: its end is a rounded cap
 * sitting inside the next segment, and the two tubes are offset and of
 * different calibre where they meet, which shows as a ring, a ledge or a step
 * on the rendered vessel. For each junction:
 *
 *   1. find the junction (where the two surfaces touch) and the axis from the
 *      body of the first piece to the body of the second;
 *   2. measure cross-sections along that axis to find where each piece stops
 *      being a full tube (where its end cap starts);
 *   3. cut each piece there, with a plane perpendicular to its own local axis
 *      (a true cross-section, even where the vessel curves); only the part
 *      connected to the end cap is removed;
 *   4. move and scale both open ends smoothly (over about one radius) so the
 *      two rims have the same calibre and line up;
 *   5. bridge the gap with a lofted tube (cubic Hermite from rim to rim,
 *      tangent to both pieces, bending like an elbow when the axes differ),
 *      attached to the first piece so its surface and normals are continuous.
 *
 * Works in the BodyParts3D frame (millimetres), after the per-piece cleanup.
 */
import { buildBVH } from './bvh.mjs';
import { adjacency, clipByDistance, createMesh, vertexCount } from './mesh.mjs';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a) => Math.sqrt(dot(a, a));
const normalize = (a) => scale(a, 1 / Math.max(length(a), 1e-12));
const at = (P, i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

function centroid(points) {
  const c = [0, 0, 0];
  for (const p of points) for (let k = 0; k < 3; k++) c[k] += p[k] / points.length;
  return c;
}

/** Orthonormal frame around an axis: { origin, axis, e1, e2 }. */
function frame(origin, axis, reference = null) {
  const d = normalize(axis);
  let r = reference ?? (Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
  r = sub(r, scale(d, dot(r, d)));
  if (length(r) < 1e-6) r = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = normalize(sub(r, scale(d, dot(r, d))));
  return { origin, axis: d, e1, e2: cross(d, e1) };
}
const alongOf = (f, p) => dot(sub(p, f.origin), f.axis);
const perpOf = (f, v) => sub(v, scale(f.axis, dot(v, f.axis)));
const angleOf = (f, v) => Math.atan2(dot(v, f.e2), dot(v, f.e1));

/**
 * Cross-section of a mesh with the plane (frame, depth t): the closed loop
 * nearest to the frame axis, as { points, center, radius, coverage }.
 */
function section(mesh, f, t, maxRadius) {
  const P = mesh.positions;
  const I = mesh.indices;
  const n = vertexCount(mesh);
  const points = new Map();
  const links = new Map();
  const link = (a, b) => {
    if (!links.has(a)) links.set(a, []);
    links.get(a).push(b);
  };
  const axisPoint = add(f.origin, scale(f.axis, t));
  for (let k = 0; k < I.length; k += 3) {
    const ids = [I[k], I[k + 1], I[k + 2]];
    const tri = ids.map((i) => at(P, i));
    if (tri.some((p) => length(perpOf(f, sub(p, axisPoint))) > maxRadius)) continue;
    const d = tri.map((p) => alongOf(f, p) - t);
    const keys = [];
    for (let e = 0; e < 3; e++) {
      const a = d[e];
      const b = d[(e + 1) % 3];
      if ((a < 0) === (b < 0)) continue;
      const i = ids[e];
      const j = ids[(e + 1) % 3];
      const key = i < j ? i * n + j : j * n + i;
      if (!points.has(key)) points.set(key, add(tri[e], scale(sub(tri[(e + 1) % 3], tri[e]), a / (a - b))));
      keys.push(key);
    }
    if (keys.length === 2) {
      link(keys[0], keys[1]);
      link(keys[1], keys[0]);
    }
  }
  const loops = [];
  const seen = new Set();
  for (const start of links.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let previous = null;
    let current = start;
    while (current !== undefined && !seen.has(current)) {
      seen.add(current);
      loop.push(points.get(current));
      const next = (links.get(current) ?? []).find((k) => k !== previous && !seen.has(k));
      previous = current;
      current = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  let best = null;
  for (const loop of loops) {
    let weight = 0;
    const center = [0, 0, 0];
    for (let k = 0; k < loop.length; k++) {
      const p = loop[k];
      const q = loop[(k + 1) % loop.length];
      const l = length(sub(q, p));
      weight += l;
      for (let c = 0; c < 3; c++) center[c] += ((p[c] + q[c]) / 2) * l;
    }
    if (weight === 0) continue;
    for (let c = 0; c < 3; c++) center[c] /= weight;
    const offAxis = length(perpOf(f, sub(center, axisPoint)));
    if (!best || offAxis < best.offAxis) best = { points: loop, center, offAxis };
  }
  if (!best) return null;
  let radius = 0;
  const bins = new Set();
  for (const p of best.points) {
    const v = perpOf(f, sub(p, best.center));
    radius += length(v) / best.points.length;
    bins.add(Math.floor(((angleOf(f, v) + Math.PI) / (2 * Math.PI)) * 24) % 24);
  }
  return { points: best.points, center: best.center, radius, coverage: bins.size / 24 };
}

/** Point of a closed polygon (on a plane of frame f) in direction `angle` from `center`. */
function polygonPoint(points, f, center, angle) {
  const dir = add(scale(f.e1, Math.cos(angle)), scale(f.e2, Math.sin(angle)));
  const side = cross(f.axis, dir);
  let best = null;
  let bestT = -Infinity;
  for (let k = 0; k < points.length; k++) {
    const p = points[k];
    const q = points[(k + 1) % points.length];
    const sp = dot(sub(p, center), side);
    const sq = dot(sub(q, center), side);
    if ((sp < 0) === (sq < 0)) continue;
    const x = add(p, scale(sub(q, p), sp / (sp - sq)));
    const t = dot(sub(x, center), dir);
    if (t > bestT) {
      bestT = t;
      best = x;
    }
  }
  return best;
}

/** Ordered boundary loops (open edges, in the direction they have in their triangle). */
function boundaryLoops(mesh) {
  const I = mesh.indices;
  const n = vertexCount(mesh);
  const count = new Map();
  for (let t = 0; t < I.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = I[t + e];
      const b = I[t + ((e + 1) % 3)];
      const key = a < b ? a * n + b : b * n + a;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  const next = new Map();
  for (let t = 0; t < I.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = I[t + e];
      const b = I[t + ((e + 1) % 3)];
      if (count.get(a < b ? a * n + b : b * n + a) === 1) next.set(a, b);
    }
  }
  const loops = [];
  const seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let v = start;
    while (v !== undefined && !seen.has(v)) {
      seen.add(v);
      loop.push(v);
      v = next.get(v);
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** Vertices reachable from `seeds` through vertices accepted by `inside`. */
function grow(mesh, seeds, inside) {
  const adj = adjacency(mesh);
  const reached = new Uint8Array(vertexCount(mesh));
  const stack = seeds.filter((i) => inside(i));
  for (const i of stack) reached[i] = 1;
  while (stack.length) {
    const i = stack.pop();
    for (let k = adj.start[i]; k < adj.start[i + 1]; k++) {
      const j = adj.neighbors[k];
      if (!reached[j] && inside(j)) {
        reached[j] = 1;
        stack.push(j);
      }
    }
  }
  return reached;
}

/**
 * @param {object} meshA upstream segment
 * @param {object} meshB downstream segment
 * @returns {{ a: object, b: object, info: object }}
 */
export function fuseJunction(meshA, meshB, { touch = 3, reach = 30, far = 8, blend = 1.2 } = {}) {
  // 1. Junction centre and axis.
  const bvhA = buildBVH(meshA);
  const bvhB = buildBVH(meshB);
  const touchingA = [];
  const touchingB = [];
  for (let i = 0; i < vertexCount(meshA); i++) if (bvhB.distance(at(meshA.positions, i), touch) <= touch) touchingA.push(i);
  for (let i = 0; i < vertexCount(meshB); i++) if (bvhA.distance(at(meshB.positions, i), touch) <= touch) touchingB.push(i);
  if (touchingA.length + touchingB.length < 6) throw new Error('fuseJunction: the pieces do not touch');
  const J = centroid([...touchingA.map((i) => at(meshA.positions, i)), ...touchingB.map((i) => at(meshB.positions, i))]);
  const body = (mesh, other) => {
    const pts = [];
    for (let i = 0; i < vertexCount(mesh); i++) {
      const p = at(mesh.positions, i);
      if (length(sub(p, J)) < reach && other.distance(p, far) > far) pts.push(p);
    }
    return centroid(pts);
  };
  const main = frame(J, sub(body(meshB, bvhA), body(meshA, bvhB)));

  // 2. Where does each piece stop being a full tube (along the main axis)?
  function fullTubeLimit(mesh, side) {
    const radii = [];
    let limit = null;
    for (let s = 18; s >= -18; s -= 0.5) {
      const t = -side * s; // from the body of the piece towards the other one
      const sec = section(mesh, main, t, reach);
      if (s >= 10) {
        if (sec && sec.coverage > 0.85) radii.push(sec.radius);
        continue;
      }
      const reference = radii.length ? radii.slice().sort((x, y) => x - y)[Math.floor(radii.length / 2)] : null;
      if (!sec || sec.coverage < 0.85 || (reference && sec.radius < 0.9 * reference)) break;
      limit = t;
    }
    if (limit === null) throw new Error('fuseJunction: no full cross-section near the junction');
    return limit - side; // 1 mm before the cap
  }
  const endA = fullTubeLimit(meshA, 1); // A is a full tube for t <= endA
  const startB = fullTubeLimit(meshB, -1); // B is a full tube for t >= startB

  // Local axis of a piece at depth t (section centres 5 mm apart, inside the piece).
  const localFrame = (mesh, t, side) => {
    const near = section(mesh, main, t, reach);
    const deep = section(mesh, main, t - side * 5, reach);
    if (!near || !deep) throw new Error('fuseJunction: no cross-section for the local axis');
    const axis = side > 0 ? sub(near.center, deep.center) : sub(deep.center, near.center);
    return { f: frame(near.center, axis, main.e1), radius: near.radius };
  };

  // 3. Cut positions: a gap wide enough for the bend between the two axes.
  let cutA;
  let cutB;
  let fa;
  let fb;
  let gap = 3;
  for (let iteration = 0; iteration < 3; iteration++) {
    const middle = (endA + startB) / 2;
    cutA = Math.min(endA, middle - gap / 2);
    cutB = Math.max(startB, middle + gap / 2);
    fa = localFrame(meshA, cutA, 1);
    fb = localFrame(meshB, cutB, -1);
    const bend = Math.acos(Math.min(1, Math.max(-1, dot(fa.f.axis, fb.f.axis))));
    // Room for the bend, like a pipe elbow.
    const needed = 2.5 + 2 * Math.max(fa.radius, fb.radius) * Math.tan(bend / 2);
    if (cutB - cutA >= needed - 1e-6) break;
    gap = needed;
  }

  // Cut each piece with the plane of its local frame; only the part connected
  // to the end cap (near the junction) is removed.
  const cut = (mesh, f, keepSign, radius) => {
    const P = mesh.positions;
    const s = new Float64Array(vertexCount(mesh));
    for (let i = 0; i < s.length; i++) s[i] = keepSign * alongOf(f, at(P, i));
    const seeds = [];
    for (let i = 0; i < s.length; i++) {
      const p = at(P, i);
      if (s[i] < 0 && length(perpOf(f, sub(p, f.origin))) < 1.6 * radius && Math.abs(alongOf(f, p)) < 3 * radius) seeds.push(i);
    }
    const removed = grow(mesh, seeds, (i) => s[i] < 0);
    const d = new Float64Array(s.length);
    for (let i = 0; i < d.length; i++) d[i] = s[i] < 0 && !removed[i] ? 1 : s[i];
    return clipByDistance(mesh, d);
  };
  const a = cut(meshA, fa.f, -1, fa.radius);
  const b = cut(meshB, fb.f, 1, fb.radius);

  const rim = (mesh, f) => {
    const loops = boundaryLoops(mesh).filter((loop) => loop.every((i) => Math.abs(alongOf(f, at(mesh.positions, i))) < 0.05));
    if (!loops.length) throw new Error('fuseJunction: no rim on the cutting plane');
    loops.sort((x, y) => y.length - x.length);
    const loop = loops[0];
    const points = loop.map((i) => at(mesh.positions, i));
    let weight = 0;
    const center = [0, 0, 0];
    for (let k = 0; k < points.length; k++) {
      const p = points[k];
      const q = points[(k + 1) % points.length];
      const l = length(sub(q, p));
      weight += l;
      for (let c = 0; c < 3; c++) center[c] += ((p[c] + q[c]) / 2) * l;
    }
    for (let c = 0; c < 3; c++) center[c] /= weight;
    const radius = points.reduce((sum, p) => sum + length(perpOf(f, sub(p, center))), 0) / points.length;
    return { loop, center, radius };
  };
  const rimA = rim(a, fa.f);
  const rimB = rim(b, fb.f);

  // 4. Line the rims up: the chord between the rim centres should follow the
  // mean direction of the two axes. The rest of the offset is shared between
  // the two ends (more on the downstream piece, over a longer stretch), and
  // both rims get the mean calibre.
  const mean = normalize(add(fa.f.axis, fb.f.axis));
  const chord = sub(rimB.center, rimA.center);
  const offset = sub(chord, scale(mean, dot(chord, mean)));
  const targetRadius = (rimA.radius + rimB.radius) / 2;
  const reshape = (mesh, r, f, inward, shift, span) => {
    const P = mesh.positions;
    const depth = (i) => inward * alongOf(f, at(P, i)); // 0 at the rim, grows into the piece
    // Only the stretch next to this rim: bounded by depth and by distance, and
    // never another open edge (e.g. the seam of a junction joined before).
    const rimSet = new Set(r.loop);
    const open = adjacency(mesh).boundary;
    const limit = span + 1.5 * r.radius;
    const region = grow(
      mesh,
      r.loop,
      (i) => depth(i) > -0.01 && depth(i) <= span && length(sub(at(P, i), r.center)) <= limit && (!open[i] || rimSet.has(i)),
    );
    // Local centre of the tube at each depth (so the scaling is about the right axis).
    const centers = [];
    for (let k = 0; k <= Math.ceil(span) + 1; k++) {
      const sec = k === 0 ? null : section(mesh, f, inward * k, 1.8 * r.radius);
      centers.push(sec ? sec.center : k === 0 ? r.center : centers[k - 1]);
    }
    const shiftPerp = perpOf(f, shift);
    const factor = targetRadius / r.radius - 1;
    const moved = [];
    for (let i = 0; i < vertexCount(mesh); i++) {
      if (!region[i]) continue;
      const p = at(P, i);
      const s = Math.max(0, depth(i));
      const k = Math.min(Math.floor(s), centers.length - 2);
      const c = add(centers[k], scale(sub(centers[k + 1], centers[k]), s - k));
      const w = 1 - smoothstep(0, span, s);
      moved.push([i, add(p, scale(add(shiftPerp, scale(perpOf(f, sub(p, c)), factor)), w))]);
    }
    for (const [i, q] of moved) {
      P[i * 3] = q[0];
      P[i * 3 + 1] = q[1];
      P[i * 3 + 2] = q[2];
    }
  };
  reshape(a, rimA, fa.f, -1, scale(offset, 0.35), 1.6 * blend * targetRadius);
  reshape(b, rimB, fb.f, 1, scale(offset, -0.65), 2.5 * blend * targetRadius);
  const rimA2 = rim(a, fa.f);
  const rimB2 = rim(b, fb.f);

  // 5. Loft (Hermite curves from rim to rim, tangent to both pieces), with B's
  // frame transported from A's so the angles match. The first half of the
  // bridge goes to A and the second half to B: they meet in the middle, where
  // the loft is smooth, so their separately computed normals agree.
  const rotation = (from, to, v) => {
    // Rodrigues rotation taking `from` to `to`, applied to v.
    const k = cross(from, to);
    const s = length(k);
    const c = dot(from, to);
    if (s < 1e-9) return v;
    const axis = scale(k, 1 / s);
    return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
  };
  const frameA = frame(rimA2.center, fa.f.axis, fa.f.e1);
  const frameB = frame(rimB2.center, fb.f.axis, rotation(fa.f.axis, fb.f.axis, fa.f.e1));
  const polygonA = rimA2.loop.map((i) => at(a.positions, i));
  const polygonB = rimB2.loop.map((i) => at(b.positions, i));
  const innerA = section(a, frameA, -2, 1.8 * targetRadius);
  const innerB = section(b, frameB, 2, 1.8 * targetRadius);
  const count = Math.max(24, Math.round((2 * Math.PI * targetRadius) / 1.0));
  let bridge = 0;
  const curves = [];
  for (let j = 0; j < count; j++) {
    const angle = (2 * Math.PI * j) / count - Math.PI;
    const pa = polygonPoint(polygonA, frameA, frameA.origin, angle);
    const pb = polygonPoint(polygonB, frameB, frameB.origin, angle);
    if (!pa || !pb) throw new Error('fuseJunction: rim is not star-shaped around its centre');
    const qa = (innerA && polygonPoint(innerA.points, frameA, innerA.center, angle)) ?? sub(pa, scale(frameA.axis, 2));
    const qb = (innerB && polygonPoint(innerB.points, frameB, innerB.center, angle)) ?? add(pb, scale(frameB.axis, 2));
    const L = length(sub(pb, pa));
    bridge += L / count;
    curves.push({ angle, pa, pb, ta: scale(normalize(sub(pa, qa)), L), tb: scale(normalize(sub(qb, pb)), L) });
  }
  const hermite = ({ pa, pb, ta, tb }, s) => {
    const h00 = 2 * s ** 3 - 3 * s ** 2 + 1;
    const h10 = s ** 3 - 2 * s ** 2 + s;
    const h01 = -2 * s ** 3 + 3 * s ** 2;
    const h11 = s ** 3 - s ** 2;
    return add(add(scale(pa, h00), scale(ta, h10)), add(scale(pb, h01), scale(tb, h11)));
  };
  const steps = Math.max(4, Math.ceil(bridge / 1.0));
  const middle = Math.floor(steps / 2);

  // Adds rings `from..to` of the loft to a mesh, zipped to the mesh's rim.
  const extend = (mesh, rimLoop, rimFrame, rings, rimFirst) => {
    const positions = Array.from(mesh.positions);
    const indices = Array.from(mesh.indices);
    const P = mesh.positions;
    // Orientation of the existing surface at the rim (outward or inward).
    const I = mesh.indices;
    const rimSet = new Set(rimLoop);
    let orientation = 1;
    for (let t = 0; t < I.length; t += 3) {
      const tri = [I[t], I[t + 1], I[t + 2]];
      if (tri.filter((i) => rimSet.has(i)).length < 2) continue;
      const [p0, p1, p2] = tri.map((i) => at(P, i));
      const normal = cross(sub(p1, p0), sub(p2, p0));
      const outward = perpOf(rimFrame, sub(centroid([p0, p1, p2]), rimFrame.origin));
      orientation = dot(normal, outward) >= 0 ? 1 : -1;
      break;
    }
    const ringIds = rings.map((k) =>
      curves.map((curve) => {
        const p = hermite(curve, k / steps);
        positions.push(p[0], p[1], p[2]);
        return positions.length / 3 - 1;
      }),
    );
    const point = (i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
    const addTriangle = (i, j, k, center) => {
      const [p0, p1, p2] = [point(i), point(j), point(k)];
      const normal = cross(sub(p1, p0), sub(p2, p0));
      const outward = sub(centroid([p0, p1, p2]), center);
      if (dot(normal, outward) * orientation >= 0) indices.push(i, j, k);
      else indices.push(i, k, j);
    };
    const ringCenter = (ids) => centroid(ids.map(point));
    // Quads between consecutive rings.
    for (let r = 0; r + 1 < ringIds.length; r++) {
      const c = scale(add(ringCenter(ringIds[r]), ringCenter(ringIds[r + 1])), 0.5);
      for (let j = 0; j < count; j++) {
        const j1 = (j + 1) % count;
        addTriangle(ringIds[r][j], ringIds[r][j1], ringIds[r + 1][j], c);
        addTriangle(ringIds[r][j1], ringIds[r + 1][j1], ringIds[r + 1][j], c);
      }
    }
    // Zipper between the rim (its own vertices) and the nearest loft ring.
    const ring = rimFirst ? ringIds[0] : ringIds[ringIds.length - 1];
    const relative = (angle, start) => (((angle - start) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const rimAngles = rimLoop.map((i) => ({ i, angle: angleOf(rimFrame, perpOf(rimFrame, sub(point(i), rimFrame.origin))) }));
    const start = rimAngles[0].angle;
    const L = rimAngles.map((v) => ({ i: v.i, a: relative(v.angle, start) })).sort((x, y) => x.a - y.a);
    const R = ring.map((i, j) => ({ i, a: relative(curves[j].angle, start) })).sort((x, y) => x.a - y.a);
    const c = scale(add(ringCenter(ring), rimFrame.origin), 0.5);
    let li = 0;
    let rj = 0;
    while (li < L.length || rj < R.length) {
      const nextL = li < L.length ? (li + 1 < L.length ? L[li + 1].a : 2 * Math.PI + L[0].a) : Infinity;
      const nextR = rj < R.length ? (rj + 1 < R.length ? R[rj + 1].a : 2 * Math.PI + R[0].a) : Infinity;
      const l0 = L[li % L.length].i;
      const r0 = R[rj % R.length].i;
      if (nextL <= nextR) {
        addTriangle(l0, r0, L[(li + 1) % L.length].i, c);
        li++;
      } else {
        addTriangle(l0, r0, R[(rj + 1) % R.length].i, c);
        rj++;
      }
    }
    const extended = createMesh(positions, indices);
    // Light local smoothing around the joint (the new seam ring stays fixed).
    const near = new Uint8Array(vertexCount(extended));
    const joint = [...rimLoop, ...ring].map(point);
    for (let i = 0; i < near.length; i++) {
      const p = point(i);
      if (joint.some((q) => length(sub(p, q)) < 4)) near[i] = 1;
    }
    smoothRegion(extended, near, 3);
    return extended;
  };
  const ringsA = [];
  for (let k = 1; k <= middle; k++) ringsA.push(k);
  const ringsB = [];
  for (let k = middle; k < steps; k++) ringsB.push(k);
  const fusedA = extend(a, rimA2.loop, frameA, ringsA, true);
  const fusedB = extend(b, rimB2.loop, frameB, ringsB, false);

  return {
    a: fusedA,
    b: fusedB,
    info: {
      offset: length(offset),
      bend: (Math.acos(Math.min(1, dot(fa.f.axis, fb.f.axis))) * 180) / Math.PI,
      radiusA: rimA.radius,
      radiusB: rimB.radius,
      gap: bridge,
    },
  };
}

/** Taubin smoothing of the masked vertices (open boundaries stay fixed). */
function smoothRegion(mesh, mask, iterations) {
  const adj = adjacency(mesh);
  const P = mesh.positions;
  const n = vertexCount(mesh);
  const next = new Float64Array(P.length);
  const step = (factor) => {
    next.set(P);
    for (let i = 0; i < n; i++) {
      if (!mask[i] || adj.boundary[i]) continue;
      const s = adj.start[i];
      const e = adj.start[i + 1];
      if (e === s) continue;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let k = s; k < e; k++) sum += P[adj.neighbors[k] * 3 + c];
        next[i * 3 + c] = P[i * 3 + c] + factor * (sum / (e - s) - P[i * 3 + c]);
      }
    }
    P.set(next);
  };
  for (let it = 0; it < iterations; it++) {
    step(0.5);
    step(-0.53);
  }
}

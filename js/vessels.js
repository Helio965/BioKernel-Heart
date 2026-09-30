import * as THREE from 'three';

/**
 * Vessel paths.
 *
 * The model pipeline traces the centre line of every vessel of BodyParts3D
 * and stores, in heart-data.json:
 *   - the systemic / pulmonary circuits (vena cava -> RA -> tricuspid -> RV ->
 *     pulmonary valve -> pulmonary arteries; pulmonary veins -> LA -> mitral ->
 *     LV -> aortic valve -> aorta and arch branches);
 *   - the coronary arterial and venous trees (piece connectivity measured on
 *     the meshes).
 * This module turns them into evenly sampled paths with moving frames, used by
 * the blood-flow and coronary-flow particles.
 */

export const REGION = { vein: 0, atrium: 1, avValve: 2, ventricle: 3, slValve: 4, artery: 5 };

function unpack(pack) {
  const points = [];
  for (let i = 0; i < pack.points.length; i += 3) {
    points.push({
      p: new THREE.Vector3(pack.points[i], pack.points[i + 1], pack.points[i + 2]),
      r: pack.radius[i / 3],
      region: pack.region?.[i / 3] ?? REGION.artery,
    });
  }
  return points;
}

/**
 * Builds a sampled path (spacing in cm) from several packed polylines joined
 * end to end, smoothed with a centripetal Catmull-Rom spline.
 */
export function buildPath(packs, spacing = 0.08) {
  const raw = [];
  for (const pack of packs) {
    for (const q of unpack(pack)) {
      const last = raw[raw.length - 1];
      if (last && last.p.distanceTo(q.p) < 0.02) continue;
      raw.push(q);
    }
  }
  if (raw.length < 2) return null;
  const curve = new THREE.CatmullRomCurve3(raw.map((q) => q.p), false, 'centripetal', 0.5);
  const lengths = curve.getLengths(Math.max(raw.length * 6, 50));
  const total = lengths[lengths.length - 1];
  const count = Math.max(2, Math.ceil(total / spacing) + 1);

  // Radius / region of the nearest raw point along the curve.
  const rawU = [0];
  for (let i = 1; i < raw.length; i++) rawU.push(rawU[i - 1] + raw[i - 1].p.distanceTo(raw[i].p));
  const rawTotal = rawU[rawU.length - 1] || 1;

  const positions = new Float32Array(count * 3);
  const radius = new Float32Array(count);
  const region = new Uint8Array(count);
  const tangents = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const binormals = new Float32Array(count * 3);
  const p = new THREE.Vector3();
  const t = new THREE.Vector3();
  let k = 0;
  for (let i = 0; i < count; i++) {
    const u = i / (count - 1);
    curve.getPointAt(u, p);
    curve.getTangentAt(u, t);
    positions.set([p.x, p.y, p.z], i * 3);
    tangents.set([t.x, t.y, t.z], i * 3);
    const along = u * rawTotal;
    while (k < raw.length - 2 && rawU[k + 1] < along) k++;
    const f = THREE.MathUtils.clamp((along - rawU[k]) / Math.max(rawU[k + 1] - rawU[k], 1e-6), 0, 1);
    radius[i] = THREE.MathUtils.lerp(raw[k].r, raw[k + 1].r, f);
    region[i] = f < 0.5 ? raw[k].region : raw[k + 1].region;
  }
  // Parallel-transport frames (no twisting).
  const n = new THREE.Vector3();
  const b = new THREE.Vector3();
  const t0 = new THREE.Vector3().fromArray(tangents, 0);
  n.set(0, 1, 0);
  if (Math.abs(t0.dot(n)) > 0.9) n.set(1, 0, 0);
  n.sub(t0.clone().multiplyScalar(t0.dot(n))).normalize();
  for (let i = 0; i < count; i++) {
    const ti = new THREE.Vector3().fromArray(tangents, i * 3);
    n.sub(ti.clone().multiplyScalar(ti.dot(n))).normalize();
    b.crossVectors(ti, n).normalize();
    normals.set([n.x, n.y, n.z], i * 3);
    binormals.set([b.x, b.y, b.z], i * 3);
  }
  const markers = {};
  for (let i = 0; i < count; i++) {
    if (region[i] === REGION.avValve && markers.av === undefined) markers.av = (i / (count - 1)) * total;
    if (region[i] === REGION.slValve && markers.sl === undefined) markers.sl = (i / (count - 1)) * total;
  }
  return { positions, radius, region, tangents, normals, binormals, count, total, spacing: total / (count - 1), markers };
}

/** Position at arc length s, offset in the cross-section (angle, fraction of radius). */
export function pointOnPath(path, s, angle, fraction, out) {
  const x = THREE.MathUtils.clamp(s / path.spacing, 0, path.count - 1.001);
  const i = Math.floor(x);
  const f = x - i;
  const P = path.positions;
  const N = path.normals;
  const B = path.binormals;
  const r = (path.radius[i] + (path.radius[i + 1] - path.radius[i]) * f) * fraction;
  const c = Math.cos(angle) * r;
  const sn = Math.sin(angle) * r;
  for (let a = 0; a < 3; a++) {
    const base = P[i * 3 + a] + (P[(i + 1) * 3 + a] - P[i * 3 + a]) * f;
    out[a] = base + N[i * 3 + a] * c + B[i * 3 + a] * sn;
  }
  return out;
}

export function regionAt(path, s) {
  const i = THREE.MathUtils.clamp(Math.round(s / path.spacing), 0, path.count - 1);
  return path.region[i];
}

/**
 * Resolves a coronary tree (nodes with parent/parentIndex) into one path per
 * node: root -> ... -> this node's distal end.
 */
export function treePaths(nodes) {
  const result = [];
  nodes.forEach((node, index) => {
    const chain = [];
    let current = index;
    let cut = null; // how much of the node to keep (up to where the child starts)
    while (current >= 0) {
      const n = nodes[current];
      const count = n.points.length / 3;
      const end = cut ?? count - 1;
      chain.unshift({
        points: n.points.slice(0, (end + 1) * 3),
        radius: n.radius.slice(0, end + 1),
        region: n.region?.slice(0, end + 1),
      });
      cut = n.parentIndex;
      current = n.parent;
    }
    result.push({ key: node.key, root: rootKey(nodes, index), packs: chain });
  });
  return result;
}

function rootKey(nodes, index) {
  let current = index;
  while (nodes[current].parent >= 0) current = nodes[current].parent;
  return nodes[current].key;
}

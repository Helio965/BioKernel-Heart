#!/usr/bin/env node
/**
 * Heart model pipeline: BodyParts3D (DBCLS, CC BY 4.0) -> assets/models/.
 *
 *   cd tools/model-build && npm install && node build.mjs
 *
 * Output (committed to the repository, so running the app needs nothing):
 *   assets/models/heart-base.glb    base resolution (loads first)
 *   assets/models/heart-detail.glb  subdivided geometry for close-ups
 *   assets/models/heart-data.json   chamber frames, valves, vessel centre
 *                                   lines, blood-flow paths, conduction
 *                                   system, label anchors
 *
 * Steps (details in docs/ARCHITECTURE.md and docs/MODEL_LICENSE.md):
 *   1. read the OBJ files of every structure listed in js/anatomy.js
 *   2. clip the long vessels with flat planes, weld, Taubin smoothing
 *   3. convert to the app frame (centimetres, Y up, +Z anterior)
 *   4. segment "Wall of ventricle" into LV / RV / septum and the atrial walls
 *      into atria / interatrial septum (by proximity to the cavities)
 *   5. per-vertex tissue data: endocardium, epicardial fat, activation time,
 *      baked ambient occlusion
 *   6. valve opening blend shapes; chordae split from the leaflets
 *   7. cardiac-cycle blend shapes from js/cardiacField.js
 *   8. subdivided detail level, GLB export (quantized + meshopt)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { STRUCTURES } from '../../js/anatomy.js';
import { createCardiacField } from '../../js/cardiacField.js';
import { ensureArchive, loadPieces, orientOutwards } from './lib/source.mjs';
import { fuseJunction } from './lib/junctions.mjs';
import { valueNoise3, lobules } from './lib/noise.mjs';
import {
  createMesh,
  vertexCount,
  triangleCount,
  mergeMeshes,
  adjacency,
  computeNormals,
  splitByFaceLabel,
  loopSubdivide,
  meanEdgeLength,
  dijkstra,
  compact,
} from './lib/mesh.mjs';
import { v3, pca, centroid } from './lib/geom.mjs';
import { buildBVH, buildRayCaster } from './lib/bvh.mjs';
import { deriveVessels } from './lib/vessels.mjs';
import { deriveConduction } from './lib/conduction.mjs';
import { writeGlb } from './lib/export.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const OUT_DIR = path.join(ROOT, 'assets', 'models');
const QUICK = process.argv.includes('--quick'); // skips AO / detail level (for iteration)

const t0 = Date.now();
const log = (...args) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s]`, ...args);
const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// 1-2. Source meshes
// ---------------------------------------------------------------------------
const archive = ensureArchive(path.join(here, '.cache'), process.env.BP3D_ARCHIVE);
const pieces = loadPieces(archive, STRUCTURES);
log(`loaded ${pieces.size} BodyParts3D files`);

// Vessel segments that are separate closed pieces in BodyParts3D: join them so
// each vessel is one continuous surface (no ring or step where they meet).
const JUNCTIONS = [
  ['FJ3413', 'FJ3411'], // ascending aorta -> arch
  ['FJ3411', 'FJ1931'], // arch -> descending thoracic aorta
  ['FJ3583', 'FJ3645'], // right brachiocephalic vein -> superior vena cava
];
for (const [upstream, downstream] of JUNCTIONS) {
  const a = pieces.get(upstream);
  const b = pieces.get(downstream);
  const fused = fuseJunction(a.mesh, b.mesh);
  a.mesh = fused.a;
  b.mesh = fused.b;
  const { offset, radiusA, radiusB, gap } = fused.info;
  log(`joined ${a.key} -> ${b.key}: rims ${radiusA.toFixed(1)} / ${radiusB.toFixed(1)} mm, offset ${offset.toFixed(1)} mm, bridge ${gap.toFixed(1)} mm`);
}

// ---------------------------------------------------------------------------
// 3. App frame: centimetres, Y up (BodyParts3D z), +Z anterior (-y), centred
//    on the four cavities.
// ---------------------------------------------------------------------------
const CAVITY_FILES = { lv: 'FJ2422', rv: 'FJ2423', ra: 'FJ2424', la: 'FJ2425' };
const cavityMin = [Infinity, Infinity, Infinity];
const cavityMax = [-Infinity, -Infinity, -Infinity];
for (const id of Object.values(CAVITY_FILES)) {
  const P = pieces.get(id).mesh.positions;
  for (let i = 0; i < P.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      cavityMin[c] = Math.min(cavityMin[c], P[i + c]);
      cavityMax[c] = Math.max(cavityMax[c], P[i + c]);
    }
  }
}
const ORIGIN_MM = cavityMin.map((m, c) => (m + cavityMax[c]) / 2);
const toApp = ([x, y, z]) => [(x - ORIGIN_MM[0]) / 10, (z - ORIGIN_MM[2]) / 10, -(y - ORIGIN_MM[1]) / 10];

for (const piece of pieces.values()) {
  const P = piece.mesh.positions;
  for (let i = 0; i < P.length; i += 3) {
    const q = toApp([P[i], P[i + 1], P[i + 2]]);
    P[i] = q[0];
    P[i + 1] = q[1];
    P[i + 2] = q[2];
  }
  piece.flipped = orientOutwards(piece.mesh);
}
log('converted to app frame (cm); origin (BodyParts3D mm) =', ORIGIN_MM.map((v) => v.toFixed(1)).join(', '));

const piece = (id) => pieces.get(id).mesh;
const cavities = Object.fromEntries(Object.entries(CAVITY_FILES).map(([k, id]) => [k, buildBVH(piece(id))]));

// ---------------------------------------------------------------------------
// 4. Wall segmentation
// ---------------------------------------------------------------------------
function labelFaces(mesh, vertexLabels, passes = 2) {
  const idx = mesh.indices;
  const faceCount = idx.length / 3;
  let labels = new Array(faceCount);
  for (let t = 0; t < faceCount; t++) {
    const a = vertexLabels[idx[t * 3]];
    const b = vertexLabels[idx[t * 3 + 1]];
    const c = vertexLabels[idx[t * 3 + 2]];
    labels[t] = a === b || a === c ? a : b === c ? b : a;
  }
  // Majority smoothing over edge-adjacent faces removes speckles.
  const edgeFaces = new Map();
  const n = vertexCount(mesh);
  for (let t = 0; t < faceCount; t++) {
    for (let e = 0; e < 3; e++) {
      const a = idx[t * 3 + e];
      const b = idx[t * 3 + ((e + 1) % 3)];
      const key = a < b ? a * n + b : b * n + a;
      const list = edgeFaces.get(key);
      if (list) list.push(t);
      else edgeFaces.set(key, [t]);
    }
  }
  for (let pass = 0; pass < passes; pass++) {
    const next = labels.slice();
    for (let t = 0; t < faceCount; t++) {
      const votes = new Map([[labels[t], 1]]);
      for (let e = 0; e < 3; e++) {
        const a = idx[t * 3 + e];
        const b = idx[t * 3 + ((e + 1) % 3)];
        for (const f of edgeFaces.get(a < b ? a * n + b : b * n + a)) {
          if (f !== t) votes.set(labels[f], (votes.get(labels[f]) || 0) + 1);
        }
      }
      let best = labels[t];
      let bestCount = 0;
      for (const [label, count] of votes) {
        if (count > bestCount) {
          best = label;
          bestCount = count;
        }
      }
      next[t] = best;
    }
    labels = next;
  }
  return labels;
}

/** Normals + a per-vertex "endocardium" weight for a wall mesh. */
function wallData(mesh, ownDistance) {
  const n = vertexCount(mesh);
  const endo = new Float32Array(n);
  for (let i = 0; i < n; i++) endo[i] = 1 - smoothstep(0.06, 0.22, ownDistance[i]);
  return endo;
}

const SEPTUM_SUM = 1.6; // cm: dLV + dRV below this = between the two cavities
const ventricleWall = piece('FJ2428');
const vwNormals = computeNormals(ventricleWall);
const vwCount = vertexCount(ventricleWall);
const dLV = new Float32Array(vwCount);
const dRV = new Float32Array(vwCount);
const vwLabels = new Array(vwCount);
const vwOwn = new Float32Array(vwCount);
for (let i = 0; i < vwCount; i++) {
  const p = v3.at(ventricleWall.positions, i);
  dLV[i] = cavities.lv.distance(p);
  dRV[i] = cavities.rv.distance(p);
  vwLabels[i] = dLV[i] + dRV[i] < SEPTUM_SUM ? 'ivs' : dLV[i] < dRV[i] ? 'lvWall' : 'rvWall';
  vwOwn[i] = vwLabels[i] === 'lvWall' ? dLV[i] : vwLabels[i] === 'rvWall' ? dRV[i] : Math.min(dLV[i], dRV[i]);
}
const histogram = (values, edges) =>
  edges.map((edge, k) => values.filter((v) => v >= (k ? edges[k - 1] : -Infinity) && v < edge).length);
log('ventricle wall distance to own cavity (cm) histogram [<.05,<.1,<.2,<.4,<.8,<2,>2]:',
  histogram(Array.from(vwOwn), [0.05, 0.1, 0.2, 0.4, 0.8, 2, Infinity]).join(' '));
const vwEndo = wallData(ventricleWall, vwOwn);
ventricleWall.attributes.normal = { size: 3, array: vwNormals };
ventricleWall.attributes.endo = { size: 1, array: vwEndo };
const ventricleParts = splitByFaceLabel(ventricleWall, labelFaces(ventricleWall, vwLabels, 3));
log('ventricle wall split:', [...ventricleParts].map(([k, m]) => `${k}=${triangleCount(m)}`).join(' '));

const IAS_SUM = 0.95;
const atrialParts = new Map();
for (const [key, id, own] of [
  ['laWall', 'FJ2438', 'la'],
  ['raWall', 'FJ2439', 'ra'],
]) {
  const mesh = piece(id);
  const n = vertexCount(mesh);
  const labels = new Array(n);
  const ownDistance = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = v3.at(mesh.positions, i);
    const dLA = cavities.la.distance(p);
    const dRA = cavities.ra.distance(p);
    labels[i] = dLA + dRA < IAS_SUM ? 'ias' : key;
    ownDistance[i] = labels[i] === 'ias' ? Math.min(dLA, dRA) : own === 'la' ? dLA : dRA;
  }
  log(`${key} distance to own cavity histogram:`, histogram(Array.from(ownDistance), [0.05, 0.1, 0.2, 0.4, 0.8, 2, Infinity]).join(' '));
  mesh.attributes.normal = { size: 3, array: computeNormals(mesh) };
  mesh.attributes.endo = { size: 1, array: wallData(mesh, ownDistance) };
  for (const [label, sub] of splitByFaceLabel(mesh, labelFaces(mesh, labels, 3))) {
    const list = atrialParts.get(label) ?? [];
    list.push(sub);
    atrialParts.set(label, list);
  }
}
log('atrial walls split:', [...atrialParts].map(([k, list]) => `${k}=${list.reduce((s, m) => s + triangleCount(m), 0)}`).join(' '));

// ---------------------------------------------------------------------------
// Assemble base structures: key -> list of parts { mesh (with normal/endo) }
// ---------------------------------------------------------------------------
/** @type {Map<string, {key:string, name:string, mesh:object, pieceIds?:string[]}[]>} */
const structures = new Map();
function addPart(key, name, mesh, extra = {}) {
  if (!mesh.attributes.normal) mesh.attributes.normal = { size: 3, array: computeNormals(mesh) };
  if (!mesh.attributes.endo) mesh.attributes.endo = { size: 1, array: new Float32Array(vertexCount(mesh)) };
  const list = structures.get(key) ?? [];
  list.push({ key, name, mesh, ...extra });
  structures.set(key, list);
}
for (const [key, mesh] of ventricleParts) addPart(key, key, mesh);
for (const [key, list] of atrialParts) list.forEach((mesh, i) => addPart(key, list.length > 1 ? `${key}_${i}` : key, mesh));

const SPLIT_KEYS = new Set(['lvWall', 'rvWall', 'ivs', 'laWall', 'raWall', 'ias']);
for (const [key, structure] of Object.entries(STRUCTURES)) {
  if (!structure.sources || SPLIT_KEYS.has(key)) continue;
  const meshes = structure.sources.map((id) => piece(id));
  // Single-file structures share the piece mesh (vertex order is preserved,
  // which the valve analysis relies on); the pieces themselves are kept for
  // the centre-line tracer.
  const merged = meshes.length === 1 ? meshes[0] : mergeMeshes(meshes);
  addPart(key, key, merged, { pieceIds: structure.sources });
}
log(`structures: ${structures.size}`);

// ---------------------------------------------------------------------------
// Chamber frames and the cardiac deformation field
// ---------------------------------------------------------------------------
function chamberFrame(mesh) {
  const { mean, axes } = pca(mesh.positions);
  const radii = axes.map((axis) => {
    const proj = [];
    for (let i = 0; i < mesh.positions.length; i += 3) {
      proj.push(Math.abs((mesh.positions[i] - mean[0]) * axis[0] + (mesh.positions[i + 1] - mean[1]) * axis[1] + (mesh.positions[i + 2] - mean[2]) * axis[2]));
    }
    proj.sort((a, b) => a - b);
    return proj[Math.floor(proj.length * 0.97)];
  });
  return { center: mean, axes, radii };
}
const chambers = Object.fromEntries(Object.entries(CAVITY_FILES).map(([k, id]) => [k, chamberFrame(piece(id))]));

// Valve annuli (needed for the base of the heart).
const valveInfo = analyseValves();
const baseCenter = v3.lerp(valveInfo.valves.mitral.center, valveInfo.valves.tricuspid.center, 0.5);
for (const k of ['lv', 'rv']) {
  const c = chambers[k];
  if (v3.dot(c.axes[0], v3.sub(baseCenter, c.center)) < 0) c.axes[0] = v3.scale(c.axes[0], -1);
}
// Apex: the most apical point of the LV wall along the LV long axis.
const lvAxis = chambers.lv.axes[0];
let apex = null;
let apexScore = Infinity;
for (const part of structures.get('lvWall')) {
  const P = part.mesh.positions;
  for (let i = 0; i < P.length; i += 3) {
    const s = (P[i] - baseCenter[0]) * lvAxis[0] + (P[i + 1] - baseCenter[1]) * lvAxis[1] + (P[i + 2] - baseCenter[2]) * lvAxis[2];
    if (s < apexScore) {
      apexScore = s;
      apex = [P[i], P[i + 1], P[i + 2]];
    }
  }
}
const frames = { chambers, longAxis: { apex, base: baseCenter } };
const field = createCardiacField(frames);
log('long axis length (cm):', field.length.toFixed(2), 'apex', apex.map((v) => v.toFixed(2)).join(','));

// ---------------------------------------------------------------------------
// 6. Valves: opening shapes, chordae
// ---------------------------------------------------------------------------
function analyseValves() {
  const pmMeshes = {
    left: mergeMeshes([piece('FJ2418'), piece('FJ2429')]),
    right: mergeMeshes([piece('FJ2419'), piece('FJ2430'), piece('FJ2437')]),
  };
  const pmBVH = { left: buildBVH(pmMeshes.left), right: buildBVH(pmMeshes.right) };
  const wallBVH = buildBVH(piece('FJ2428'));
  const leaflets = {};
  const valves = {};

  // Per leaflet: distance to its atrium, chordae anchors.
  const avKeys = Object.keys(STRUCTURES).filter((k) => STRUCTURES[k].valve?.kind === 'av');
  for (const key of avKeys) {
    const structure = STRUCTURES[key];
    const mesh = piece(structure.sources[0]);
    const n = vertexCount(mesh);
    const atrium = structure.valve.side === 'left' ? cavities.la : cavities.ra;
    const dAtrium = new Float32Array(n);
    const anchors = [];
    for (let i = 0; i < n; i++) {
      const p = v3.at(mesh.positions, i);
      dAtrium[i] = atrium.distance(p);
      // Chordae insertions on the papillary muscles (or the wall), deep in the ventricle.
      if (dAtrium[i] > 1.0 && (pmBVH[structure.valve.side].distance(p, 0.3) < 0.15 || wallBVH.distance(p, 0.2) < 0.08)) anchors.push(i);
    }
    leaflets[key] = { key, valve: structure.valve.valve, side: structure.valve.side, mesh, dAtrium, anchors, annulus: [] };
  }

  // Annulus of each AV valve, found geometrically: around the valve axis, the
  // atrial-most, outermost leaflet points of every angular sector. This follows
  // the saddle shape of the ring and weights all of it equally.
  for (const valveName of ['mitral', 'tricuspid']) {
    const members = Object.values(leaflets).filter((l) => l.valve === valveName);
    const side = members[0].side;
    const flow = v3.norm(v3.sub(chamberCenter(side === 'left' ? 'lv' : 'rv'), chamberCenter(side === 'left' ? 'la' : 'ra')));
    const candidates = [];
    for (const l of members) for (let i = 0; i < l.dAtrium.length; i++) if (l.dAtrium[i] < 0.9) candidates.push([l, i]);
    let center = [0, 0, 0];
    for (const [l, i] of candidates) center = v3.add(center, v3.at(l.mesh.positions, i));
    center = v3.scale(center, 1 / candidates.length);
    const u = v3.norm(v3.cross(flow, Math.abs(flow[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const w = v3.cross(flow, u);
    const SECTORS = 40;
    let ringCenter = center;
    for (let pass = 0; pass < 2; pass++) {
      const sectors = Array.from({ length: SECTORS }, () => []);
      for (const [l, i] of candidates) {
        const q = v3.sub(v3.at(l.mesh.positions, i), ringCenter);
        const h = v3.dot(q, flow);
        const x = v3.dot(q, u);
        const y = v3.dot(q, w);
        const k = Math.floor(((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * SECTORS) % SECTORS;
        sectors[k].push({ l, i, h, r: Math.hypot(x, y) });
      }
      const ring = [];
      for (const list of sectors) {
        if (!list.length) continue;
        const rMax = Math.max(...list.map((e) => e.r));
        const outer = list.filter((e) => e.r > rMax * 0.8);
        const hMin = Math.min(...outer.map((e) => e.h));
        ring.push(outer.filter((e) => e.h < hMin + 0.25));
      }
      // Re-centre on the ring (each sector counts once).
      let c = [0, 0, 0];
      for (const sector of ring) {
        let m = [0, 0, 0];
        for (const e of sector) m = v3.add(m, v3.at(e.l.mesh.positions, e.i));
        c = v3.add(c, v3.scale(m, 1 / sector.length));
      }
      ringCenter = v3.scale(c, 1 / ring.length);
      if (pass === 1) {
        for (const l of members) l.annulus = [];
        for (const sector of ring) for (const e of sector) e.l.annulus.push(e.i);
      }
    }
    // Ring point per sector (empty sectors interpolated) for the local hinges.
    const ringPoints = new Array(SECTORS).fill(null);
    for (const l of members) {
      for (const i of l.annulus) {
        const p = v3.at(l.mesh.positions, i);
        const q = v3.sub(p, ringCenter);
        const k = Math.floor(((Math.atan2(v3.dot(q, w), v3.dot(q, u)) + Math.PI) / (2 * Math.PI)) * SECTORS) % SECTORS;
        const e = (ringPoints[k] ??= { sum: [0, 0, 0], n: 0 });
        e.sum = v3.add(e.sum, p);
        e.n++;
      }
    }
    const filled = ringPoints.map((e) => (e ? v3.scale(e.sum, 1 / e.n) : null));
    for (let k = 0; k < SECTORS; k++) {
      if (filled[k]) continue;
      let a = k;
      let b = k;
      while (!filled[(a + SECTORS) % SECTORS]) a--;
      while (!filled[b % SECTORS]) b++;
      const t = (k - a) / (b - a);
      filled[k] = v3.lerp(filled[(a + SECTORS) % SECTORS], filled[b % SECTORS], t);
    }
    const radius = filled.reduce((acc, point) => acc + v3.dist(point, ringCenter), 0) / SECTORS;
    valves[valveName] = { kind: 'av', side, center: ringCenter, flow, u, w, ring: filled, radius };
  }

  for (const l of Object.values(leaflets)) {
    const { mesh, annulus, anchors } = l;
    const n = vertexCount(mesh);
    const adj = adjacency(mesh);
    const fromAnnulus = dijkstra(mesh, adj, annulus.map((i) => [i, 0])).dist;
    const fromAnchor = dijkstra(mesh, adj, anchors.map((i) => [i, 0])).dist;
    let maxA = 0;
    for (let i = 0; i < n; i++) if (Number.isFinite(fromAnnulus[i])) maxA = Math.max(maxA, fromAnnulus[i]);
    const s = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = fromAnnulus[i];
      const b = fromAnchor[i];
      if (Number.isFinite(a) && Number.isFinite(b)) s[i] = a / (a + b);
      else if (Number.isFinite(a)) s[i] = 0.5 * (a / Math.max(maxA, 1e-6));
      else if (Number.isFinite(b)) s[i] = 1 - 0.5 * Math.min(b / 1.5, 1);
      else s[i] = 0.5;
    }
    const hinge = pca(mesh.positions, annulus);
    Object.assign(l, { s, annulusCount: annulus.length, anchorCount: anchors.length, hingeCenter: hinge.mean, hingeAxis: hinge.axes[0] });
    delete l.mesh;
    delete l.dAtrium;
  }

  // Semilunar valves: centre, axis (towards the artery) and radius.
  for (const [valveName, keys, arteryFile] of [
    ['aortic', ['aorticRight', 'aorticLeft', 'aorticPosterior'], 'FJ3413'],
    ['pulmonary', ['pulmonaryLeft', 'pulmonaryRight', 'pulmonaryPosterior'], 'FJ2966'],
  ]) {
    const all = mergeMeshes(keys.map((k) => piece(STRUCTURES[k].sources[0])));
    const { mean, axes } = pca(all.positions);
    let axis = axes[2];
    const artery = centroid(piece(arteryFile).positions);
    if (v3.dot(axis, v3.sub(artery, mean)) < 0) axis = v3.scale(axis, -1);
    const radial = [];
    const along = [];
    for (let i = 0; i < all.positions.length; i += 3) {
      const q = v3.sub(v3.at(all.positions, i / 3), mean);
      const a = v3.dot(q, axis);
      along.push(a);
      radial.push(Math.sqrt(Math.max(v3.dot(q, q) - a * a, 0)));
    }
    radial.sort((a, b) => a - b);
    along.sort((a, b) => a - b);
    valves[valveName] = {
      kind: 'sl',
      center: mean,
      flow: axis,
      radius: radial[Math.floor(radial.length * 0.96)],
      alongMin: along[Math.floor(along.length * 0.02)],
      alongMax: along[Math.floor(along.length * 0.98)],
    };
  }
  return { leaflets, valves };
}

function chamberCenter(k) {
  return centroid(piece(CAVITY_FILES[k]).positions);
}

const EDGE_S = 0.5; // leaflet free edge in normalised annulus->papillary distance
// Open AV leaflets lie almost parallel to the ventricular walls: they rotate
// this fraction of the way from their closed position to the flow direction.
const AV_OPEN_FRACTION = 1.0;

/** Rotation of p around (center, axis) by angle (radians). */
function rotateAround(p, center, axis, angle) {
  const q = v3.sub(p, center);
  const along = v3.dot(q, axis);
  const r = v3.sub(q, v3.scale(axis, along));
  const c = v3.cross(axis, r);
  const rotated = v3.add(v3.add(v3.scale(r, Math.cos(angle)), v3.scale(c, Math.sin(angle))), v3.scale(axis, along));
  return v3.add(center, rotated);
}

function avWeight(s) {
  if (s <= EDGE_S) return Math.sin((Math.PI / 2) * (s / EDGE_S));
  return 1 - smoothstep(EDGE_S, 1.0, s);
}

// Opening of every AV leaflet: a rotation about the tangent of the annulus at
// the leaflet's attachment, towards the ventricle, until the leaflet is almost
// parallel to the inflow (it then lies against the ventricular wall).
for (const leaflet of Object.values(valveInfo.leaflets)) {
  const mesh = piece(STRUCTURES[leaflet.key].sources[0]);
  const valve = valveInfo.valves[leaflet.valve];
  const edge = [];
  for (let i = 0; i < leaflet.s.length; i++) if (Math.abs(leaflet.s[i] - EDGE_S) < 0.06) edge.push(v3.at(mesh.positions, i));
  const edgeCenter = edge.length ? edge.reduce((a, p) => v3.add(a, p), [0, 0, 0]).map((c) => c / edge.length) : centroid(mesh.positions);
  // Hinge: the chord of the leaflet's own attachment line (principal axis of
  // the attachment points), made perpendicular to the inflow.
  leaflet.hingeAxis = v3.norm(v3.sub(leaflet.hingeAxis, v3.scale(valve.flow, v3.dot(leaflet.hingeAxis, valve.flow))));
  // Signed angle that turns hinge->edge into the flow direction.
  let arm = v3.sub(edgeCenter, leaflet.hingeCenter);
  arm = v3.sub(arm, v3.scale(leaflet.hingeAxis, v3.dot(arm, leaflet.hingeAxis)));
  const toFlow = Math.atan2(v3.dot(leaflet.hingeAxis, v3.cross(arm, valve.flow)), v3.dot(arm, valve.flow));
  const limit = (80 * Math.PI) / 180;
  leaflet.openAngle = Math.max(-limit, Math.min(limit, toFlow * AV_OPEN_FRACTION));
  leaflet.edgeCenter = edgeCenter;
  const frame = (p) => {
    const q = v3.sub(p, valve.center);
    const h = v3.dot(q, valve.flow);
    return `r=${Math.sqrt(Math.max(v3.dot(q, q) - h * h, 0)).toFixed(2)} h=${h.toFixed(2)}`;
  };
  log(
    `valve ${leaflet.key}: annulus ${leaflet.annulusCount}, anchors ${leaflet.anchorCount}, ` +
      `hinge ${frame(leaflet.hingeCenter)}, edge ${frame(edgeCenter)} (${edge.length} v), opening ${((leaflet.openAngle * 180) / Math.PI).toFixed(0)}°`,
  );
}

/** Point of the AV annulus at the same angle as p (local hinge). */
function hingePointFor(leaflet, p) {
  const valve = valveInfo.valves[leaflet.valve];
  const q = v3.sub(p, valve.center);
  const angle = Math.atan2(v3.dot(q, valve.w), v3.dot(q, valve.u));
  const x = ((angle + Math.PI) / (2 * Math.PI)) * valve.ring.length - 0.5;
  const k0 = ((Math.floor(x) % valve.ring.length) + valve.ring.length) % valve.ring.length;
  const k1 = (k0 + 1) % valve.ring.length;
  return v3.lerp(valve.ring[k0], valve.ring[k1], x - Math.floor(x));
}

/** Opening displacement of a valve vertex at `amount` (0 closed .. 1 open). */
function valveOpening(key, p, s, amount) {
  const structure = STRUCTURES[key] ?? STRUCTURES[key.replace(/Chordae.*/, '')];
  const leaflet = valveInfo.leaflets[key];
  if (leaflet) {
    // Local hinge: rotate about the tangent of the annulus at this point's
    // angle, towards the inflow direction (the leaflet folds along its whole
    // curved attachment and ends up lying along the ventricular wall).
    const valve = valveInfo.valves[leaflet.valve];
    const hingePoint = hingePointFor(leaflet, p);
    let radial = v3.sub(hingePoint, valve.center);
    radial = v3.norm(v3.sub(radial, v3.scale(valve.flow, v3.dot(radial, valve.flow))));
    const tangent = v3.norm(v3.cross(valve.flow, radial));
    let arm = v3.sub(p, hingePoint);
    arm = v3.sub(arm, v3.scale(tangent, v3.dot(arm, tangent)));
    if (v3.len(arm) < 1e-4) return [0, 0, 0];
    const toFlow = Math.atan2(v3.dot(tangent, v3.cross(arm, valve.flow)), v3.dot(arm, valve.flow));
    const limit = (75 * Math.PI) / 180;
    const theta = Math.max(-limit, Math.min(limit, toFlow * AV_OPEN_FRACTION)) * avWeight(s) * amount;
    return v3.sub(rotateAround(p, hingePoint, tangent, theta), p);
  }
  if (structure?.valve?.kind === 'sl') {
    const valve = valveInfo.valves[structure.valve.valve];
    const q = v3.sub(p, valve.center);
    const along = v3.dot(q, valve.flow);
    const radial = v3.sub(q, v3.scale(valve.flow, along));
    const r = v3.len(radial);
    // Open cusps fold back against the wall of their sinus: every point moves
    // out towards ~86% of the annulus radius (the attachment stays), and the
    // tissue that was near the centre (free edge) rises towards the artery.
    const dir = r > 1e-5 ? v3.scale(radial, 1 / r) : [0, 0, 0];
    const target = valve.radius * 0.86;
    const out = Math.max(target - r, 0) * amount;
    const lift = Math.max(valve.radius - r, 0) * 0.32 * amount;
    return v3.add(v3.scale(dir, out), v3.scale(valve.flow, lift));
  }
  return [0, 0, 0];
}

// Split every AV leaflet into the leaflet itself and its chordae tendineae.
for (const leaflet of Object.values(valveInfo.leaflets)) {
  const [part] = structures.get(leaflet.key);
  const mesh = part.mesh;
  mesh.attributes.valveS = { size: 1, array: leaflet.s };
  const labels = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const mean = (leaflet.s[mesh.indices[t]] + leaflet.s[mesh.indices[t + 1]] + leaflet.s[mesh.indices[t + 2]]) / 3;
    labels.push(mean > EDGE_S + 0.04 ? 'chordae' : 'leaflet');
  }
  const split = splitByFaceLabel(mesh, labels);
  structures.set(leaflet.key, [{ key: leaflet.key, name: leaflet.key, mesh: split.get('leaflet'), valveKey: leaflet.key }]);
  const chordaeKey = leaflet.valve === 'mitral' ? 'mitralChordae' : 'tricuspidChordae';
  if (split.get('chordae')) {
    const list = structures.get(chordaeKey) ?? [];
    list.push({ key: chordaeKey, name: `${leaflet.key}Chordae`, mesh: split.get('chordae'), valveKey: leaflet.key });
    structures.set(chordaeKey, list);
  }
}
for (const [key, structure] of Object.entries(STRUCTURES)) {
  if (structure.valve?.kind === 'sl') for (const part of structures.get(key)) part.valveKey = key;
}

// ---------------------------------------------------------------------------
// 5. Epicardial fat
//
// Where it is (Ndrepepa 2020, Indian J Med Res, PMC7602928): mainly in the
// atrioventricular and interventricular grooves and along the major coronary
// branches (10-14 mm thick there), over the right-ventricular free wall
// (5-7 mm), less over the atria and the LV apex; it carries the coronary
// vessels. Here a 0..1 amount per wall vertex; the epicardium shell turns it
// into volume (scaled down so the coronary vessels stay visible, and the
// zoom reveal thins it further).
// ---------------------------------------------------------------------------
const vesselKeys = Object.keys(STRUCTURES).filter((k) => ['artery', 'vein'].includes(STRUCTURES[k].material));
// The main trunks run in the grooves inside a bed of fat; the small branches
// on the ventricular surface carry only a thin rim of it.
const MAIN_VESSELS = new Set(['lmca', 'lad', 'lcx', 'rca', 'pda', 'coronarySinus', 'greatCardiacVein', 'anteriorInterventricularVein', 'middleCardiacVein', 'smallCardiacVein']);
const vesselBVH = (keys) => buildBVH(mergeMeshes(keys.flatMap((k) => structures.get(k).map((p) => stripAttributes(p.mesh)))));
const mainBVH = vesselBVH(vesselKeys.filter((k) => MAIN_VESSELS.has(k)));
const branchBVH = vesselBVH(vesselKeys.filter((k) => !MAIN_VESSELS.has(k)));
function stripAttributes(mesh) {
  return createMesh(mesh.positions, mesh.indices);
}
for (const key of SPLIT_KEYS) {
  for (const part of structures.get(key) ?? []) {
    const mesh = part.mesh;
    const n = vertexCount(mesh);
    const fat = new Float32Array(n);
    const nearVessel = new Float32Array(n).fill(9);
    for (let i = 0; i < n; i++) {
      if (mesh.attributes.endo.array[i] > 0.5) continue;
      const p = v3.at(mesh.positions, i);
      const dMain = mainBVH.distance(p, 1.5);
      const dBranch = branchBVH.distance(p, 1.5);
      nearVessel[i] = Math.min(dMain, dBranch);
      const h = field.height(p);
      // Atrioventricular groove (a band around the base of the ventricles).
      const groove = Math.exp(-(((h - 0.97) / 0.07) ** 2));
      // Fat carrying the coronary vessels: a wide bed around the main trunks
      // (interventricular grooves), a narrow rim along the branches.
      const halo = Math.max(1 - smoothstep(0.05, 0.38, dMain), 0.3 * (1 - smoothstep(0.02, 0.09, dBranch)));
      let amount = Math.max(groove * 0.78, halo * (0.7 + 0.3 * groove));
      // A thin veil over parts of the right-ventricular free wall and the atria.
      const patch = smoothstep(0.3, 0.95, valueNoise3(v3.scale(p, 0.5), 7));
      if (key === 'rvWall') amount += (1 - amount) * 0.22 * patch * patch;
      else if (key === 'laWall' || key === 'raWall') amount += (1 - amount) * 0.18 * patch * groove;
      fat[i] = Math.min(1, amount);
    }
    mesh.attributes.fat = { size: 1, array: fat };
    mesh.attributes.nearVessel = { size: 1, array: nearVessel };
  }
}
log('epicardial fat computed');

// ---------------------------------------------------------------------------
// Vessel centre lines, trees, blood-flow paths and conduction system
// ---------------------------------------------------------------------------
const vessels = deriveVessels({ STRUCTURES, structures, pieces, piece, cavities, valveInfo, chambers, log });
const conduction = deriveConduction({ structures, piece, cavities, valveInfo, vessels, chambers, field, log });

// ---------------------------------------------------------------------------
// Ambient occlusion (baked on the base level)
// ---------------------------------------------------------------------------
const OCCLUDER_MATERIALS = new Set(['myocardium', 'atrium', 'papillary', 'valve', 'chordae', 'artery', 'vein', 'greatArtery', 'greatVein', 'pulmonaryArtery', 'pulmonaryVein']);
function materialOf(key) {
  return STRUCTURES[key]?.material;
}
if (!QUICK) {
  const occluders = [];
  for (const [key, parts] of structures) if (OCCLUDER_MATERIALS.has(materialOf(key))) for (const p of parts) occluders.push(stripAttributes(p.mesh));
  const caster = buildRayCaster(mergeMeshes(occluders));
  const SAMPLES = 20;
  const FAR = 1.4;
  const dirs = [];
  for (let k = 0; k < SAMPLES; k++) {
    // Cosine-weighted hemisphere (Fibonacci), around +Z.
    const u = (k + 0.5) / SAMPLES;
    const phi = k * 2.399963;
    const r = Math.sqrt(u);
    dirs.push([r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(1 - u)]);
  }
  let rays = 0;
  for (const [key, parts] of structures) {
    for (const part of parts) {
      const mesh = part.mesh;
      const n = vertexCount(mesh);
      const ao = new Float32Array(n).fill(1);
      if (OCCLUDER_MATERIALS.has(materialOf(key)) || materialOf(key) === undefined) {
        const N = mesh.attributes.normal.array;
        for (let i = 0; i < n; i++) {
          const nrm = [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]];
          const t = Math.abs(nrm[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
          const b1 = v3.norm(v3.cross(nrm, t));
          const b2 = v3.cross(nrm, b1);
          const origin = v3.add(v3.at(mesh.positions, i), v3.scale(nrm, 0.015));
          let occlusion = 0;
          for (const d of dirs) {
            const dir = [
              b1[0] * d[0] + b2[0] * d[1] + nrm[0] * d[2],
              b1[1] * d[0] + b2[1] * d[1] + nrm[1] * d[2],
              b1[2] * d[0] + b2[2] * d[1] + nrm[2] * d[2],
            ];
            const hit = caster.cast(origin, dir, FAR);
            if (hit < FAR) occlusion += 1 - hit / FAR;
            rays++;
          }
          ao[i] = 1 - Math.min(occlusion / SAMPLES, 1) * 0.95;
        }
      }
      mesh.attributes.ao = { size: 1, array: ao };
    }
  }
  log(`ambient occlusion baked (${(rays / 1e6).toFixed(1)} M rays)`);
}

// ---------------------------------------------------------------------------
// Epicardium shell (derived from the outer surface of the walls)
// ---------------------------------------------------------------------------
const FAT_THICKNESS = 0.16; // cm at full amount (real grooves: 1.0-1.4 cm)
function buildEpicardium(partsByKey) {
  const shells = [];
  for (const key of SPLIT_KEYS) {
    for (const part of partsByKey.get(key) ?? []) {
      const mesh = part.mesh;
      const endo = mesh.attributes.endo.array;
      const indices = [];
      for (let t = 0; t < mesh.indices.length; t += 3) {
        const a = mesh.indices[t];
        const b = mesh.indices[t + 1];
        const c = mesh.indices[t + 2];
        if (endo[a] < 0.5 && endo[b] < 0.5 && endo[c] < 0.5) indices.push(a, b, c);
      }
      if (!indices.length) continue;
      const shell = compact(createMesh(mesh.positions, Uint32Array.from(indices), mesh.attributes));
      const P = shell.positions;
      const N = shell.attributes.normal.array;
      const fat = shell.attributes.fat?.array;
      const nearVessel = shell.attributes.nearVessel?.array;
      const ao = shell.attributes.ao?.array;
      for (let i = 0; i < vertexCount(shell); i++) {
        // Fat as volume: thicker where there is more of it, in rounded lobules.
        const amount = fat ? fat[i] : 0;
        const lobe = amount > 0.02 ? lobules(v3.at(P, i), 0.3, 3) : 1;
        // The vessels lie in the fat: it rises around them, not over them.
        const bed = nearVessel ? smoothstep(0.03, 0.22, nearVessel[i]) : 1;
        const offset = 0.02 + amount * FAT_THICKNESS * (0.55 + 0.45 * lobe) * bed;
        P[i * 3] += N[i * 3] * offset;
        P[i * 3 + 1] += N[i * 3 + 1] * offset;
        P[i * 3 + 2] += N[i * 3 + 2] * offset;
        if (ao) ao[i] *= 1 - 0.35 * amount * (1 - lobe); // shade the clefts between lobules
      }
      shell.attributes.normal = { size: 3, array: computeNormals(shell) };
      shells.push({ key: 'epicardium', name: `epicardium_${key}${shells.length}`, mesh: shell });
    }
  }
  return shells;
}

// ---------------------------------------------------------------------------
// 7. Blend shapes (cardiac cycle + valves + arterial distension)
// ---------------------------------------------------------------------------
function withNormalsOf(mesh, positions) {
  return computeNormals(createMesh(positions, mesh.indices));
}

function buildTargets(part) {
  const mesh = part.mesh;
  const n = vertexCount(mesh);
  const P = mesh.positions;
  const baseNormals = mesh.attributes.normal.array;
  const targets = [];
  const addTarget = (name, displacement) => {
    const deformed = new Float64Array(P.length);
    for (let i = 0; i < P.length; i++) deformed[i] = P[i] + displacement[i];
    const normals = withNormalsOf(mesh, deformed);
    const dn = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) dn[i] = normals[i] - baseNormals[i];
    targets.push({ name, position: Float32Array.from(displacement), normal: dn });
  };
  const out = [0, 0, 0];
  const ventricular = new Float64Array(n * 3);
  const atrial = new Float64Array(n * 3);
  // Valves move with their annulus (rigidly), not with the contracting
  // cavity; chordae blend from the leaflet (free edge) to the papillary
  // muscle they are anchored to.
  const leaflet = part.valveKey ? valveInfo.leaflets[part.valveKey] : null;
  const slValve = part.valveKey && !leaflet ? valveInfo.valves[STRUCTURES[part.valveKey].valve.valve] : null;
  const s = mesh.attributes.valveS?.array;
  const fieldAt = (p, target) => {
    const v = field.ventricularSystole(p, [0, 0, 0]);
    const a = field.atrialSystole(p, [0, 0, 0]);
    target.v = v;
    target.a = a;
    return target;
  };
  const self = {};
  const anchor = {};
  if (slValve) fieldAt(slValve.center, anchor);
  for (let i = 0; i < n; i++) {
    const p = v3.at(P, i);
    fieldAt(p, self);
    let v = self.v;
    let a = self.a;
    if (slValve) {
      v = anchor.v;
      a = anchor.a;
    } else if (leaflet) {
      fieldAt(hingePointFor(leaflet, p), anchor);
      const w = s ? smoothstep(EDGE_S, 1.0, s[i]) : 0;
      v = v3.lerp(anchor.v, self.v, w);
      a = v3.lerp(anchor.a, self.a, w);
    }
    ventricular.set(v, i * 3);
    atrial.set(a, i * 3);
  }
  void out;
  addTarget('ventricularSystole', ventricular);
  addTarget('atrialSystole', atrial);

  if (part.valveKey) {
    const s = mesh.attributes.valveS?.array;
    for (const [name, amount] of [
      ['valveHalf', 0.5],
      ['valveOpen', 1],
    ]) {
      const d = new Float64Array(n * 3);
      for (let i = 0; i < n; i++) d.set(valveOpening(part.valveKey, v3.at(P, i), s ? s[i] : 0, amount), i * 3);
      addTarget(name, d);
    }
  }
  const material = materialOf(part.key);
  if (material === 'greatArtery' || material === 'pulmonaryArtery') {
    const d = vessels.distension(part, 0.07);
    addTarget('arterialDistension', d);
  }
  return targets;
}

// ---------------------------------------------------------------------------
// 8. Levels of detail + export
// ---------------------------------------------------------------------------
const SUBDIVIDE_EDGE = 0.085; // cm: parts with longer mean edges get subdivided
function detailLevel(partsByKey) {
  const out = new Map();
  for (const [key, parts] of partsByKey) {
    out.set(
      key,
      parts.map((part) => {
        let mesh = part.mesh;
        const edge = meanEdgeLength(mesh);
        const material = materialOf(key);
        let levels = edge > SUBDIVIDE_EDGE ? 1 : 0;
        if (edge > SUBDIVIDE_EDGE * 2.4 && ['greatArtery', 'greatVein', 'pulmonaryArtery', 'pulmonaryVein'].includes(material)) levels = 2;
        if (material === 'bloodOxy' || material === 'bloodDeoxy') levels = Math.min(levels, 1);
        for (let l = 0; l < levels; l++) mesh = loopSubdivide(mesh);
        if (levels) {
          mesh.attributes.normal = { size: 3, array: computeNormals(mesh) };
        }
        return { ...part, mesh };
      }),
    );
  }
  return out;
}

function finalize(partsByKey, label) {
  const withShell = new Map(partsByKey);
  withShell.set('epicardium', buildEpicardium(partsByKey));
  const nodes = [];
  let vertices = 0;
  for (const [key, parts] of withShell) {
    for (const part of parts) {
      const mesh = part.mesh;
      const n = vertexCount(mesh);
      vertices += n;
      const tissue = new Uint8Array(n * 4);
      const endo = mesh.attributes.endo?.array;
      const fat = mesh.attributes.fat?.array;
      const act = conduction.activationFor(key, mesh);
      const ao = mesh.attributes.ao?.array;
      for (let i = 0; i < n; i++) {
        tissue[i * 4] = Math.round((endo ? endo[i] : 0) * 255);
        tissue[i * 4 + 1] = Math.round((fat ? fat[i] : 0) * 255);
        tissue[i * 4 + 2] = act ? act[i] : 255;
        tissue[i * 4 + 3] = Math.round((ao ? ao[i] : 1) * 255);
      }
      nodes.push({
        name: part.name,
        key,
        positions: Float32Array.from(mesh.positions),
        normals: Float32Array.from(mesh.attributes.normal.array),
        indices: mesh.indices,
        tissue,
        targets: buildTargets(part),
      });
    }
  }
  log(`${label}: ${nodes.length} meshes, ${vertices.toLocaleString()} vertices`);
  return nodes;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const baseNodes = finalize(structures, 'base level');
await writeGlb(path.join(OUT_DIR, 'heart-base.glb'), baseNodes, { level: 'base' });
log('wrote heart-base.glb', (fs.statSync(path.join(OUT_DIR, 'heart-base.glb')).size / 1e6).toFixed(2), 'MB');

if (!QUICK) {
  const detailNodes = finalize(detailLevel(structures), 'detail level');
  await writeGlb(path.join(OUT_DIR, 'heart-detail.glb'), detailNodes, { level: 'detail' });
  log('wrote heart-detail.glb', (fs.statSync(path.join(OUT_DIR, 'heart-detail.glb')).size / 1e6).toFixed(2), 'MB');
}

// ---------------------------------------------------------------------------
// Data file
// ---------------------------------------------------------------------------
const round = (value) =>
  Array.isArray(value) ? value.map(round) : typeof value === 'number' ? Math.round(value * 1e4) / 1e4 : value;
const data = {
  generator: 'tools/model-build/build.mjs',
  source: 'BodyParts3D, (c) The Database Center for Life Science, CC BY 4.0 (see docs/MODEL_LICENSE.md)',
  units: 'cm',
  frame: 'x = patient left, y = superior, z = anterior; origin = centre of the four cardiac cavities',
  originBodyParts3D_mm: round(ORIGIN_MM),
  frames: round(frames),
  valves: Object.fromEntries(
    Object.entries(valveInfo.valves).map(([k, v]) => [k, { kind: v.kind, center: round(v.center), flow: round(v.flow), radius: round(v.radius ?? 1.2) }]),
  ),
  anchors: computeAnchors(),
  vessels: vessels.data,
  conduction: conduction.data,
};
fs.writeFileSync(path.join(OUT_DIR, 'heart-data.json'), JSON.stringify(data));
log('wrote heart-data.json', (fs.statSync(path.join(OUT_DIR, 'heart-data.json')).size / 1e3).toFixed(0), 'kB');

// ---------------------------------------------------------------------------
// Label anchors: a representative point (and outward normal) per structure.
// ---------------------------------------------------------------------------
function computeAnchors() {
  const anchors = {};
  const heartCenter = [0, 0, 0];
  const INTERIOR = new Set(['interior', 'valves', 'chambers']);
  for (const [key, parts] of structures) {
    const all = mergeMeshes(parts.map((p) => stripAttributes(p.mesh)));
    const normals = computeNormals(all);
    const c = centroid(all.positions);
    const size = Math.max(...pca(all.positions).values.map((v) => Math.sqrt(v))) * 2 + 0.1;
    const interior = INTERIOR.has(STRUCTURES[key]?.layer) || key === 'ivs' || key === 'ias';
    const outward = v3.norm(v3.sub(c, heartCenter));
    let best = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < vertexCount(all); i++) {
      const p = v3.at(all.positions, i);
      const nrm = v3.at(normals, i);
      const closeness = -v3.dist(p, c) / size;
      const score = interior ? closeness : v3.dot(nrm, outward) * 0.8 + closeness;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    anchors[key] = { point: round(v3.at(all.positions, best)), normal: round(interior ? outward : v3.at(normals, best)), interior };
  }
  for (const [key, anchor] of Object.entries(conduction.anchors)) anchors[key] = { ...anchor, interior: true };
  return anchors;
}

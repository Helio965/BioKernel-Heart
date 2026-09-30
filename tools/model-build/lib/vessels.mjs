/**
 * Vessel centre lines, coronary trees and blood-flow circuits.
 *
 * Everything is measured on the BodyParts3D meshes (app frame, cm): the tree
 * connectivity comes from which vessel piece touches which, and the flow
 * circuits follow the real sequence of chambers, valves and great vessels.
 */
import { v3, centroid, traceCenterline, resamplePolyline, PointGrid } from './geom.mjs';
import { vertexCount } from './mesh.mjs';

const CORONARY = new Set(['artery', 'vein']);
const GREAT = new Set(['greatArtery', 'greatVein', 'pulmonaryArtery', 'pulmonaryVein']);

export function deriveVessels({ STRUCTURES, structures, piece, cavities, valveInfo, chambers, log }) {
  const centerlines = new Map(); // fileId -> [{p, r}]
  const pieceKey = new Map();
  for (const [key, structure] of Object.entries(STRUCTURES)) {
    if (!structure.sources || !(CORONARY.has(structure.material) || GREAT.has(structure.material))) continue;
    for (const id of structure.sources) {
      const mesh = piece(id);
      const raw = traceCenterline(mesh.positions);
      const spacing = CORONARY.has(structure.material) ? 0.1 : 0.25;
      let line = resamplePolyline(raw, spacing, 3);
      if (line.length < 2) line = fallbackLine(mesh.positions);
      centerlines.set(id, line);
      pieceKey.set(id, key);
    }
  }
  log(`centre lines traced for ${centerlines.size} vessel pieces`);

  const nearestOnLine = (line, p) => {
    let best = 0;
    let bestD = Infinity;
    line.forEach((q, i) => {
      const d = v3.dist(q.p, p);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return { index: best, distance: bestD };
  };
  const orientFrom = (line, reference) =>
    v3.dist(line[0].p, reference) <= v3.dist(line[line.length - 1].p, reference) ? line : line.slice().reverse();
  const orientAway = (line, cavity) =>
    cavity.distance(line[0].p) >= cavity.distance(line[line.length - 1].p) ? line : line.slice().reverse();

  // -------------------------------------------------------------------------
  // Coronary trees (Prim-like growth from the roots)
  // -------------------------------------------------------------------------
  function growTree(ids, roots, { maxAttach = 0.7, orientRoot }) {
    const nodes = [];
    const attached = new Map();
    for (const id of roots) {
      const line = orientRoot(centerlines.get(id), id);
      const node = { id, key: pieceKey.get(id), line, parent: -1, parentIndex: 0 };
      attached.set(id, nodes.length);
      nodes.push(node);
    }
    const pending = new Set(ids.filter((id) => !attached.has(id)));
    while (pending.size) {
      let best = null;
      for (const id of pending) {
        const line = centerlines.get(id);
        for (const [endIndex, end] of [
          [0, line[0].p],
          [line.length - 1, line[line.length - 1].p],
        ]) {
          nodes.forEach((node, n) => {
            const hit = nearestOnLine(node.line, end);
            if (!best || hit.distance < best.distance) best = { id, endIndex, parent: n, parentIndex: hit.index, distance: hit.distance };
          });
        }
      }
      if (!best) break;
      pending.delete(best.id);
      const line = centerlines.get(best.id);
      const oriented = best.endIndex === 0 ? line : line.slice().reverse();
      if (best.distance > maxAttach) {
        // Separate tree (e.g. anterior cardiac veins draining into the RA).
        const root = orientRoot(line, best.id);
        nodes.push({ id: best.id, key: pieceKey.get(best.id), line: root, parent: -1, parentIndex: 0, detached: true });
      } else {
        nodes.push({ id: best.id, key: pieceKey.get(best.id), line: oriented, parent: best.parent, parentIndex: best.parentIndex });
      }
      attached.set(best.id, nodes.length - 1);
    }
    return nodes;
  }

  const aorticValve = valveInfo.valves.aortic.center;
  const arteryIds = [];
  const veinIds = [];
  for (const [id, key] of pieceKey) {
    if (STRUCTURES[key].material === 'artery') arteryIds.push(id);
    if (STRUCTURES[key].material === 'vein') veinIds.push(id);
  }
  const arteries = growTree(arteryIds, ['FJ2737', 'FJ2723'], {
    maxAttach: 0.8,
    orientRoot: (line) => orientFrom(line, aorticValve),
  });
  // Venous tree: proximal end = the end nearest to the right atrium.
  const veins = growTree(veinIds, ['FJ2655'], {
    maxAttach: 0.6,
    orientRoot: (line) => (cavities.ra.distance(line[0].p) <= cavities.ra.distance(line[line.length - 1].p) ? line : line.slice().reverse()),
  });
  log(`coronary arteries: ${arteries.length} pieces; cardiac veins: ${veins.length} pieces (${veins.filter((n) => n.parent < 0).length} roots)`);

  // -------------------------------------------------------------------------
  // Great vessels
  // -------------------------------------------------------------------------
  const lineOf = (key) => {
    const ids = STRUCTURES[key].sources;
    if (ids.length === 1) return centerlines.get(ids[0]);
    // Several pieces (pulmonary veins): keep the longest chain towards the LA.
    const lines = ids.map((id) => centerlines.get(id));
    return lines.reduce((a, b) => (a.length >= b.length ? a : b));
  };
  const lastOf = (line) => line[line.length - 1].p;
  const pulmonaryValve = valveInfo.valves.pulmonary.center;

  const ascending = orientFrom(lineOf('ascendingAorta'), aorticValve);
  const arch = orientFrom(lineOf('aorticArch'), lastOf(ascending));
  const descending = orientFrom(lineOf('descendingAorta'), lastOf(arch));
  const branch = (key) => {
    const raw = lineOf(key);
    const a = nearestOnLine(arch, raw[0].p);
    const b = nearestOnLine(arch, raw[raw.length - 1].p);
    const line = a.distance <= b.distance ? raw : raw.slice().reverse();
    return { line, archIndex: Math.min(a.distance <= b.distance ? a.index : b.index, arch.length - 1) };
  };
  const trunk = orientFrom(lineOf('pulmonaryTrunk'), pulmonaryValve);
  const rpa = orientFrom(lineOf('rightPulmonaryArtery'), lastOf(trunk));
  const lpa = orientFrom(lineOf('leftPulmonaryArtery'), lastOf(trunk));
  const svc = orientAway(lineOf('superiorVenaCava'), cavities.ra);
  const ivc = orientAway(lineOf('inferiorVenaCava'), cavities.ra);
  const cs = veins.find((n) => n.id === 'FJ2655').line.slice().reverse(); // towards the ostium
  const pulmonaryVeins = ['rightSuperiorPulmonaryVein', 'rightInferiorPulmonaryVein', 'leftSuperiorPulmonaryVein', 'leftInferiorPulmonaryVein'].map(
    (key) => ({ key, line: orientAway(lineOf(key), cavities.la) }),
  );

  // Chamber way-points.
  const valves = valveInfo.valves;
  const farthestVertex = (id, from) => {
    const P = piece(id).positions;
    let best = null;
    let bestD = -1;
    for (let i = 0; i < P.length / 3; i++) {
      const p = v3.at(P, i);
      const d = v3.dist(p, from);
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  };
  const rvApex = farthestVertex('FJ2423', valves.tricuspid.center);
  const lvApex = farthestVertex('FJ2422', valves.mitral.center);
  const raCenter = centroid(piece('FJ2424').positions);
  const laCenter = centroid(piece('FJ2425').positions);

  const P = (p, r, region) => ({ p, r, region });
  const rightChamber = [
    P(raCenter, 1.1, 'atrium'),
    P(v3.sub(valves.tricuspid.center, v3.scale(valves.tricuspid.flow, 0.45)), 0.9, 'atrium'),
    P(valves.tricuspid.center, 0.85, 'avValve'),
    P(v3.add(valves.tricuspid.center, v3.scale(valves.tricuspid.flow, 0.9)), 0.9, 'ventricle'),
    P(v3.lerp(valves.tricuspid.center, rvApex, 0.62), 0.8, 'ventricle'),
    P(v3.sub(valves.pulmonary.center, v3.scale(valves.pulmonary.flow, 1.4)), 0.7, 'ventricle'),
    P(valves.pulmonary.center, 0.65, 'slValve'),
  ];
  const leftChamber = [
    P(laCenter, 1.1, 'atrium'),
    P(v3.sub(valves.mitral.center, v3.scale(valves.mitral.flow, 0.45)), 0.9, 'atrium'),
    P(valves.mitral.center, 0.85, 'avValve'),
    P(v3.add(valves.mitral.center, v3.scale(valves.mitral.flow, 0.9)), 0.9, 'ventricle'),
    P(v3.lerp(valves.mitral.center, lvApex, 0.62), 0.8, 'ventricle'),
    P(v3.sub(valves.aortic.center, v3.scale(valves.aortic.flow, 1.3)), 0.7, 'ventricle'),
    P(valves.aortic.center, 0.65, 'slValve'),
  ];

  const tag = (line, region, scale = 0.72) => line.map((q) => P(q.p, q.r * scale, region));
  const pack = (points) => ({
    points: points.flatMap((q) => q.p.map((v) => Math.round(v * 1000) / 1000)),
    radius: points.map((q) => Math.round(q.r * 1000) / 1000),
    region: points.map((q) => REGION_CODES[q.region]),
  });

  const archUpTo = (index) => arch.slice(0, index + 1);
  const outflowsLeft = [
    { key: 'brachiocephalicTrunk', ...branch('brachiocephalicTrunk') },
    { key: 'leftCommonCarotid', ...branch('leftCommonCarotid') },
    { key: 'leftSubclavian', ...branch('leftSubclavian') },
  ].map(({ key, line, archIndex }) => ({
    key,
    ...pack([...tag(ascending, 'artery'), ...tag(archUpTo(archIndex), 'artery'), ...tag(line, 'artery')]),
  }));
  outflowsLeft.push({ key: 'descendingAorta', ...pack([...tag(ascending, 'artery'), ...tag(arch, 'artery'), ...tag(descending, 'artery')]) });

  const circuits = {
    right: {
      blood: 'deoxygenated',
      inflows: [
        { key: 'superiorVenaCava', ...pack(tag(svc, 'vein')) },
        { key: 'inferiorVenaCava', ...pack(tag(ivc, 'vein')) },
        { key: 'coronarySinus', ...pack(tag(cs, 'vein', 0.6)) },
      ],
      chamber: pack(rightChamber),
      outflows: [
        { key: 'rightPulmonaryArtery', ...pack([...tag(trunk, 'artery'), ...tag(rpa, 'artery')]) },
        { key: 'leftPulmonaryArtery', ...pack([...tag(trunk, 'artery'), ...tag(lpa, 'artery')]) },
      ],
    },
    left: {
      blood: 'oxygenated',
      inflows: pulmonaryVeins.map(({ key, line }) => ({ key, ...pack(tag(line, 'vein')) })),
      chamber: pack(leftChamber),
      outflows: outflowsLeft,
    },
  };

  // Coronary trees for the coronary-flow layer.
  const packTree = (nodes) =>
    nodes.map((n) => ({
      key: n.key,
      parent: n.parent,
      parentIndex: n.parentIndex,
      ...pack(n.line.map((q) => P(q.p, q.r, 'artery'))),
    }));

  // Arterial distension: radial displacement from the vessel's centre line.
  const distensionWeight = {
    ascendingAorta: 1,
    pulmonaryTrunk: 1,
    aorticArch: 0.75,
    rightPulmonaryArtery: 0.7,
    leftPulmonaryArtery: 0.7,
    brachiocephalicTrunk: 0.45,
    leftCommonCarotid: 0.4,
    leftSubclavian: 0.4,
    descendingAorta: 0.55,
  };
  const lineGrids = new Map();
  function distension(part, amount) {
    const mesh = part.mesh;
    const n = vertexCount(mesh);
    const out = new Float64Array(n * 3);
    const key = part.key;
    const ids = STRUCTURES[key].sources;
    let grid = lineGrids.get(key);
    if (!grid) {
      const pts = ids.flatMap((id) => centerlines.get(id));
      const flat = new Float64Array(pts.length * 3);
      pts.forEach((q, i) => flat.set(q.p, i * 3));
      grid = new PointGrid(flat, 0.5);
      lineGrids.set(key, grid);
    }
    const w = (distensionWeight[key] ?? 0.5) * amount;
    for (let i = 0; i < n; i++) {
      const p = v3.at(mesh.positions, i);
      const { index } = grid.nearest(p, 5);
      if (index < 0) continue;
      const c = v3.at(grid.positions, index);
      const d = v3.sub(p, c);
      out[i * 3] = d[0] * w;
      out[i * 3 + 1] = d[1] * w;
      out[i * 3 + 2] = d[2] * w;
    }
    return out;
  }

  const data = {
    regionCodes: REGION_CODES,
    circuits,
    coronary: { arteries: packTree(arteries), veins: packTree(veins) },
    waypoints: {
      raCenter,
      laCenter,
      rvApex,
      lvApex,
    },
  };
  return { data, distension, centerlines, arteries, veins, trunk, ascending, svc, ivc, cs };
}

export const REGION_CODES = { vein: 0, atrium: 1, avValve: 2, ventricle: 3, slValve: 4, artery: 5 };

function fallbackLine(positions) {
  const c = centroid(positions);
  return [
    { p: c, r: 0.1 },
    { p: v3.add(c, [0.01, 0, 0]), r: 0.1 },
  ];
}

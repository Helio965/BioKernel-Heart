/**
 * Cardiac conduction system (schematic) and activation times.
 *
 * The conduction system is not visible macroscopically and is not part of
 * BodyParts3D, so it is placed from anatomical landmarks of the model:
 *   - SA node: RA wall at the SVC junction (superior/posterior RA wall);
 *   - internodal pathways (anterior, middle, posterior) and Bachmann bundle;
 *   - AV node: Koch triangle, between the coronary sinus ostium and the
 *     septal leaflet of the tricuspid valve;
 *   - His bundle: AV node -> crest of the muscular septum under the aortic valve;
 *   - left bundle branch (anterior/posterior fascicles) on the LV septal surface,
 *     right bundle branch to the anterior papillary muscle (moderator band);
 *   - Purkinje network on the ventricular endocardium.
 * Paths run on the endocardial surface (shortest paths on the mesh).
 *
 * Timings follow OpenStax Anatomy & Physiology 2e, 19.2: ~50 ms SA -> AV node,
 * ~100 ms AV delay, ~25 ms along the bundle branches to the apex, ~75 ms for
 * the Purkinje fibres to reach all the ventricular muscle.
 */
import { v3, centroid, PointGrid } from './geom.mjs';
import { vertexCount, adjacency, dijkstra, mergeMeshes, createMesh, weld } from './mesh.mjs';
import { buildBVH } from './bvh.mjs';
import { mulberry32 } from './random.mjs';

const TIMING = {
  saToAv: 50, // ms (P-referenced)
  hisStart: -40, // ms (Q-referenced; HV interval ~35-55 ms)
  hisEnd: -25,
  branchToApex: 25,
  purkinjeSpread: 75,
  atrialVelocity: 0.1, // cm/ms (≈1 m/s)
  bachmannVelocity: 0.17,
  myocardialVelocity: 0.05, // cm/ms (≈0.5 m/s)
};

export function deriveConduction({ structures, piece, cavities, valveInfo, vessels, chambers, field, log }) {
  const random = mulberry32(2718);

  // -------------------------------------------------------------------------
  // Atrial graph: RA + LA walls, bridged where the meshes touch.
  // -------------------------------------------------------------------------
  const raWall = piece('FJ2439');
  const laWall = piece('FJ2438');
  const atria = graphFromMeshes([raWall, laWall], 0.22);
  const atrialEndo = new Uint8Array(atria.n);
  const atrialSide = new Int8Array(atria.n); // 0 = RA, 1 = LA
  for (let i = 0; i < atria.n; i++) {
    const p = v3.at(atria.positions, i);
    const dRA = cavities.ra.distance(p);
    const dLA = cavities.la.distance(p);
    atrialEndo[i] = Math.min(dRA, dLA) < 0.15 ? 1 : 0;
    atrialSide[i] = dLA < dRA ? 1 : 0;
  }
  const raEndoGrid = gridOf(atria.positions, (i) => atrialEndo[i] && atrialSide[i] === 0);
  const laEndoGrid = gridOf(atria.positions, (i) => atrialEndo[i] && atrialSide[i] === 1);
  const raEpiGrid = gridOf(atria.positions, (i) => !atrialEndo[i] && atrialSide[i] === 0);

  // Landmarks.
  const svcJunction = vessels.svc[vessels.svc.length - 1].p;
  const csOstium = vessels.cs[vessels.cs.length - 1].p;
  const septalHinge = valveInfo.leaflets.tricuspidSeptal.hingeCenter;
  const aortic = valveInfo.valves.aortic;

  // SA node: epicardial RA wall next to the SVC orifice, favouring the
  // superior-posterior-lateral side (sulcus terminalis).
  const saCandidates = raEpiGrid.radius(svcJunction, 1.8);
  let saIndex = saCandidates[0];
  let saScore = -Infinity;
  for (const i of saCandidates) {
    const p = v3.at(atria.positions, i);
    const score = -p[0] * 1.0 - p[2] * 0.45 + p[1] * 0.35 - v3.dist(p, svcJunction) * 0.6;
    if (score > saScore) {
      saScore = score;
      saIndex = i;
    }
  }
  const saPoint = v3.at(atria.positions, saIndex);
  const saEndo = raEndoGrid.nearest(saPoint).index;

  // AV node: Koch triangle, between the CS ostium and the septal leaflet hinge.
  const avGuess = v3.lerp(csOstium, septalHinge, 0.55);
  const avIndex = raEndoGrid.nearest(avGuess).index;
  const avPoint = v3.at(atria.positions, avIndex);

  // Atrial way-points for the three internodal pathways and Bachmann bundle.
  const raCenter = centroid(piece('FJ2424').positions);
  const laCenter = centroid(piece('FJ2425').positions);
  const septumMid = v3.lerp(raCenter, laCenter, 0.5);
  const anteriorVia = raEndoGrid.nearest(v3.add(v3.lerp(saPoint, septumMid, 0.6), [0, 0.6, 1.0])).index;
  const middleVia = raEndoGrid.nearest(v3.add(septumMid, [0, 0.2, 0])).index;
  const posteriorVia = raEndoGrid.nearest(v3.add(v3.lerp(saPoint, vessels.ivc[vessels.ivc.length - 1].p, 0.55), [-0.6, 0, -0.4])).index;
  const laAnterior = laEndoGrid.nearest(v3.add(laCenter, [0.6, 0.8, 1.6])).index;

  const atrialAllowed = (grid) => {
    const mask = new Uint8Array(atria.n);
    for (let i = 0; i < atria.n; i++) mask[i] = atrialEndo[i];
    return mask;
  };
  const endoMask = atrialAllowed();
  const route = (from, via, to) => [...shortestPath(atria, from, via, endoMask), ...shortestPath(atria, via, to, endoMask).slice(1)];
  const internodal = [
    route(saEndo, anteriorVia, avIndex),
    route(saEndo, middleVia, avIndex),
    route(saEndo, posteriorVia, avIndex),
  ];
  const bachmann = shortestPath(atria, saEndo, laAnterior, null);

  const paths = [];
  const pushPath = (key, name, indices, positions, times, ref, radius) => {
    const pts = indices.map((i) => v3.at(positions, i));
    paths.push({ key, name, ref, radius, points: pts, times });
  };
  for (const [k, path] of internodal.entries()) {
    const lengths = cumulative(path.map((i) => v3.at(atria.positions, i)));
    const total = lengths[lengths.length - 1];
    pushPath('internodalPathways', ['anterior', 'middle', 'posterior'][k], path, atria.positions, lengths.map((l) => (l / total) * TIMING.saToAv), 'P', 0.05);
  }
  {
    const lengths = cumulative(bachmann.map((i) => v3.at(atria.positions, i)));
    pushPath('internodalPathways', 'bachmann', bachmann, atria.positions, lengths.map((l) => l / TIMING.bachmannVelocity), 'P', 0.06);
  }

  // Atrial myocardium activation: from the SA node and the fast pathways.
  const atrialSources = [[saIndex, 0], [saEndo, 2]];
  for (const p of paths) {
    const indices = p.name === 'bachmann' ? bachmann : internodal[['anterior', 'middle', 'posterior'].indexOf(p.name)];
    indices.forEach((i, k) => atrialSources.push([i, p.times[k]]));
  }
  const atrialTime = dijkstra({ positions: atria.positions }, atria, atrialSources, {
    weight: () => 1 / TIMING.atrialVelocity,
  }).dist;
  log(`atrial activation: max ${Math.max(...Array.from(atrialTime).filter(Number.isFinite)).toFixed(0)} ms`);

  // -------------------------------------------------------------------------
  // Ventricular graph (unsplit "Wall of ventricle" + transmural edges).
  // -------------------------------------------------------------------------
  const ventricle = piece('FJ2428');
  const vn = vertexCount(ventricle);
  const vEndo = ventricle.attributes.endo.array;
  const side = new Int8Array(vn); // 0 = LV side, 1 = RV side
  for (let i = 0; i < vn; i++) {
    const p = v3.at(ventricle.positions, i);
    side[i] = cavities.lv.distance(p) <= cavities.rv.distance(p) ? 0 : 1;
  }
  const vAdj = adjacency(ventricle);
  const endoGrid = gridOf(ventricle.positions, (i) => vEndo[i] > 0.5);
  const lvEndoGrid = gridOf(ventricle.positions, (i) => vEndo[i] > 0.5 && side[i] === 0);
  const rvEndoGrid = gridOf(ventricle.positions, (i) => vEndo[i] > 0.5 && side[i] === 1);
  const transmural = [];
  for (let i = 0; i < vn; i++) {
    if (vEndo[i] > 0.5) continue;
    const hit = endoGrid.nearest(v3.at(ventricle.positions, i), 2.5);
    if (hit.index >= 0 && hit.distance < 2.2) transmural.push([i, hit.index]);
  }
  const vGraph = withExtraEdges(ventricle.positions, vAdj, transmural);

  const lvMask = new Uint8Array(vn);
  const rvMask = new Uint8Array(vn);
  for (let i = 0; i < vn; i++) {
    lvMask[i] = vEndo[i] > 0.5 && side[i] === 0 ? 1 : 0;
    rvMask[i] = vEndo[i] > 0.5 && side[i] === 1 ? 1 : 0;
  }

  // His bundle: AV node -> septal crest just below the aortic valve.
  const crestGuess = v3.sub(aortic.center, v3.scale(aortic.flow, 1.1));
  const hisLv = lvEndoGrid.nearest(crestGuess).index;
  const hisRv = rvEndoGrid.nearest(crestGuess).index;
  const hisEnd = v3.lerp(v3.at(ventricle.positions, hisLv), v3.at(ventricle.positions, hisRv), 0.5);
  const hisPoints = [avPoint, v3.lerp(avPoint, hisEnd, 0.35), v3.lerp(avPoint, hisEnd, 0.7), hisEnd].map((p, k, all) =>
    k === 0 || k === all.length - 1 ? p : v3.add(p, [0, -0.08 * Math.sin((k / (all.length - 1)) * Math.PI), 0]),
  );
  paths.push({
    key: 'hisBundle',
    name: 'his',
    ref: 'Q',
    radius: 0.07,
    points: hisPoints,
    times: hisPoints.map((_, k) => TIMING.hisStart + ((TIMING.hisEnd - TIMING.hisStart) * k) / (hisPoints.length - 1)),
  });

  // Targets for the fascicles / bundle branches.
  const pmBase = (id, fromValve) => {
    const P = piece(id).positions;
    let best = null;
    let bestD = -1;
    for (let i = 0; i < P.length / 3; i++) {
      const p = v3.at(P, i);
      const d = v3.dist(p, fromValve);
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  };
  const mitral = valveInfo.valves.mitral.center;
  const tricuspid = valveInfo.valves.tricuspid.center;
  const lvAnteriorTarget = lvEndoGrid.nearest(pmBase('FJ2418', mitral)).index;
  const lvPosteriorTarget = lvEndoGrid.nearest(pmBase('FJ2429', mitral)).index;
  const lvApexTarget = lvEndoGrid.nearest(field.apex).index;
  const rvTarget = rvEndoGrid.nearest(pmBase('FJ2419', tricuspid)).index;

  const branchPaths = [
    ['bundleBranches', 'left-anterior-fascicle', shortestPath(vGraph, hisLv, lvAnteriorTarget, lvMask)],
    ['bundleBranches', 'left-posterior-fascicle', shortestPath(vGraph, hisLv, lvPosteriorTarget, lvMask)],
    ['bundleBranches', 'left-septal', shortestPath(vGraph, hisLv, lvApexTarget, lvMask)],
    ['bundleBranches', 'right-bundle-branch', shortestPath(vGraph, hisRv, rvTarget, rvMask)],
  ];
  const ventricularSources = [];
  const longest = Math.max(...branchPaths.map(([, , path]) => pathLength(path.map((i) => v3.at(ventricle.positions, i)))));
  const branchVelocity = longest / (TIMING.branchToApex - TIMING.hisEnd + 0.0001);
  for (const [key, name, path] of branchPaths) {
    const pts = path.map((i) => v3.at(ventricle.positions, i));
    const lengths = cumulative(pts);
    const times = lengths.map((l) => TIMING.hisEnd + l / branchVelocity);
    paths.push({ key, name, ref: 'Q', radius: 0.055, points: pts, times });
    // The first centimetre of the branches is insulated from the septum.
    path.forEach((i, k) => {
      if (lengths[k] > 1.0) ventricularSources.push([i, times[k] + 6]);
    });
  }

  // Purkinje network: Poisson-like samples on the endocardium, grown as a
  // tree from the bundle branches.
  const purkinjeNodes = [];
  for (const [mask, grid] of [
    [lvMask, lvEndoGrid],
    [rvMask, rvEndoGrid],
  ]) {
    const candidates = [];
    for (let i = 0; i < vn; i++) {
      if (!mask[i]) continue;
      const h = field.height(v3.at(ventricle.positions, i));
      if (h < 0.82) candidates.push(i);
    }
    shuffle(candidates, random);
    const taken = new PointGrid(new Float64Array(0), 1); // placeholder
    const chosen = [];
    const spacing = 0.55;
    const chosenGrid = new Map();
    const cellKey = (p) => `${Math.floor(p[0] / spacing)},${Math.floor(p[1] / spacing)},${Math.floor(p[2] / spacing)}`;
    for (const i of candidates) {
      const p = v3.at(ventricle.positions, i);
      let ok = true;
      const [cx, cy, cz] = cellKey(p).split(',').map(Number);
      for (let dx = -1; dx <= 1 && ok; dx++) {
        for (let dy = -1; dy <= 1 && ok; dy++) {
          for (let dz = -1; dz <= 1 && ok; dz++) {
            for (const q of chosenGrid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
              if (v3.dist(p, q) < spacing) {
                ok = false;
                break;
              }
            }
          }
        }
      }
      if (!ok) continue;
      chosen.push(i);
      const key = cellKey(p);
      if (!chosenGrid.has(key)) chosenGrid.set(key, []);
      chosenGrid.get(key).push(p);
    }
    purkinjeNodes.push({ mask, grid, chosen });
    void taken;
  }

  // Grow from the branch paths (times known) with Prim's algorithm.
  const nodeTime = new Map();
  const connected = [];
  for (const p of paths) {
    if (p.key !== 'bundleBranches') continue;
    p.points.forEach((pt, k) => {
      const i = endoGrid.nearest(pt).index;
      nodeTime.set(i, p.times[k]);
      connected.push(i);
    });
  }
  const purkinjeSegments = [];
  const pending = new Set(purkinjeNodes.flatMap((g) => g.chosen));
  const maxLink = 1.35;
  const connGrid = new Map();
  const cell = 0.8;
  const ck = (p) => `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)},${Math.floor(p[2] / cell)}`;
  const addConnected = (i) => {
    const p = v3.at(ventricle.positions, i);
    const key = ck(p);
    if (!connGrid.has(key)) connGrid.set(key, []);
    connGrid.get(key).push(i);
  };
  connected.forEach(addConnected);
  let purkinjeVelocity = 0.3; // cm/ms, rescaled below to meet the 75 ms spread
  const links = [];
  let progress = true;
  while (pending.size && progress) {
    progress = false;
    for (const i of [...pending]) {
      const p = v3.at(ventricle.positions, i);
      const [cx, cy, cz] = ck(p).split(',').map(Number);
      let best = -1;
      let bestD = Infinity;
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          for (let dz = -2; dz <= 2; dz++) {
            for (const j of connGrid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
              if (side[j] !== side[i]) continue;
              const d = v3.dist(p, v3.at(ventricle.positions, j));
              if (d < bestD) {
                bestD = d;
                best = j;
              }
            }
          }
        }
      }
      if (best >= 0 && bestD < maxLink) {
        links.push([best, i, bestD]);
        nodeTime.set(i, (nodeTime.get(best) ?? 0) + bestD / purkinjeVelocity);
        pending.delete(i);
        addConnected(i);
        progress = true;
      }
    }
  }
  // Rescale Purkinje timing so the network spans ~75 ms after the branches.
  const purkinjeTimes = links.map(([, i]) => nodeTime.get(i));
  const maxPurkinje = Math.max(...purkinjeTimes, 1);
  const scale = (TIMING.purkinjeSpread - 10) / Math.max(maxPurkinje, 1);
  for (const [a, b] of links) {
    if (!nodeTime.has(b)) continue;
  }
  for (const [a, b, d] of links) {
    const ta = nodeTime.get(a);
    const tb = nodeTime.get(b);
    const mask = side[b] === 0 ? lvMask : rvMask;
    const grid = side[b] === 0 ? lvEndoGrid : rvEndoGrid;
    const pa = v3.at(ventricle.positions, a);
    const pb = v3.at(ventricle.positions, b);
    // Hug the surface: intermediate points snapped to the endocardium.
    const pts = [pa];
    for (const t of [0.33, 0.66]) pts.push(v3.at(ventricle.positions, grid.nearest(v3.lerp(pa, pb, t)).index));
    pts.push(pb);
    const t0 = Math.max(ta, 0) * scale + Math.min(ta, 0);
    const t1 = Math.max(tb, 0) * scale + Math.min(tb, 0);
    purkinjeSegments.push({ points: pts, times: pts.map((_, k) => t0 + ((t1 - t0) * k) / (pts.length - 1)) });
    ventricularSources.push([b, t1 + 3]);
    void mask;
    void d;
  }
  purkinjeVelocity *= 1 / scale;
  log(`purkinje: ${purkinjeSegments.length} segments, ${pending.size} unconnected samples`);

  const ventricularTime = dijkstra({ positions: ventricle.positions }, vGraph, ventricularSources, {
    weight: () => 1 / TIMING.myocardialVelocity,
  }).dist;
  const finiteMax = Math.max(...Array.from(ventricularTime).filter(Number.isFinite));
  log(`ventricular activation: max ${finiteMax.toFixed(0)} ms (QRS-referenced)`);

  // -------------------------------------------------------------------------
  // Activation lookup for any mesh (base or detail level).
  // -------------------------------------------------------------------------
  const atrialGrid = new PointGrid(atria.positions, 0.3);
  const ventricleGrid = new PointGrid(ventricle.positions, 0.3);
  const encodeAtrial = (t) => Math.max(0, Math.min(119, Math.round(t)));
  const encodeVentricular = (t) => 120 + Math.max(0, Math.min(134, Math.round(t)));
  const ATRIAL_KEYS = new Set(['laWall', 'raWall', 'ias']);
  const VENTRICULAR_KEYS = new Set(['lvWall', 'rvWall', 'ivs', 'pmRvAnterior', 'pmRvPosterior', 'pmRvSeptal', 'pmLvAnterolateral', 'pmLvLateral']);
  function activationFor(key, mesh) {
    const n = vertexCount(mesh);
    if (!ATRIAL_KEYS.has(key) && !VENTRICULAR_KEYS.has(key) && key !== 'epicardium') return null;
    const out = new Uint8Array(n).fill(255);
    for (let i = 0; i < n; i++) {
      const p = v3.at(mesh.positions, i);
      const a = ATRIAL_KEYS.has(key) || key === 'epicardium' ? atrialGrid.nearest(p, 2) : { index: -1, distance: Infinity };
      const v = VENTRICULAR_KEYS.has(key) || key === 'epicardium' ? ventricleGrid.nearest(p, 2) : { index: -1, distance: Infinity };
      if (a.index >= 0 && a.distance <= v.distance && Number.isFinite(atrialTime[a.index])) out[i] = encodeAtrial(atrialTime[a.index]);
      else if (v.index >= 0 && Number.isFinite(ventricularTime[v.index])) out[i] = encodeVentricular(ventricularTime[v.index] + (key.startsWith('pm') ? 4 : 0));
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Output (lifted slightly off the endocardium so it stays visible).
  // -------------------------------------------------------------------------
  const round = (x) => Math.round(x * 1000) / 1000;
  const packPath = (p) => ({
    key: p.key,
    name: p.name,
    ref: p.ref,
    radius: p.radius,
    points: p.points.flatMap((q) => q.map(round)),
    times: p.times.map((t) => Math.round(t * 10) / 10),
  });
  const data = {
    timing: TIMING,
    nodes: {
      saNode: { point: saPoint.map(round), radius: 0.32, ref: 'P', time: 0 },
      avNode: { point: avPoint.map(round), radius: 0.24, ref: 'P', time: TIMING.saToAv },
    },
    paths: paths.map(packPath),
    purkinje: purkinjeSegments.map((s) => ({
      points: s.points.flatMap((q) => q.map(round)),
      times: s.times.map((t) => Math.round(t * 10) / 10),
    })),
  };
  const midpoint = (p) => p.points[Math.floor(p.points.length / 2)];
  const anchors = {
    saNode: { point: saPoint.map(round), normal: v3.norm(saPoint).map(round) },
    avNode: { point: avPoint.map(round), normal: v3.norm(avPoint).map(round) },
    hisBundle: { point: midpoint(paths.find((p) => p.key === 'hisBundle')).map(round), normal: [0, 0, 1] },
    internodalPathways: { point: midpoint(paths.find((p) => p.name === 'bachmann')).map(round), normal: [0, 1, 0] },
    bundleBranches: { point: midpoint(paths.find((p) => p.name === 'left-septal')).map(round), normal: [1, 0, 0] },
    purkinje: {
      point: (purkinjeSegments.length ? purkinjeSegments[Math.floor(purkinjeSegments.length / 3)].points[0] : field.apex).map(round),
      normal: [0, -1, 0],
    },
  };
  return { data, anchors, activationFor };
}

// ---------------------------------------------------------------------------
// Graph helpers
// ---------------------------------------------------------------------------
function graphFromMeshes(meshes, bridgeRadius) {
  const merged = weld(mergeMeshes(meshes.map((m) => createMesh(m.positions, m.indices))), 1e-4);
  const adj = adjacency(merged);
  // Bridge vertices of different meshes that touch (e.g. LA/RA septum).
  const n = vertexCount(merged);
  const grid = new PointGrid(merged.positions, bridgeRadius);
  const extra = [];
  for (let i = 0; i < n; i++) {
    for (const j of grid.radius(v3.at(merged.positions, i), bridgeRadius)) if (j > i) extra.push([i, j]);
  }
  const graph = withExtraEdges(merged.positions, adj, extra);
  return { ...graph, positions: merged.positions };
}

function withExtraEdges(positions, adj, extra) {
  const n = adj.n ?? adj.start.length - 1;
  const lists = Array.from({ length: n }, (_, i) => Array.from(adj.neighbors.subarray(adj.start[i], adj.start[i + 1])));
  for (const [a, b] of extra) {
    lists[a].push(b);
    lists[b].push(a);
  }
  const start = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + lists[i].length;
  const neighbors = new Uint32Array(start[n]);
  for (let i = 0; i < n; i++) neighbors.set(lists[i], start[i]);
  return { start, neighbors, n, positions };
}

function shortestPath(graph, from, to, mask) {
  const allowed = mask ? Uint8Array.from(mask) : null;
  if (allowed) {
    allowed[from] = 1;
    allowed[to] = 1;
  }
  const { prev, dist } = dijkstra({ positions: graph.positions }, graph, [[from, 0]], { allowed });
  if (!Number.isFinite(dist[to])) {
    // Fall back to the unrestricted graph.
    if (mask) return shortestPath(graph, from, to, null);
    return [from, to];
  }
  const path = [];
  for (let i = to; i >= 0; i = prev[i]) {
    path.push(i);
    if (i === from) break;
  }
  return path.reverse();
}

function gridOf(positions, predicate) {
  const subset = [];
  for (let i = 0; i < positions.length / 3; i++) if (predicate(i)) subset.push(i);
  return new PointGrid(positions, 0.35, subset);
}

function cumulative(points) {
  const out = [0];
  for (let i = 1; i < points.length; i++) out.push(out[i - 1] + v3.dist(points[i - 1], points[i]));
  return out;
}

function pathLength(points) {
  const c = cumulative(points);
  return c[c.length - 1];
}

function shuffle(array, random) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

export { buildBVH };

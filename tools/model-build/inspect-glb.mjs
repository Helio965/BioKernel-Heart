#!/usr/bin/env node
/**
 * Debug helper: prints, for the given nodes of a built GLB, the rest pose and
 * the pose at full weight of each blend shape, measured in the valve frame
 * (radius from the valve axis, height along it).
 *
 *   node inspect-glb.mjs ../../assets/models/heart-base.glb aorticRight mitralAnterior
 */
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const [file, ...names] = process.argv.slice(2);
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(file);
const data = JSON.parse(fs.readFileSync(new URL('../../assets/models/heart-data.json', import.meta.url)));

function worldPositions(node, accessor, isDelta) {
  const m = node.getWorldMatrix();
  const out = [];
  const el = [];
  for (let i = 0; i < accessor.getCount(); i++) {
    accessor.getElement(i, el);
    const [x, y, z] = el;
    if (isDelta) out.push([m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z]);
    else out.push([m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]);
  }
  return out;
}

for (const node of doc.getRoot().listNodes()) {
  if (!names.includes(node.getName())) continue;
  const prim = node.getMesh().listPrimitives()[0];
  const rest = worldPositions(node, prim.getAttribute('POSITION'), false);
  const targetNames = node.getMesh().getExtras().targetNames;
  const valveName = /^aortic/.test(node.getName()) ? 'aortic' : /^pulmonary/.test(node.getName()) ? 'pulmonary' : /^mitral/.test(node.getName()) ? 'mitral' : 'tricuspid';
  const valve = data.valves[valveName];
  const stats = (points) => {
    let rMin = Infinity, rMax = -Infinity, rSum = 0, hMin = Infinity, hMax = -Infinity;
    for (const p of points) {
      const q = [p[0] - valve.center[0], p[1] - valve.center[1], p[2] - valve.center[2]];
      const h = q[0] * valve.flow[0] + q[1] * valve.flow[1] + q[2] * valve.flow[2];
      const r = Math.sqrt(Math.max(q[0] ** 2 + q[1] ** 2 + q[2] ** 2 - h * h, 0));
      rMin = Math.min(rMin, r); rMax = Math.max(rMax, r); rSum += r; hMin = Math.min(hMin, h); hMax = Math.max(hMax, h);
    }
    return `r ${rMin.toFixed(2)}..${rMax.toFixed(2)} (mean ${(rSum / points.length).toFixed(2)})  h ${hMin.toFixed(2)}..${hMax.toFixed(2)}`;
  };
  console.log(`${node.getName()} [${valveName}] rest: ${stats(rest)}`);
  prim.listTargets().forEach((target, k) => {
    const d = worldPositions(node, target.getAttribute('POSITION'), true);
    const moved = rest.map((p, i) => [p[0] + d[i][0], p[1] + d[i][1], p[2] + d[i][2]]);
    const maxDelta = Math.max(...d.map((v) => Math.hypot(...v)));
    console.log(`   ${targetNames[k].padEnd(20)} ${stats(moved)}  max |d| ${maxDelta.toFixed(2)}`);
  });
}

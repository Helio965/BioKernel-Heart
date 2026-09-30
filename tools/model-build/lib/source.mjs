/**
 * Loads the BodyParts3D meshes listed in js/anatomy.js, applies the clipping
 * planes of each structure and cleans the geometry.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openZip } from './zip.mjs';
import { parseObj, weld, clipAxis, taubinSmooth, adjacency, vertexCount, compact } from './mesh.mjs';

export const ARCHIVE_URL = 'https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/isa_BP3D_4.0_obj_99.zip';
export const ARCHIVE_NAME = 'isa_BP3D_4.0_obj_99.zip';
const ENTRY_PREFIX = 'isa_BP3D_4.0_obj_99/';

/** Downloads the archive once (curl resumes interrupted transfers). */
export function ensureArchive(cacheDir, override) {
  if (override) return override;
  fs.mkdirSync(cacheDir, { recursive: true });
  const target = path.join(cacheDir, ARCHIVE_NAME);
  const expected = 142903898;
  if (fs.existsSync(target) && fs.statSync(target).size === expected) return target;
  console.log(`Downloading ${ARCHIVE_URL} (143 MB, BodyParts3D, CC BY 4.0)...`);
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      execFileSync('curl', ['-sS', '-L', '-C', '-', '-o', target, ARCHIVE_URL], { stdio: 'inherit' });
      if (fs.statSync(target).size === expected) return target;
    } catch (error) {
      console.warn(`  attempt ${attempt} failed: ${error.message}`);
    }
  }
  throw new Error('Could not download the BodyParts3D archive. Download it manually into ' + target);
}

/** Smoothing strength per shading family (Taubin iterations). */
const SMOOTHING = {
  myocardium: 3,
  atrium: 3,
  bloodOxy: 6,
  bloodDeoxy: 6,
  valve: 1,
  papillary: 4,
  artery: 6,
  vein: 6,
  greatArtery: 10,
  greatVein: 10,
  pulmonaryArtery: 10,
  pulmonaryVein: 8,
};

/**
 * @returns Map fileId -> { mesh (mm, BodyParts3D frame), header }
 */
export function loadPieces(archivePath, structures) {
  const zip = openZip(archivePath);
  const pieces = new Map();
  for (const [key, structure] of Object.entries(structures)) {
    if (!structure.sources) continue;
    for (const fileId of structure.sources) {
      if (pieces.has(fileId)) continue;
      const entry = `${ENTRY_PREFIX}${fileId}.obj`;
      if (!zip.has(entry)) throw new Error(`${key}: ${entry} is not in the archive`);
      const { mesh, header } = parseObj(zip.read(entry).toString('utf8'));
      let clean = weld(mesh, 1e-4);
      for (const clip of structure.clip ?? []) clean = clipAxis(clean, clip.axis, clip.keep, clip.value);
      clean = compact(weld(clean, 1e-5));
      const iterations = SMOOTHING[structure.material] ?? 3;
      if (iterations > 0) taubinSmooth(clean, iterations, 0.5, -0.53, adjacency(clean));
      pieces.set(fileId, { fileId, key, mesh: clean, header });
    }
  }
  return pieces;
}

/** Makes the triangle winding of a closed-ish mesh face outwards. */
export function orientOutwards(mesh) {
  const P = mesh.positions;
  const idx = mesh.indices;
  let volume = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3;
    const b = idx[t + 1] * 3;
    const c = idx[t + 2] * 3;
    volume +=
      P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) -
      P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) +
      P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  if (volume < 0) {
    for (let t = 0; t < idx.length; t += 3) {
      const tmp = idx[t + 1];
      idx[t + 1] = idx[t + 2];
      idx[t + 2] = tmp;
    }
  }
  return volume < 0;
}

export { vertexCount };

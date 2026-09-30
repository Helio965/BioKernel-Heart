import { STRUCTURES } from './anatomy.js';

/**
 * Valve animation.
 *
 * The model pipeline bakes two blend shapes per leaflet / cusp: half open and
 * fully open (AV leaflets rotate about their annular hinge, bending towards the
 * free edge, while the chordae stay anchored on the papillary muscles;
 * semilunar cusps fold back against the sinus wall). Here the opening of each
 * valve, computed by js/heartbeat.js from the cardiac cycle, is turned into
 * blend weights with a quadratic (Lagrange) interpolation through
 * closed -> half -> open, which keeps the swing curved instead of a straight
 * linear morph.
 */

const VALVE_OF_KEY = {};
for (const [key, info] of Object.entries(STRUCTURES)) {
  if (info.valve) VALVE_OF_KEY[key] = info.valve.valve;
}
VALVE_OF_KEY.mitralChordae = 'mitral';
VALVE_OF_KEY.tricuspidChordae = 'tricuspid';

/** Which valve (mitral, tricuspid, aortic, pulmonary) a structure belongs to. */
export function valveOf(key) {
  return VALVE_OF_KEY[key] ?? null;
}

/** Blend weights [half, open] for an opening t in [0, 1]. */
export function valveBlend(t, out = [0, 0]) {
  out[0] = 4 * t * (1 - t);
  out[1] = t * (2 * t - 1);
  return out;
}

/** Human readable state, used by the information card and tests. */
export function valveState(opening) {
  if (opening > 0.6) return 'aberta';
  if (opening > 0.05) return 'abrindo/fechando';
  return 'fechada';
}

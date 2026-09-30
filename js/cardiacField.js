/**
 * Cardiac deformation field.
 *
 * A smooth displacement field that describes how any point of the heart
 * moves between end-diastole (the rest pose of the model) and the end of each
 * contraction. It is pure math (no Three.js), shared by:
 *
 *   - tools/model-build/build.mjs, which bakes it into morph targets
 *     (blend shapes) of every mesh, so the GPU only blends two poses;
 *   - the browser, which applies the same field to points that are not part
 *     of the model (blood-flow particles, labels, conduction paths).
 *
 * Because every structure is moved by the same continuous field, walls,
 * valves, papillary muscles, vessels and particles stay attached to each
 * other while the heart beats.
 *
 * Components (see docs/ARCHITECTURE.md, "Batimento"):
 *   ventricular systole
 *     - longitudinal shortening: the atrioventricular plane moves towards the
 *       apex (the apex barely moves);
 *     - radial contraction of each ventricle around its long axis, with the
 *       wall thickening that follows from conserving the wall's volume;
 *     - torsion: apex and base rotate in opposite directions;
 *   atrial systole
 *     - concentric contraction of each atrium, also conserving wall volume.
 *
 * Units: whatever units the chamber frames use (the app uses centimetres).
 */

export const DEFAULT_FIELD_PARAMS = {
  // End-systolic endocardial radius / end-diastolic radius (fractional
  // shortening ~28% for the LV and ~20% for the RV, inside normal ranges).
  alphaLV: 0.72,
  alphaRV: 0.8,
  // Longitudinal shortening of the ventricles (AV-plane excursion / length).
  longShortening: 0.14,
  // Torsion (degrees): apex counter-clockwise, base clockwise, seen from the apex.
  twistApex: 9,
  twistBase: 4,
  // Atrial end-systolic / end-diastolic linear size.
  betaAtrium: 0.88,
  // How far (in units) the influence of a chamber extends outside its cavity.
  wallReach: 1.6,
  // Height (in units) over which the AV-plane motion fades out towards the
  // atrial roofs and the great vessels.
  baseFade: 3.2,
};

const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * @param {object} frames
 *   chambers: { lv|rv|la|ra: { center:[3], axes:[[3],[3],[3]], radii:[3] } }
 *     axes[0] is the long axis (for ventricles, pointing from apex to base)
 *   longAxis: { apex:[3], base:[3] }
 */
export function createCardiacField(frames, params = {}) {
  const P = { ...DEFAULT_FIELD_PARAMS, ...params };
  const { chambers } = frames;
  const apex = frames.longAxis.apex;
  const base = frames.longAxis.base;
  const axis = normalize(sub(base, apex));
  const length = Math.hypot(base[0] - apex[0], base[1] - apex[1], base[2] - apex[2]);

  // Direction from the RV centre towards the LV centre: the RV free wall moves
  // towards the septum (bellows), while the septum itself belongs to the LV.
  const rvToLv = normalize(sub(chambers.lv.center, chambers.rv.center));

  const twistApex = (P.twistApex * Math.PI) / 180;
  const twistBase = (P.twistBase * Math.PI) / 180;

  /** Normalised height along the long axis: 0 at the apex, 1 at the AV plane. */
  function height(p) {
    return ((p[0] - apex[0]) * axis[0] + (p[1] - apex[1]) * axis[1] + (p[2] - apex[2]) * axis[2]) / length;
  }

  /** How much of the AV-plane motion a point follows (1 below the base). */
  function baseFollow(h) {
    if (h <= 1) return Math.max(h, 0);
    const above = (h - 1) * length;
    return Math.exp(-(above * above) / (P.baseFade * P.baseFade));
  }

  function ventricleRadial(p, chamber, alpha, lambda, out, septalRelief) {
    const c = chamber.center;
    const u = chamber.axes[0];
    const q0 = p[0] - c[0];
    const q1 = p[1] - c[1];
    const q2 = p[2] - c[2];
    const along = q0 * u[0] + q1 * u[1] + q2 * u[2];
    const r0 = q0 - along * u[0];
    const r1 = q1 - along * u[1];
    const r2 = q2 - along * u[2];
    const rho = Math.hypot(r0, r1, r2);
    if (rho < 1e-6) return 0;

    const a = chamber.radii[0];
    const b = Math.sqrt(chamber.radii[1] * chamber.radii[2]);
    // Influence: 1 inside the cavity and its wall, fading outside the heart
    // and towards the fibrous base (valve annuli and the aortic/pulmonary
    // roots follow the AV plane but do not contract with the ventricles).
    const e = Math.hypot(along / (a + P.wallReach * 0.7), rho / (b + P.wallReach));
    let w = (1 - smoothstep(0.82, 1.3, e)) * (1 - smoothstep(0.84, 1.1, height(p)));
    if (w <= 0) return 0;
    if (septalRelief) {
      const facing = (r0 * rvToLv[0] + r1 * rvToLv[1] + r2 * rvToLv[2]) / rho;
      w *= 1 - 0.75 * smoothstep(0.05, 0.6, facing);
    }

    // Cavity radius at this height (ellipsoid), then incompressible mapping.
    const t = Math.min(Math.abs(along) / a, 0.985);
    const R = b * Math.sqrt(1 - t * t);
    let rhoNew;
    if (rho <= R) rhoNew = alpha * rho;
    else rhoNew = Math.sqrt(alpha * alpha * R * R + (rho * rho - R * R) / lambda);
    // Beyond the wall the mapping must not push points outwards.
    rhoNew = Math.min(rhoNew, rho);
    const k = ((rhoNew - rho) / rho) * w;
    out[0] += r0 * k;
    out[1] += r1 * k;
    out[2] += r2 * k;
    return w;
  }

  /**
   * Displacement at end-systole of the ventricles (added to `out`).
   * @returns the out vector
   */
  function ventricularSystole(p, out = [0, 0, 0]) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    const h = height(p);
    const follow = baseFollow(h);
    const lambda = 1 - P.longShortening;

    // 1. Radial contraction (LV + RV).
    const wl = ventricleRadial(p, chambers.lv, P.alphaLV, lambda, out, false);
    const wr = ventricleRadial(p, chambers.rv, P.alphaRV, lambda, out, true);
    const ventricular = Math.min(1, wl + wr);

    // 2. Longitudinal: the AV plane descends towards the apex.
    const drop = -P.longShortening * length * follow;
    out[0] += axis[0] * drop;
    out[1] += axis[1] * drop;
    out[2] += axis[2] * drop;

    // 3. Torsion around the long axis (right-handed about apex->base).
    const hc = Math.min(Math.max(h, 0), 1);
    const angle = (-twistApex * (1 - hc) + twistBase * hc) * ventricular * (h > 1 ? follow : 1);
    if (Math.abs(angle) > 1e-5) {
      const q0 = p[0] - apex[0];
      const q1 = p[1] - apex[1];
      const q2 = p[2] - apex[2];
      const along = q0 * axis[0] + q1 * axis[1] + q2 * axis[2];
      const r0 = q0 - along * axis[0];
      const r1 = q1 - along * axis[1];
      const r2 = q2 - along * axis[2];
      // axis × r
      const c0 = axis[1] * r2 - axis[2] * r1;
      const c1 = axis[2] * r0 - axis[0] * r2;
      const c2 = axis[0] * r1 - axis[1] * r0;
      const cos = Math.cos(angle) - 1;
      const sin = Math.sin(angle);
      out[0] += r0 * cos + c0 * sin;
      out[1] += r1 * cos + c1 * sin;
      out[2] += r2 * cos + c2 * sin;
    }
    return out;
  }

  function atriumContraction(p, chamber, out) {
    const c = chamber.center;
    const q = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    const [u, v, w] = chamber.axes;
    const [a, b, cc] = chamber.radii;
    const e = Math.hypot(dot(q, u) / a, dot(q, v) / b, dot(q, w) / cc);
    const r = Math.hypot(q[0], q[1], q[2]);
    if (r < 1e-6) return;
    const influence = 1 - smoothstep(1.05, 1.0 + (P.wallReach * 0.9) / Math.min(a, b, cc), e);
    if (influence <= 0) return;
    const R = r / Math.max(e, 1e-6); // cavity radius in this direction
    const beta = P.betaAtrium;
    let rNew;
    if (r <= R) rNew = beta * r;
    else rNew = Math.cbrt(Math.max(r * r * r - (1 - beta * beta * beta) * R * R * R, 0));
    const k = ((rNew - r) / r) * influence;
    out[0] += q[0] * k;
    out[1] += q[1] * k;
    out[2] += q[2] * k;
  }

  /** Displacement at the peak of atrial contraction. */
  function atrialSystole(p, out = [0, 0, 0]) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    atriumContraction(p, chambers.la, out);
    atriumContraction(p, chambers.ra, out);
    // Late-diastolic (a') motion of the AV annuli towards the atria.
    const lift = 0.15 * P.longShortening * length * baseFollow(height(p));
    out[0] += axis[0] * lift;
    out[1] += axis[1] * lift;
    out[2] += axis[2] * lift;
    return out;
  }

  return { params: P, axis, length, apex, base, height, ventricularSystole, atrialSystole };
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function normalize(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

import * as THREE from 'three';
import { buildPath, pointOnPath, treePaths } from './vessels.js';
import { particleVertex, particleFragment } from './shaders.js';
import { mulberry32 } from './random.js';

/**
 * Coronary circulation.
 *
 * Particles run along the coronary arterial trees (from the ostia in the aortic
 * sinuses to the end of every branch of the model) and back through the
 * cardiac veins to the coronary sinus and the right atrium.
 *
 * Timing follows coronary physiology: the intramyocardial vessels of the left
 * ventricle are compressed in systole, so left coronary flow is mostly
 * diastolic; right coronary flow is more even; venous outflow is pushed out
 * during systole (sources in docs/ANATOMY_SOURCES.md).
 */

const ARTERY = new THREE.Color(1.0, 0.2, 0.18).multiplyScalar(1.6);
const VEIN = new THREE.Color(0.3, 0.45, 1.0).multiplyScalar(1.6);
const SPEED = 5.5; // cm/s at full flow

export function createCoronaryFlow({ data, field, count, seed = 97 }) {
  const random = mulberry32(seed);
  const routes = [];
  for (const { packs, key, root } of treePaths(data.arteries)) {
    const path = buildPath(packs, 0.05);
    if (path && path.total > 0.3) routes.push({ path, venous: false, left: root !== 'rca', key });
  }
  for (const { packs, key } of treePaths(data.veins)) {
    const path = buildPath(packs, 0.05);
    if (path && path.total > 0.3) routes.push({ path, venous: true, left: false, key, reversed: true });
  }
  // Longer routes get proportionally more particles.
  const weights = routes.map((r) => r.path.total);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const pickRoute = () => {
    let x = random() * totalWeight;
    for (let i = 0; i < routes.length; i++) {
      x -= weights[i];
      if (x <= 0) return i;
    }
    return routes.length - 1;
  };

  const max = 5000;
  const positions = new Float32Array(max * 3);
  const colors = new Float32Array(max * 3);
  const sizes = new Float32Array(max);
  const alphas = new Float32Array(max);
  const route = new Uint16Array(max);
  const s = new Float32Array(max);
  const angle = new Float32Array(max);
  const fraction = new Float32Array(max);
  const jitter = new Float32Array(max);

  function spawn(i, anywhere) {
    route[i] = pickRoute();
    const r = routes[route[i]];
    s[i] = anywhere ? random() * r.path.total : random() * 0.2;
    angle[i] = random() * Math.PI * 2;
    fraction[i] = Math.sqrt(random()) * 0.55;
    jitter[i] = 0.8 + random() * 0.4;
    const c = r.venous ? VEIN : ARTERY;
    colors.set([c.r, c.g, c.b], i * 3);
    sizes[i] = 0.07 + random() * 0.04;
    alphas[i] = 0.8 + random() * 0.2;
  }
  for (let i = 0; i < max; i++) spawn(i, true);

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute);
  // A respawned particle may switch between an arterial and a venous route
  // (red <-> blue), so colour, size and opacity are re-uploaded after respawns.
  const styleAttributes = [
    new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage),
    new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage),
    new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage),
  ];
  geometry.setAttribute('aColor', styleAttributes[0]);
  geometry.setAttribute('aSize', styleAttributes[1]);
  geometry.setAttribute('aAlpha', styleAttributes[2]);

  const uniforms = { uPixelRatio: { value: 1 }, uScale: { value: 900 }, uOpacity: { value: 0 } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: particleVertex,
    fragmentShader: particleFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'CoronaryFlow';
  points.frustumCulled = false;
  points.renderOrder = 9;
  points.visible = false;

  let visibleCount = Math.min(count, max);
  geometry.setDrawRange(0, visibleCount);
  let opacity = 0;
  let target = 0;
  const p = [0, 0, 0];
  const dv = [0, 0, 0];
  const da = [0, 0, 0];

  return {
    object: points,
    routes,
    setVisible(on) {
      target = on ? 1 : 0;
    },
    setCount(n) {
      visibleCount = Math.max(0, Math.min(max, n));
      geometry.setDrawRange(0, visibleCount);
    },
    setPixelRatio(ratio) {
      uniforms.uPixelRatio.value = ratio;
    },
    update(delta, cycle) {
      opacity += (target - opacity) * (1 - Math.exp(-delta / 0.3));
      points.visible = opacity > 0.01;
      if (!points.visible) return;
      uniforms.uOpacity.value = opacity;
      let respawned = false;
      for (let i = 0; i < visibleCount; i++) {
        const r = routes[route[i]];
        const flow = r.venous ? cycle.coronaryVenous : r.left ? cycle.coronaryLeft : cycle.coronaryRight;
        s[i] += SPEED * flow * jitter[i] * delta;
        if (s[i] >= r.path.total) {
          spawn(i, false);
          respawned = true;
          continue;
        }
        // Venous routes are stored root -> branch: blood flows the other way.
        const along = r.reversed ? r.path.total - s[i] : s[i];
        pointOnPath(r.path, along, angle[i], fraction[i], p);
        field.ventricularSystole(p, dv);
        field.atrialSystole(p, da);
        positions[i * 3] = p[0] + dv[0] * cycle.ventricular + da[0] * cycle.atrial;
        positions[i * 3 + 1] = p[1] + dv[1] * cycle.ventricular + da[1] * cycle.atrial;
        positions[i * 3 + 2] = p[2] + dv[2] * cycle.ventricular + da[2] * cycle.atrial;
      }
      positionAttribute.needsUpdate = true;
      positionAttribute.clearUpdateRanges();
      positionAttribute.addUpdateRange(0, visibleCount * 3);
      if (respawned) {
        for (const attribute of styleAttributes) {
          attribute.needsUpdate = true;
          attribute.clearUpdateRanges();
          attribute.addUpdateRange(0, visibleCount * attribute.itemSize);
        }
      }
    },
  };
}

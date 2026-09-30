import * as THREE from 'three';
import { buildPath, pointOnPath, regionAt, REGION } from './vessels.js';
import { particleVertex, particleFragment } from './shaders.js';
import { mulberry32 } from './random.js';

/**
 * Blood flow through the heart (educational colours: blue = less oxygenated,
 * red = more oxygenated).
 *
 * Every particle follows a real route of the model, sampled from the vessel
 * centre lines and chamber way-points:
 *
 *   venae cavae / coronary sinus -> right atrium -> tricuspid valve ->
 *   right ventricle -> pulmonary valve -> pulmonary trunk -> pulmonary arteries
 *   -> (lungs) -> pulmonary veins -> left atrium -> mitral valve -> left
 *   ventricle -> aortic valve -> aorta and arch branches -> (body) -> ...
 *
 * The lungs and the body are not modelled: a particle leaving through a
 * pulmonary artery re-enters, oxygenated, through a pulmonary vein, and one
 * leaving through the aorta re-enters through a vena cava.
 *
 * Motion is gated by the cardiac cycle: blood crosses the AV valves only while
 * they are open (early filling + atrial kick) and leaves the ventricles only
 * during ejection. Particles are also moved by the same deformation field as
 * the heart walls, so they are squeezed with the chambers.
 */

const COLORS = {
  deoxygenated: new THREE.Color(0.25, 0.42, 1.0).multiplyScalar(1.5),
  oxygenated: new THREE.Color(1.0, 0.16, 0.14).multiplyScalar(1.5),
};

// Speeds (cm/s) at full flow, scaled for a readable animation.
const SPEED = { vein: 6, atrium: 4, avValve: 11, ventricle: 9, ventricleEjection: 16, slValve: 18, artery: 16 };

export function createBloodFlow({ data, field, count, seed = 71 }) {
  const random = mulberry32(seed);
  const circuits = ['right', 'left'].map((side) => {
    const c = data.circuits[side];
    const routes = [];
    for (const inflow of c.inflows) {
      for (const outflow of c.outflows) {
        const path = buildPath([inflow, c.chamber, outflow]);
        if (path) routes.push({ path, inflow: inflow.key, outflow: outflow.key });
      }
    }
    return { side, blood: c.blood, routes, color: COLORS[c.blood] };
  });

  const max = 12000;
  const positions = new Float32Array(max * 3);
  const colors = new Float32Array(max * 3);
  const sizes = new Float32Array(max);
  const alphas = new Float32Array(max);
  const particle = {
    circuit: new Uint8Array(max),
    route: new Uint16Array(max),
    s: new Float32Array(max),
    angle: new Float32Array(max),
    fraction: new Float32Array(max),
    jitter: new Float32Array(max),
    wait: new Float32Array(max),
    spin: new Float32Array(max),
  };

  function spawn(i, circuitIndex, anywhere) {
    const circuit = circuits[circuitIndex];
    const routeIndex = Math.floor(random() * circuit.routes.length);
    const route = circuit.routes[routeIndex];
    particle.circuit[i] = circuitIndex;
    particle.route[i] = routeIndex;
    particle.s[i] = anywhere ? random() * route.path.total : random() * 0.6;
    particle.angle[i] = random() * Math.PI * 2;
    particle.fraction[i] = Math.sqrt(random()) * 0.92;
    particle.jitter[i] = 0.75 + random() * 0.5;
    particle.wait[i] = 0.15 + random() * 1.4;
    particle.spin[i] = (random() - 0.5) * 2.2;
    const c = circuit.color;
    colors.set([c.r, c.g, c.b], i * 3);
    sizes[i] = 0.16 + random() * 0.1;
    alphas[i] = 0.75 + random() * 0.25;
  }
  for (let i = 0; i < max; i++) spawn(i, i % 2, true);

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setDrawRange(0, count);

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
  points.name = 'BloodFlow';
  points.frustumCulled = false;
  points.renderOrder = 8;
  points.visible = false;

  let visibleCount = count;
  let opacity = 0;
  let target = 0;
  const p = [0, 0, 0];
  const dv = [0, 0, 0];
  const da = [0, 0, 0];

  function speedAt(region, s, route, cycle, i) {
    const { avFlow, slFlow, venousFlow, arterialFlow } = cycle;
    const side = particle.circuit[i] === 0 ? 'tricuspid' : 'mitral';
    const outlet = particle.circuit[i] === 0 ? 'pulmonary' : 'aortic';
    const avOpen = cycle.valves[side];
    const slOpen = cycle.valves[outlet];
    switch (region) {
      case REGION.vein:
        return SPEED.vein * venousFlow;
      case REGION.atrium:
        return SPEED.atrium * (0.25 + 1.6 * avFlow * avOpen + 0.3 * venousFlow);
      case REGION.avValve:
        return SPEED.avValve * (0.05 + avFlow) * avOpen + 0.3;
      case REGION.ventricle:
        return slOpen > 0.05 ? SPEED.ventricleEjection * (0.2 + slFlow) : SPEED.ventricle * (0.08 + avFlow * avOpen);
      case REGION.slValve:
        return SPEED.slValve * (0.1 + slFlow) * slOpen + 0.2;
      default:
        return SPEED.artery * arterialFlow;
    }
  }

  return {
    object: points,
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

      for (let i = 0; i < visibleCount; i++) {
        const circuit = circuits[particle.circuit[i]];
        const route = circuit.routes[particle.route[i]];
        const path = route.path;
        let s = particle.s[i];
        const region = regionAt(path, s);
        let ds = speedAt(region, s, route, cycle, i) * particle.jitter[i] * delta;
        // Valves: blood waits in the chamber while the valve is closed.
        const valveName = particle.circuit[i] === 0 ? 'tricuspid' : 'mitral';
        const outletName = particle.circuit[i] === 0 ? 'pulmonary' : 'aortic';
        if (path.markers.av !== undefined && s < path.markers.av && cycle.valves[valveName] < 0.05) {
          ds = Math.min(ds, Math.max(path.markers.av - particle.wait[i] - s, 0));
        }
        if (path.markers.sl !== undefined && s < path.markers.sl && s > (path.markers.av ?? 0) && cycle.valves[outletName] < 0.05) {
          ds = Math.min(ds, Math.max(path.markers.sl - particle.wait[i] * 0.8 - s, 0));
        }
        s += ds;
        if (s >= path.total) {
          // Leaves the heart: re-enter through the other circuit (lungs / body).
          spawn(i, particle.circuit[i] === 0 ? 1 : 0, false);
          continue;
        }
        particle.s[i] = s;
        // Gentle swirl inside the chambers.
        if (region === REGION.atrium || region === REGION.ventricle) particle.angle[i] += particle.spin[i] * delta;
        pointOnPath(path, s, particle.angle[i], particle.fraction[i], p);
        field.ventricularSystole(p, dv);
        field.atrialSystole(p, da);
        const wv = cycle.ventricular;
        const wa = cycle.atrial;
        positions[i * 3] = p[0] + dv[0] * wv + da[0] * wa;
        positions[i * 3 + 1] = p[1] + dv[1] * wv + da[1] * wa;
        positions[i * 3 + 2] = p[2] + dv[2] * wv + da[2] * wa;
      }
      positionAttribute.needsUpdate = true;
      positionAttribute.clearUpdateRanges();
      positionAttribute.addUpdateRange(0, visibleCount * 3);
    },
  };
}

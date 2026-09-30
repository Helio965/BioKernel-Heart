import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { conductionVertex, conductionFragment } from './shaders.js';

/**
 * Cardiac conduction system (optional layer "Sistema elétrico").
 *
 * Geometry comes from the model pipeline (tools/model-build/lib/conduction.mjs),
 * which places it from anatomical landmarks of the model and computes the
 * activation time of every point:
 *   SA node -> internodal pathways (anterior, middle, posterior) and Bachmann
 *   bundle (~50 ms to the AV node) -> AV node (~100 ms delay) -> His bundle ->
 *   left bundle branch fascicles and right bundle branch (~25 ms to the apex)
 *   -> Purkinje network (~75 ms to reach all ventricular muscle).
 *
 * A luminous impulse travels along every path at its activation time, driven
 * by the same clock as the contraction (P wave -> atria; QRS -> ventricles),
 * and the myocardium itself shows the depolarisation wave (js/shaders.js).
 */

const PULSE = new THREE.Color('#ffe27a');
const BASE = new THREE.Color('#ffb070');

export function createConductionSystem({ data, field, shared }) {
  const group = new THREE.Group();
  group.name = 'ConductionSystem';
  group.visible = false;

  const uniforms = {
    uSinceP: shared.uSinceP,
    uQTime: shared.uQTime,
    uQT: shared.uQT,
    uOpacity: { value: 0 },
    uAVDelayEnd: { value: 150 },
    uBaseColor: { value: BASE.clone() },
    uPulseColor: { value: PULSE.clone() },
  };

  const pieces = new Map(); // key -> [mesh]
  const selectable = [];

  function makeMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uBaseColor: { value: BASE.clone() } },
      vertexShader: conductionVertex,
      fragmentShader: conductionFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  /** Tube along points with a per-vertex activation time. */
  function tube(points, times, radius, ref, radialSegments = 6) {
    const vectors = [];
    for (let i = 0; i < points.length; i += 3) vectors.push(new THREE.Vector3(points[i], points[i + 1], points[i + 2]));
    if (vectors.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(vectors, false, 'centripetal');
    const lengths = [0];
    for (let i = 1; i < vectors.length; i++) lengths.push(lengths[i - 1] + vectors[i].distanceTo(vectors[i - 1]));
    const total = lengths[lengths.length - 1];
    const segments = Math.max(4, Math.ceil(total / 0.12));
    const geometry = new THREE.TubeGeometry(curve, segments, radius, radialSegments, false);
    const ringSize = radialSegments + 1;
    const time = new Float32Array(geometry.attributes.position.count);
    for (let ring = 0; ring <= segments; ring++) {
      const along = (ring / segments) * total;
      let k = 0;
      while (k < lengths.length - 2 && lengths[k + 1] < along) k++;
      const f = THREE.MathUtils.clamp((along - lengths[k]) / Math.max(lengths[k + 1] - lengths[k], 1e-6), 0, 1);
      const t = times[k] + (times[k + 1] - times[k]) * f;
      for (let j = 0; j < ringSize; j++) time[ring * ringSize + j] = t;
    }
    geometry.setAttribute('aTime', new THREE.BufferAttribute(time, 1));
    geometry.setAttribute('aRef', new THREE.BufferAttribute(new Float32Array(time.length).fill(ref === 'Q' ? 1 : 0), 1));
    geometry.deleteAttribute('uv');
    return geometry;
  }

  /** Blend shapes from the cardiac deformation field (same as the walls). */
  function addDeformation(geometry) {
    const position = geometry.attributes.position;
    const ventricular = new Float32Array(position.count * 3);
    const atrial = new Float32Array(position.count * 3);
    const p = [0, 0, 0];
    const out = [0, 0, 0];
    for (let i = 0; i < position.count; i++) {
      p[0] = position.getX(i);
      p[1] = position.getY(i);
      p[2] = position.getZ(i);
      field.ventricularSystole(p, out);
      ventricular.set(out, i * 3);
      field.atrialSystole(p, out);
      atrial.set(out, i * 3);
    }
    geometry.morphAttributes.position = [new THREE.BufferAttribute(ventricular, 3), new THREE.BufferAttribute(atrial, 3)];
    geometry.morphTargetsRelative = true;
    return geometry;
  }

  function addMesh(key, geometry) {
    addDeformation(geometry);
    const mesh = new THREE.Mesh(geometry, makeMaterial());
    mesh.userData.key = key;
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    mesh.updateMorphTargets();
    group.add(mesh);
    if (!pieces.has(key)) pieces.set(key, []);
    pieces.get(key).push(mesh);
    selectable.push(mesh);
    return mesh;
  }

  // Paths grouped by structure.
  const byKey = new Map();
  for (const path of data.paths) {
    const geometry = tube(path.points, path.times, path.radius, path.ref);
    if (!geometry) continue;
    if (!byKey.has(path.key)) byKey.set(path.key, []);
    byKey.get(path.key).push(geometry);
  }
  for (const [key, geometries] of byKey) addMesh(key, mergeGeometries(geometries));

  // Purkinje network (one merged mesh).
  const purkinjeGeometries = data.purkinje
    .map((segment) => tube(segment.points, segment.times, 0.022, 'Q', 4))
    .filter(Boolean);
  const purkinje = purkinjeGeometries.length ? addMesh('purkinje', mergeGeometries(purkinjeGeometries)) : null;

  // SA and AV nodes: small ellipsoids that light up when they fire.
  const nodeMeshes = {};
  for (const [key, node] of Object.entries(data.nodes)) {
    const geometry = new THREE.SphereGeometry(node.radius, 20, 14);
    geometry.scale(1.6, 0.8, 0.8);
    const count = geometry.attributes.position.count;
    geometry.translate(node.point[0], node.point[1], node.point[2]);
    geometry.setAttribute('aTime', new THREE.BufferAttribute(new Float32Array(count).fill(node.time), 1));
    geometry.setAttribute('aRef', new THREE.BufferAttribute(new Float32Array(count).fill(0), 1));
    nodeMeshes[key] = addMesh(key, geometry);
  }

  let opacity = 0;
  let target = 0;
  let hovered = null;
  let selected = null;
  let isolated = null;

  return {
    group,
    keys: [...pieces.keys()],
    pickables() {
      return group.visible && opacity > 0.5 ? selectable : [];
    },
    setVisible(on) {
      target = on ? 1 : 0;
    },
    setPurkinje(on) {
      if (purkinje) purkinje.visible = on;
    },
    setHovered(key) {
      hovered = key;
    },
    setSelected(key) {
      selected = key;
    },
    setIsolated(key) {
      isolated = key;
    },
    /** Deformed anchor of a conduction structure (for focusing the camera). */
    has(key) {
      return pieces.has(key);
    },
    update(delta, cycle) {
      opacity += (target - opacity) * (1 - Math.exp(-delta / 0.3));
      group.visible = opacity > 0.01;
      if (!group.visible) return;
      const pr = cycle.timeline.pr * 1000;
      for (const [key, meshes] of pieces) {
        const dim = isolated && isolated !== key ? 0.12 : 1;
        const boost = key === selected ? 1.6 : key === hovered ? 1.3 : 1;
        for (const mesh of meshes) {
          mesh.morphTargetInfluences[0] = cycle.ventricular;
          mesh.morphTargetInfluences[1] = cycle.atrial;
          const u = mesh.material.uniforms;
          u.uOpacity.value = opacity * dim;
          u.uBaseColor.value.copy(BASE).multiplyScalar(boost);
          u.uAVDelayEnd.value = pr - 40;
        }
      }
      // AV node: glows during the AV delay (from ~50 ms after the P wave until
      // the impulse enters the His bundle, ~40 ms before the QRS).
      const av = nodeMeshes.avNode;
      if (av) {
        const since = cycle.sinceP;
        const inDelay = since > 50 && since < pr - 40 ? 1 : 0;
        av.material.uniforms.uBaseColor.value.copy(BASE).multiplyScalar(1 + inDelay * 2.2);
      }
    },
  };
}

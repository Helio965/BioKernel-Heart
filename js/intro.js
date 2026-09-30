import * as THREE from 'three';
import { particleVertex, particleFragment } from './shaders.js';
import { mulberry32 } from './random.js';

/**
 * Opening animation inspired by the reference videos: a cloud of luminous
 * particles converges onto the surface of the anatomical heart, which then
 * fades in and starts beating. The particles are only a transition; the object
 * that stays on screen is the anatomical model.
 */
export function createIntro({ heart, scene, count = 9000, duration = 2.6 }) {
  const random = mulberry32(5);
  const sources = [];
  for (const key of ['lvWall', 'rvWall', 'laWall', 'raWall', 'ascendingAorta', 'aorticArch', 'pulmonaryTrunk', 'superiorVenaCava']) {
    for (const mesh of heart.structures.get(key)?.meshes ?? []) sources.push(mesh);
  }
  const vertex = new THREE.Vector3();
  const targets = new Float32Array(count * 3);
  const starts = new Float32Array(count * 3);
  const delays = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const mesh = sources[Math.floor(random() * sources.length)];
    const position = mesh.geometry.attributes.position;
    vertex.fromBufferAttribute(position, Math.floor(random() * position.count));
    mesh.updateMatrixWorld();
    vertex.applyMatrix4(mesh.matrixWorld);
    targets.set([vertex.x, vertex.y, vertex.z], i * 3);
    const dir = new THREE.Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1).normalize();
    const r = 18 + random() * 22;
    starts.set([vertex.x + dir.x * r, vertex.y + dir.y * r, vertex.z + dir.z * r], i * 3);
    delays[i] = random() * 0.6;
  }

  const positions = new Float32Array(starts);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const warm = 0.7 + random() * 0.3;
    colors.set([1.4 * warm, 0.25 * warm, 0.3 * warm], i * 3);
    sizes[i] = 0.1 + random() * 0.1;
    alphas[i] = 0.8;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  const uniforms = { uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }, uScale: { value: 900 }, uOpacity: { value: 1 } };
  const points = new THREE.Points(
    geometry,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  points.frustumCulled = false;
  points.visible = false;
  points.renderOrder = 20;
  scene.add(points);

  let time = -1;
  let revealed = false;
  const hidden = new Map();

  function finish() {
    time = -1;
    points.visible = false;
    scene.remove(points);
    geometry.dispose();
    for (const [structure, target] of hidden) structure.layerTarget = target;
    hidden.clear();
  }

  return {
    start() {
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      time = 0;
      points.visible = true;
      revealed = false;
      for (const s of heart.structures.values()) {
        hidden.set(s, s.layerTarget);
        s.layerOpacity = 0;
        s.layerTarget = 0;
      }
      window.addEventListener('pointerdown', () => time >= 0 && finish(), { once: true });
    },
    update(delta) {
      if (time < 0) return;
      time += delta;
      const u = Math.min(time / duration, 1);
      for (let i = 0; i < count; i++) {
        const t = THREE.MathUtils.clamp((u * (1 + 0.6) - delays[i] / duration) / 1, 0, 1);
        const e = 1 - Math.pow(1 - t, 3);
        for (let a = 0; a < 3; a++) positions[i * 3 + a] = starts[i * 3 + a] + (targets[i * 3 + a] - starts[i * 3 + a]) * e;
      }
      geometry.attributes.position.needsUpdate = true;
      if (!revealed && u > 0.72) {
        revealed = true;
        for (const [structure, target] of hidden) structure.layerTarget = target;
      }
      uniforms.uOpacity.value = u < 0.75 ? 1 : 1 - (u - 0.75) / 0.25;
      if (u >= 1) finish();
    },
  };
}

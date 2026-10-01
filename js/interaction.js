import * as THREE from 'three';

/**
 * Pointer interaction with THREE.Raycaster.
 *
 *   hover  -> the structure under the pointer is highlighted (soft rim glow)
 *   click  -> selection (information card); click on empty space clears it
 *   double click -> the camera flies to that point (orbit target moves there)
 *
 * The rays are cast against picking proxies that share the blend-shape weights
 * of the visible meshes, so they follow the beating heart (accelerated by the
 * BVH picker in js/picking.js). Surfaces that the reveal has made (almost)
 * transparent are skipped: the ray goes through them to what the user
 * actually sees.
 */

const { smoothstep, lerp } = THREE.MathUtils;

/** CPU mirror of revealAlpha() in js/shaders.js. */
export function surfaceAlpha(point, structure, shared) {
  const u = structure.uniforms;
  const camera = shared.uCameraPos.value;
  const target = shared.uTarget.value;
  const toCamera = camera.clone().sub(target);
  const distance = Math.max(toCamera.length(), 1e-3);
  const axis = toCamera.divideScalar(distance);
  const rel = point.clone().sub(target);
  const along = rel.dot(axis);
  const radial = rel.sub(axis.clone().multiplyScalar(along)).length();
  const radius = shared.uWindowRadius.value;
  const inWindow = (1 - smoothstep(radial, radius * 0.5, radius)) * smoothstep(along, -0.9, 0.9);
  const fade = smoothstep(shared.uRevealProgress.value, u.uFadeStart.value, u.uFadeEnd.value) * shared.uRevealEnabled.value;
  let alpha = lerp(1, u.uMinAlpha.value, fade * inWindow);
  alpha *= lerp(1, u.uUserMinAlpha.value, shared.uUserTransparency.value);
  alpha *= smoothstep(point.distanceTo(camera), shared.uNearFade.value.x, shared.uNearFade.value.y);
  alpha *= u.uLayerOpacity.value * u.uDetailFade.value * lerp(1, 0.06, u.uDim.value) * u.uBaseAlpha.value;
  return alpha;
}

const triangle = new THREE.Triangle();
const va = new THREE.Vector3();
const vb = new THREE.Vector3();
const vc = new THREE.Vector3();
const bary = new THREE.Vector3();

/** Fat weight of the epicardium at a hit point (from the tissue data). */
function epicardialFat(hit) {
  const attribute = hit.object.geometry.getAttribute('_tissue');
  if (!attribute || !hit.face) return 0;
  const { a, b, c } = hit.face;
  hit.object.getVertexPosition(a, va).applyMatrix4(hit.object.matrixWorld);
  hit.object.getVertexPosition(b, vb).applyMatrix4(hit.object.matrixWorld);
  hit.object.getVertexPosition(c, vc).applyMatrix4(hit.object.matrixWorld);
  triangle.set(va, vb, vc);
  if (!triangle.getBarycoord(hit.point, bary)) return 0;
  return attribute.getY(a) * bary.x + attribute.getY(b) * bary.y + attribute.getY(c) * bary.z;
}

/**
 * First intersection the user actually sees: surfaces that the reveal has made
 * (almost) transparent are skipped, and the epicardium, a thin film, only
 * counts where it carries fat.
 */
export function firstVisibleHit(picker, raycaster, objects, shared, options) {
  for (const hit of picker.intersect(raycaster, objects, options)) {
    const structure = hit.object.userData.structure;
    if (structure) {
      if (surfaceAlpha(hit.point, structure, shared) < 0.35) continue;
      if (hit.object.userData.key === 'epicardium' && epicardialFat(hit) < 0.45) continue;
    }
    return hit;
  }
  return null;
}

/**
 * `labelAt(clientX, clientY)` returns the structure whose 3D label is under
 * the pointer (labels do not capture the mouse, so a drag that starts on one
 * still rotates the heart; a click or a hover on one is resolved here).
 */
export function createInteraction({ canvas, camera, heart, conduction, shared, picker, labelAt = () => null, onHover, onSelect, onFocusPoint }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const client = { x: 0, y: 0 };
  let pointerInside = false;
  let dirty = false;
  let lastPick = 0;
  let hovered = null;
  let down = null;

  function setPointer(event) {
    client.x = event.clientX;
    client.y = event.clientY;
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  canvas.addEventListener('pointermove', (event) => {
    setPointer(event);
    pointerInside = true;
    dirty = true;
  });
  canvas.addEventListener('pointerleave', () => {
    pointerInside = false;
    if (hovered) {
      hovered = null;
      onHover(null);
    }
  });
  canvas.addEventListener('pointerdown', (event) => {
    down = { x: event.clientX, y: event.clientY, time: performance.now() };
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!down) return;
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    const quick = performance.now() - down.time < 450;
    down = null;
    if (moved > 6 || !quick) return;
    setPointer(event);
    const label = labelAt(client.x, client.y);
    if (label) {
      onSelect(label, null);
      return;
    }
    const hit = pick();
    onSelect(hit?.key ?? null, hit);
  });
  canvas.addEventListener('dblclick', (event) => {
    setPointer(event);
    const label = labelAt(client.x, client.y);
    if (label) {
      onFocusPoint?.(null, label);
      return;
    }
    const hit = pick();
    if (hit) onFocusPoint?.(hit.point, hit.key);
  });

  function pick() {
    raycaster.setFromCamera(pointer, camera);
    const hit = firstVisibleHit(picker, raycaster, [...heart.pickables(), ...conduction.pickables()], shared);
    return hit ? { key: hit.object.userData.key, point: hit.point.clone() } : null;
  }

  return {
    /** Hover picking, throttled (~20 per second, only after the pointer moved). */
    update(force = false) {
      if (!pointerInside) return;
      const now = performance.now();
      if (!(dirty || force) || now - lastPick < 50) return;
      if (down) return; // dragging the camera
      dirty = false;
      lastPick = now;
      const key = labelAt(client.x, client.y) ?? pick()?.key ?? null;
      if (key !== hovered) {
        hovered = key;
        onHover(key);
      }
    },
    pick,
  };
}

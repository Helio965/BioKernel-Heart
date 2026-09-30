import * as THREE from 'three';

/**
 * Pointer interaction with THREE.Raycaster.
 *
 *   hover  -> the structure under the pointer is highlighted (soft rim glow)
 *   click  -> selection (information card); click on empty space clears it
 *   double click -> the camera flies to that point (orbit target moves there)
 *
 * The rays are cast against picking proxies that share the blend-shape weights
 * of the visible meshes, so they follow the beating heart. Surfaces that the
 * reveal has made (almost) transparent are skipped: the ray goes through them
 * to what the user actually sees.
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

export function createInteraction({ canvas, camera, heart, conduction, shared, onHover, onSelect, onFocusPoint }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerInside = false;
  let dirty = false;
  let lastPick = 0;
  let hovered = null;
  let down = null;
  const triangle = new THREE.Triangle();
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  const tissue = new THREE.Vector4();

  function setPointer(event) {
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
    const hit = pick();
    onSelect(hit?.key ?? null, hit);
  });
  canvas.addEventListener('dblclick', (event) => {
    setPointer(event);
    const hit = pick();
    if (hit) onFocusPoint?.(hit.point, hit.key);
  });

  /** Fat weight of the epicardium at the hit point (from the tissue data). */
  function epicardialFat(hit) {
    const geometry = hit.object.geometry;
    const attribute = geometry.getAttribute('_tissue');
    if (!attribute || !hit.face) return 0;
    const { a, b, c } = hit.face;
    hit.object.getVertexPosition(a, va).applyMatrix4(hit.object.matrixWorld);
    hit.object.getVertexPosition(b, vb).applyMatrix4(hit.object.matrixWorld);
    hit.object.getVertexPosition(c, vc).applyMatrix4(hit.object.matrixWorld);
    triangle.set(va, vb, vc);
    const bary = triangle.getBarycoord(hit.point, new THREE.Vector3());
    if (!bary) return 0;
    const fa = attribute.getY(a);
    const fb = attribute.getY(b);
    const fc = attribute.getY(c);
    tissue.set(0, fa * bary.x + fb * bary.y + fc * bary.z, 0, 0);
    return tissue.y;
  }

  function pick() {
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects([...heart.pickables(), ...conduction.pickables()], false);
    for (const hit of hits) {
      const key = hit.object.userData.key;
      const structure = hit.object.userData.structure;
      if (structure) {
        if (surfaceAlpha(hit.point, structure, shared) < 0.35) continue;
        // The epicardium is a thin film: it is picked only where there is fat.
        if (key === 'epicardium' && epicardialFat(hit) < 0.45) continue;
      }
      return { key, point: hit.point.clone() };
    }
    return null;
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
      const hit = pick();
      const key = hit?.key ?? null;
      if (key !== hovered) {
        hovered = key;
        onHover(key);
      }
    },
    pick,
  };
}

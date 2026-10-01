import * as THREE from 'three';
import { STRUCTURES } from './anatomy.js';
import { firstVisibleHit } from './interaction.js';

/**
 * Labels anchored to the 3D anatomy.
 *
 * Anchors (a representative surface point + outward normal per structure) come
 * from the model pipeline and are moved by the same deformation field as the
 * heart, so labels follow the beat.
 *
 * To keep the screen readable and calm:
 *   - the hovered and the selected structures always get a label;
 *   - with the "Rótulos" layer on, a few automatic labels are chosen by
 *     priority and zoom (more detail the closer the camera), only for visible
 *     layers, only when the anchor faces the camera (or, for internal
 *     structures, once the reveal has opened the heart);
 *   - automatic labels are shown only when the structure is really in sight: a
 *     ray from the camera to the anchor must not meet another visible surface
 *     first;
 *   - labels whose boxes would overlap are dropped (greedy decluttering).
 *
 * Every one of those decisions is taken on the heart at rest (anchors and
 * surfaces without the beat), so they depend only on the camera: the beat
 * moves the labels but never switches them on and off. On top of that a label
 * appears only after it has been wanted for a moment and disappears only
 * after it has been unwanted for a moment, and the side it points to changes
 * only with a margin, so nothing blinks while the camera moves either.
 *
 * The labels never capture the mouse (dragging over them rotates the heart as
 * anywhere else); `labelAt(x, y)` lets the pointer handling pick a label.
 */

const MAX_AUTO = 11;
const OCCLUSION_BUDGET = 1.5; // ms of ray casting per frame (at least one ray)
const OCCLUSION_MAX_AGE = 400; // ms (the camera may have moved)
const OCCLUSION_TOLERANCE = 0.6; // cm: the anchor sits on the structure's own surface
const SHOW_DELAY = 0.18; // s a label must be wanted before it appears
const HIDE_DELAY = 0.45; // s a label must be unwanted before it disappears
const SIDE_SWITCH = 0.62; // fraction of the width where labels point left...
const SIDE_MARGIN = 0.06; // ...with this hysteresis

export function createLabels({ container, camera, heart, conduction, shared, picker }) {
  const anchors = heart.data.anchors;
  const items = new Map();
  let enabled = true;
  let hovered = null;
  let selected = null;

  for (const [key, anchor] of Object.entries(anchors)) {
    const info = STRUCTURES[key];
    if (!info) continue;
    const element = document.createElement('div');
    element.className = 'label';
    element.innerHTML = '<span class="label__dot"></span><span class="label__line"></span><span class="label__text"></span>';
    const text = element.querySelector('.label__text');
    text.textContent = shortName(info.name);
    container.append(element);
    items.set(key, {
      key,
      info,
      element,
      text,
      rest: new THREE.Vector3().fromArray(anchor.point),
      normal: new THREE.Vector3().fromArray(anchor.normal).normalize(),
      interior: anchor.interior,
      point: new THREE.Vector3(),
      screen: new THREE.Vector3(),
      restScreen: new THREE.Vector3(),
      wanted: false, // decision of this frame (at rest)
      visible: false, // what is on screen (after the delays)
      since: 0, // seconds since `wanted` last changed
      left: false,
      occluded: true,
      checkedAt: -Infinity,
    });
  }

  const dv = [0, 0, 0];
  const da = [0, 0, 0];
  const toCamera = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const direction = new THREE.Vector3();

  /** True when another visible surface is between the camera and the anchor (heart at rest). */
  function occluded(item) {
    const distance = direction.copy(item.rest).sub(camera.position).length();
    raycaster.set(camera.position, direction.divideScalar(distance));
    raycaster.far = distance - OCCLUSION_TOLERANCE;
    const hit = firstVisibleHit(picker, raycaster, [...heart.pickables(), ...conduction.pickables()], shared, { rest: true });
    return Boolean(hit && hit.object.userData.key !== item.key);
  }

  function deformed(item, cycle, out) {
    const p = item.rest.toArray();
    heart.field.ventricularSystole(p, dv);
    heart.field.atrialSystole(p, da);
    return out.set(
      p[0] + dv[0] * cycle.ventricular + da[0] * cycle.atrial,
      p[1] + dv[1] * cycle.ventricular + da[1] * cycle.atrial,
      p[2] + dv[2] * cycle.ventricular + da[2] * cycle.atrial,
    );
  }

  function layerShown(key) {
    const info = STRUCTURES[key];
    if (info.layer === 'conduction') return conduction.group.visible;
    const structure = heart.structures.get(key);
    return structure ? structure.layerOpacity > 0.5 : false;
  }

  const toPixels = (ndc, width, height) => [(ndc.x * 0.5 + 0.5) * width, (-ndc.y * 0.5 + 0.5) * height];

  return {
    setEnabled(on) {
      enabled = on;
    },
    setHovered(key) {
      hovered = key;
    },
    setSelected(key) {
      selected = key;
    },
    /** Current (deformed) anchor of a structure, used to focus the camera. */
    anchorPoint(key, cycle) {
      const item = items.get(key);
      return item ? deformed(item, cycle, new THREE.Vector3()) : null;
    },
    /** State of every label (for tests and debugging). */
    inspect() {
      return [...items.values()].map(({ key, wanted, visible, occluded, candidate }) => ({ key, wanted, visible, occluded, candidate }));
    },
    /** Key of the visible label whose text is under the client point, or null. */
    labelAt(clientX, clientY) {
      for (const item of items.values()) {
        if (!item.visible) continue;
        const r = item.text.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return item.key;
      }
      return null;
    },
    update(delta, cycle, view) {
      const width = container.clientWidth;
      const height = container.clientHeight;
      const progress = view.progress;
      const distance = view.distance;
      const candidates = [];
      const stale = [];
      const now = performance.now();

      // 1. Which labels could be shown (heart at rest: independent of the beat).
      for (const item of items.values()) {
        item.candidate = false;
        const forced = item.key === hovered || item.key === selected;
        let wanted = forced;
        if (!forced && enabled && layerShown(item.key) && !heart.isolated) {
          const priority = item.info.priority ?? 3;
          const zoomOk = priority === 1 ? true : priority === 2 ? distance < 31 : distance < 19;
          const revealOk = item.interior ? progress > 2.7 : progress < 3.2;
          wanted = zoomOk && revealOk;
        }
        if (!wanted) continue;
        toCamera.copy(camera.position).sub(item.rest).normalize();
        if (!forced && !item.interior && item.normal.dot(toCamera) < 0.2) continue;
        item.restScreen.copy(item.rest).project(camera);
        const s = item.restScreen;
        if (s.z > 1 || Math.abs(s.x) > 1.05 || Math.abs(s.y) > 1.05) continue;
        const [x, y] = toPixels(s, width, height);
        if (!forced && now - item.checkedAt > OCCLUSION_MAX_AGE) stale.push(item);
        // Labels already on screen keep their place (bonus), so they do not
        // swap with a neighbour of similar score.
        const score = (forced ? -10 : 0) + (item.info.priority ?? 3) + Math.hypot(s.x, s.y) * 0.8 - (item.visible ? 0.6 : 0);
        candidates.push({ item, x, y, forced, score });
      }

      // 2. Occlusion (oldest results first, within a small time budget).
      stale.sort((a, b) => a.checkedAt - b.checkedAt);
      for (const item of stale) {
        item.occluded = occluded(item);
        item.checkedAt = now;
        if (performance.now() - now > OCCLUSION_BUDGET) break;
      }

      // 3. Decluttering on the rest positions.
      candidates.sort((a, b) => a.score - b.score);
      const placed = [];
      let autoCount = 0;
      for (const c of candidates) {
        if (!c.forced && c.item.occluded) continue;
        if (!c.forced && autoCount >= MAX_AUTO) continue;
        // Preferred side: towards the outside of the screen (with hysteresis);
        // if that box collides, the label may point to the other side.
        const threshold = width * (SIDE_SWITCH + (c.item.visible ? (c.item.left ? -SIDE_MARGIN : SIDE_MARGIN) : 0));
        const preferLeft = c.x > threshold;
        const w = (c.item.width ?? 24 + c.item.text.textContent.length * 6.3) + 26;
        let chosen = null;
        for (const left of [preferLeft, !preferLeft]) {
          const box = { x0: left ? c.x - w : c.x - 4, x1: left ? c.x + 4 : c.x + w, y0: c.y - 12, y1: c.y + 12 };
          if (box.x0 < 0 || box.x1 > width) continue;
          if (!c.forced && placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue;
          chosen = { left, box };
          break;
        }
        if (!chosen && c.forced) chosen = { left: preferLeft, box: { x0: c.x, x1: c.x, y0: c.y, y1: c.y } };
        if (!chosen) continue;
        if (!c.forced) autoCount++;
        placed.push(chosen.box);
        c.item.candidate = true;
        c.item.forced = c.forced;
        c.item.nextLeft = chosen.left;
      }

      // 4. Delays: appear after SHOW_DELAY, disappear after HIDE_DELAY
      //    (hovered and selected labels react at once).
      for (const item of items.values()) {
        if (item.candidate !== item.wanted) {
          item.wanted = item.candidate;
          item.since = 0;
        } else {
          item.since += delta;
        }
        const immediate = item.key === hovered || item.key === selected;
        if (item.wanted && !item.visible && (immediate || item.since >= SHOW_DELAY)) item.visible = true;
        if (!item.wanted && item.visible && (immediate || item.since >= HIDE_DELAY)) item.visible = false;
        if (item.visible && item.wanted) item.left = item.nextLeft;
      }

      // 5. Draw at the current (beating) position.
      for (const item of items.values()) if (item.visible && item.measured === undefined) item.measured = item.element.offsetWidth;
      for (const item of items.values()) {
        const el = item.element;
        el.classList.toggle('is-visible', item.visible);
        el.classList.toggle('is-hover', item.key === hovered);
        el.classList.toggle('is-selected', item.key === selected);
        if (!item.visible) continue;
        if (item.measured) item.width = item.measured - 26;
        deformed(item, cycle, item.point);
        item.screen.copy(item.point).project(camera);
        const [x, y] = toPixels(item.screen, width, height);
        el.classList.toggle('label--left', item.left);
        const offsetX = item.left ? -item.measured + 3 : -3;
        el.style.transform = `translate(${(x + offsetX).toFixed(1)}px, ${(y - 10).toFixed(1)}px)`;
      }
    },
  };
}

/** Shorter names for the labels ("Valva mitral · folheto anterior" stays). */
function shortName(name) {
  return name.replace(/\s*\((DA|DP)\)$/, ' ($1)');
}

import * as THREE from 'three';
import { STRUCTURES } from './anatomy.js';

/**
 * Labels anchored to the 3D anatomy.
 *
 * Anchors (a representative surface point + outward normal per structure) come
 * from the model pipeline and are moved by the same deformation field as the
 * heart, so labels follow the beat.
 *
 * To keep the screen readable:
 *   - the hovered and the selected structures always get a label;
 *   - with the "Rótulos" layer on, a few automatic labels are chosen by
 *     priority and zoom (more detail the closer the camera), only for visible
 *     layers, only when the anchor faces the camera (or, for internal
 *     structures, once the reveal has opened the heart);
 *   - labels whose boxes would overlap are dropped (greedy decluttering).
 */

const MAX_AUTO = 11;

export function createLabels({ container, camera, heart, conduction, onPick }) {
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
    element.querySelector('.label__text').textContent = shortName(info.name);
    const text = element.querySelector('.label__text');
    text.style.pointerEvents = 'auto';
    text.style.cursor = 'pointer';
    text.addEventListener('click', () => onPick(key));
    container.append(element);
    items.set(key, {
      key,
      info,
      element,
      rest: new THREE.Vector3().fromArray(anchor.point),
      normal: new THREE.Vector3().fromArray(anchor.normal).normalize(),
      interior: anchor.interior,
      point: new THREE.Vector3(),
      screen: new THREE.Vector3(),
      visible: false,
      width: 24 + shortName(info.name).length * 6.3,
      left: false,
    });
  }

  const dv = [0, 0, 0];
  const da = [0, 0, 0];
  const toCamera = new THREE.Vector3();

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
    update(delta, cycle, view) {
      const width = container.clientWidth;
      const height = container.clientHeight;
      const progress = view.progress;
      const distance = view.distance;
      const candidates = [];

      for (const item of items.values()) {
        const forced = item.key === hovered || item.key === selected;
        let wanted = forced;
        if (!forced && enabled && layerShown(item.key) && !heart.isolated) {
          const priority = item.info.priority ?? 3;
          const zoomOk = priority === 1 ? true : priority === 2 ? distance < 31 : distance < 19;
          const revealOk = item.interior ? progress > 2.7 : progress < 3.2;
          wanted = zoomOk && revealOk;
        }
        if (!wanted) {
          item.visible = false;
          continue;
        }
        deformed(item, cycle, item.point);
        toCamera.copy(camera.position).sub(item.point).normalize();
        if (!forced && !item.interior && item.normal.dot(toCamera) < 0.2) {
          item.visible = false;
          continue;
        }
        item.screen.copy(item.point).project(camera);
        if (item.screen.z > 1 || Math.abs(item.screen.x) > 1.05 || Math.abs(item.screen.y) > 1.05) {
          item.visible = false;
          continue;
        }
        const x = (item.screen.x * 0.5 + 0.5) * width;
        const y = (-item.screen.y * 0.5 + 0.5) * height;
        const centerDistance = Math.hypot(item.screen.x, item.screen.y);
        candidates.push({ item, x, y, forced, score: (forced ? -10 : 0) + (item.info.priority ?? 3) + centerDistance * 0.8 });
      }

      candidates.sort((a, b) => a.score - b.score);
      const placed = [];
      let autoCount = 0;
      for (const c of candidates) {
        const left = c.x > width * 0.62;
        const w = c.item.width + 26;
        const box = { x0: left ? c.x - w : c.x - 4, x1: left ? c.x + 4 : c.x + w, y0: c.y - 11, y1: c.y + 11 };
        const overlaps = placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0);
        if (!c.forced && (overlaps || autoCount >= MAX_AUTO)) {
          c.item.visible = false;
          continue;
        }
        if (!c.forced) autoCount++;
        placed.push(box);
        c.item.visible = true;
        c.item.left = left;
        c.item.x = c.x;
        c.item.y = c.y;
      }

      // Measure once (reads before writes: no layout thrashing).
      for (const item of items.values()) if (item.visible && item.measured === undefined) item.measured = item.element.offsetWidth;
      for (const item of items.values()) {
        const el = item.element;
        el.classList.toggle('is-visible', item.visible);
        el.classList.toggle('is-hover', item.key === hovered);
        el.classList.toggle('is-selected', item.key === selected);
        if (!item.visible) continue;
        el.classList.toggle('label--left', item.left);
        const offsetX = item.left ? -item.measured + 3 : -3;
        el.style.transform = `translate(${(item.x + offsetX).toFixed(1)}px, ${(item.y - 10).toFixed(1)}px)`;
      }
    },
  };
}

/** Shorter names for the labels ("Valva mitral · folheto anterior" stays). */
function shortName(name) {
  return name.replace(/\s*\((DA|DP)\)$/, ' ($1)');
}

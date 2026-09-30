import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

import { STRUCTURES } from './anatomy.js';
import { createCardiacField } from './cardiacField.js';
import { createTissueMaterial, createDepthPrepassMaterial, familyOf, setMaterialLevel } from './materials.js';
import { valveOf, valveBlend } from './valves.js';

const MODEL_BASE = 'assets/models/heart-base.glb';
const MODEL_DETAIL = 'assets/models/heart-detail.glb';
const MODEL_DATA = 'assets/models/heart-data.json';

/**
 * The anatomical heart: loads the BodyParts3D-derived model (see
 * docs/MODEL_LICENSE.md), gives every structure its material and exposes
 * what the other systems need (layers, selection, isolation, blend shapes).
 */
export async function createHeart({ shared, onProgress = () => {} }) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);

  const [data, gltf] = await Promise.all([
    fetch(MODEL_DATA).then((r) => {
      if (!r.ok) throw new Error(`${MODEL_DATA}: HTTP ${r.status}`);
      return r.json();
    }),
    loader.loadAsync(MODEL_BASE, (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    }),
  ]);

  const field = createCardiacField(data.frames);
  shared.uApex.value.fromArray(data.frames.longAxis.apex);
  shared.uLongAxis.value.fromArray(field.axis);

  const group = new THREE.Group();
  group.name = 'Heart';

  /** @type {Map<string, {key, info, layer, meshes: THREE.Mesh[], depthMeshes: THREE.Mesh[], material: THREE.Material, uniforms}>} */
  const structures = new Map();
  const meshesByName = new Map();
  const fadeCapable = [];

  const nodes = [];
  gltf.scene.traverse((object) => {
    if (object.isMesh) nodes.push(object);
  });

  for (const mesh of nodes) {
    const key = mesh.userData.key ?? mesh.name;
    const info = STRUCTURES[key];
    if (!info) {
      console.warn(`[heart] mesh without catalogue entry: ${mesh.name}`);
      continue;
    }
    let structure = structures.get(key);
    if (!structure) {
      const material = createTissueMaterial(info.material, shared);
      structure = {
        key,
        info,
        layer: info.layer,
        family: familyOf(info.material),
        meshes: [],
        depthMeshes: [],
        material,
        uniforms: material.userData.uniforms,
        layerOpacity: 1,
        layerTarget: 1,
        highlight: 0,
        highlightTarget: 0,
        dim: 0,
        dimTarget: 0,
      };
      structure.canFade = Boolean(structure.family.fade && !structure.family.transparentAlways);
      structures.set(key, structure);
      if (structure.canFade) fadeCapable.push(structure);
    }

    // Keep the node transform (quantisation scale/offset) on the mesh itself.
    mesh.updateWorldMatrix(true, false);
    const placed = new THREE.Mesh(mesh.geometry, structure.material);
    placed.name = mesh.name;
    mesh.matrixWorld.decompose(placed.position, placed.quaternion, placed.scale);
    placed.morphTargetDictionary = mesh.morphTargetDictionary;
    placed.morphTargetInfluences = mesh.morphTargetInfluences;
    placed.userData.key = key;
    placed.renderOrder = structure.family.order ?? 0;
    placed.castShadow = !['blood', 'fat'].includes(structure.family.kind);
    placed.receiveShadow = true;
    placed.frustumCulled = false; // blend shapes move vertices outside the bounds
    group.add(placed);
    structure.meshes.push(placed);
    meshesByName.set(mesh.name, placed);

    if (fadeCapable.includes(structure)) {
      const depth = new THREE.Mesh(mesh.geometry, createDepthPrepassMaterial(structure.material, shared));
      depth.position.copy(placed.position);
      depth.quaternion.copy(placed.quaternion);
      depth.scale.copy(placed.scale);
      depth.morphTargetDictionary = placed.morphTargetDictionary;
      depth.morphTargetInfluences = placed.morphTargetInfluences;
      depth.visible = false;
      depth.renderOrder = -1;
      depth.frustumCulled = false;
      depth.userData.depthOf = placed;
      group.add(depth);
      structure.depthMeshes.push(depth);
    }
  }

  // Valve blend shapes: which valve drives each mesh.
  for (const s of structures.values()) for (const m of s.meshes) m.userData.valve = valveOf(m.userData.key);

  // -------------------------------------------------------------------------
  // Levels of detail (base geometry now, subdivided geometry on demand)
  // -------------------------------------------------------------------------
  const baseGeometry = new Map([...meshesByName].map(([name, mesh]) => [name, captureGeometry(mesh)]));
  let detailGeometry = null;
  let detailLoading = null;
  let usingDetail = false;

  function captureGeometry(mesh) {
    return { geometry: mesh.geometry, position: mesh.position.clone(), quaternion: mesh.quaternion.clone(), scale: mesh.scale.clone() };
  }
  function applyGeometry(table) {
    for (const [name, mesh] of meshesByName) {
      const entry = table.get(name);
      if (!entry) continue;
      mesh.geometry = entry.geometry;
      mesh.position.copy(entry.position);
      mesh.quaternion.copy(entry.quaternion);
      mesh.scale.copy(entry.scale);
      const structure = structures.get(mesh.userData.key);
      for (const depth of structure?.depthMeshes ?? []) {
        if (depth.userData.depthOf !== mesh) continue;
        depth.geometry = entry.geometry;
        depth.position.copy(entry.position);
        depth.quaternion.copy(entry.quaternion);
        depth.scale.copy(entry.scale);
      }
    }
  }
  async function loadDetail(onDetailProgress) {
    if (detailGeometry) return true;
    if (!detailLoading) {
      detailLoading = loader
        .loadAsync(MODEL_DETAIL, (event) => {
          if (event.lengthComputable) onDetailProgress?.(event.loaded / event.total);
        })
        .then((detail) => {
          const table = new Map();
          detail.scene.updateMatrixWorld(true);
          detail.scene.traverse((object) => {
            if (!object.isMesh) return;
            const entry = { geometry: object.geometry, position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3() };
            object.matrixWorld.decompose(entry.position, entry.quaternion, entry.scale);
            table.set(object.name, entry);
          });
          detailGeometry = table;
          return true;
        })
        .catch((error) => {
          console.warn('[heart] detail model not available:', error);
          return false;
        });
    }
    return detailLoading;
  }
  function useDetail(on) {
    if (on && !detailGeometry) return false;
    if (on === usingDetail) return true;
    applyGeometry(on ? detailGeometry : baseGeometry);
    usingDetail = on;
    return true;
  }

  // -------------------------------------------------------------------------
  // State updates
  // -------------------------------------------------------------------------
  let translucent = false;
  function setTranslucent(on) {
    if (on === translucent) return;
    translucent = on;
    for (const s of fadeCapable) {
      s.material.transparent = on;
      s.material.depthWrite = !on;
      s.material.needsUpdate = true;
      for (const d of s.depthMeshes) d.visible = on && s.layerOpacity > 0.01;
    }
  }

  const layerState = new Map();
  function setLayerVisible(layer, visible) {
    layerState.set(layer, visible);
    for (const s of structures.values()) if (s.layer === layer) s.layerTarget = visible ? 1 : 0;
  }

  let hovered = null;
  let selected = null;
  let isolated = null;
  // Global fade used by the opening animation (independent of the layers,
  // so switching layers during the intro is never overridden).
  let introFade = 1;
  function setHovered(key) {
    hovered = key;
  }
  function setSelected(key) {
    selected = key;
  }
  function setIsolated(key) {
    isolated = key;
  }

  /**
   * Valves, chordae and papillary muscles have no reveal fade, so they are
   * normally opaque; while an isolation dims them they switch to their
   * see-through variant. `setGhosts` forces that variant (to precompile it).
   */
  function setGhost(s, on) {
    if (s.canFade || s.family.transparentAlways || s.material.transparent === on) return;
    s.material.transparent = on;
    s.material.depthWrite = !on;
    s.material.needsUpdate = true;
  }
  function setGhosts(on) {
    for (const s of structures.values()) setGhost(s, on);
  }

  const setInfluence = (mesh, name, value) => {
    const index = mesh.morphTargetDictionary?.[name];
    if (index !== undefined) mesh.morphTargetInfluences[index] = value;
  };

  /**
   * @param {number} delta seconds
   * @param cycle state from js/heartbeat.js
   * @param {number} cameraDistance distance camera -> target (cm)
   */
  function update(delta, cycle, cameraDistance) {
    const k = 1 - Math.exp(-delta / 0.18);
    const blends = {};
    for (const [valve, opening] of Object.entries(cycle.valves)) blends[valve] = valveBlend(opening);

    // Semantic level of detail: small branches appear as the camera gets closer.
    const smallBranches = THREE.MathUtils.smoothstep(34 - cameraDistance, 0, 8);

    for (const s of structures.values()) {
      s.layerOpacity += (s.layerTarget - s.layerOpacity) * k;
      if (Math.abs(s.layerTarget - s.layerOpacity) < 0.002) s.layerOpacity = s.layerTarget;
      const isHovered = hovered === s.key;
      const isSelected = selected === s.key;
      s.highlight += ((isHovered && !isSelected ? 1 : 0) - s.highlight) * k;
      s.dimTarget = isolated && isolated !== s.key ? 1 : 0;
      s.dim += (s.dimTarget - s.dim) * k;
      setGhost(s, s.dim > 0.01);
      const u = s.uniforms;
      u.uLayerOpacity.value = s.layerOpacity * introFade;
      u.uHighlight.value = s.highlight;
      u.uSelected.value += ((isSelected ? 1 : 0) - u.uSelected.value) * k;
      u.uDim.value = s.dim;
      u.uDetailFade.value = s.info.detail >= 3 ? 0.25 + 0.75 * smallBranches : 1;
      const visible = s.layerOpacity * introFade > 0.003;
      for (const mesh of s.meshes) {
        mesh.visible = visible;
        setInfluence(mesh, 'ventricularSystole', cycle.ventricular);
        setInfluence(mesh, 'atrialSystole', cycle.atrial);
        setInfluence(mesh, 'arterialDistension', cycle.distension);
        const valve = mesh.userData.valve;
        if (valve) {
          setInfluence(mesh, 'valveHalf', blends[valve][0]);
          setInfluence(mesh, 'valveOpen', blends[valve][1]);
        }
      }
      for (const d of s.depthMeshes) d.visible = translucent && visible;
    }
  }

  // Picking proxies: the base geometry (fewer triangles than the detail level)
  // with the same transform and the same blend-shape weights, so the
  // Raycaster follows the beating heart. They are never rendered.
  const pickMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const proxies = [];
  for (const [name, mesh] of meshesByName) {
    const entry = baseGeometry.get(name);
    const proxy = new THREE.Mesh(entry.geometry, pickMaterial);
    proxy.position.copy(entry.position);
    proxy.quaternion.copy(entry.quaternion);
    proxy.scale.copy(entry.scale);
    proxy.updateMatrixWorld(true);
    proxy.morphTargetDictionary = mesh.morphTargetDictionary;
    proxy.morphTargetInfluences = mesh.morphTargetInfluences;
    proxy.userData.key = mesh.userData.key;
    proxy.userData.structure = structures.get(mesh.userData.key);
    proxies.push(proxy);
  }

  /** Picking proxies of the structures that are currently shown. */
  function pickables() {
    return proxies.filter((p) => p.userData.structure.layerOpacity > 0.5);
  }

  function setMaterialQuality(level) {
    for (const s of structures.values()) setMaterialLevel(s.material, level);
  }

  return {
    group,
    data,
    field,
    structures,
    setMaterialQuality,
    loadDetail,
    useDetail,
    get usingDetail() {
      return usingDetail;
    },
    setTranslucent,
    setGhosts,
    get translucent() {
      return translucent;
    },
    setLayerVisible,
    layerState,
    get introFade() {
      return introFade;
    },
    set introFade(value) {
      introFade = value;
    },
    /** True while a layer is cross-fading (needs translucent rendering). */
    get fading() {
      if (introFade < 0.997) return true;
      for (const s of structures.values()) if (s.layerOpacity > 0.003 && s.layerOpacity < 0.997) return true;
      return false;
    },
    setHovered,
    setSelected,
    setIsolated,
    get isolated() {
      return isolated;
    },
    update,
    pickables,
  };
}

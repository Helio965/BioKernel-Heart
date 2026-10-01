import * as THREE from 'three';
import {
  tissueVertexPars,
  tissueVertexMain,
  tissueFragmentPars,
  tissueColorChunk,
  tissueAlphaChunk,
  tissueRoughnessChunk,
  tissueNormalChunk,
  tissueAoChunk,
  tissueEmissiveChunk,
  depthFragmentPars,
  depthFragmentMain,
} from './shaders.js';

/** Shading families (uTissueKind in the shaders). */
export const TISSUE_KIND = { muscle: 0, fat: 1, vessel: 2, valve: 3, blood: 4 };

/**
 * PBR parameters per family. Colours are sRGB, chosen from the reference
 * dissections (fresh myocardium is dark red-brown, the great vessels are pale,
 * valves are yellowish-white, epicardial fat is yellow).
 *
 * fade*: when the structure becomes translucent during the zoom reveal
 * (reveal progress 0 = exterior ... 4 = interior).
 */
const FAMILIES = {
  myocardium: {
    kind: 'muscle',
    color: '#5c1917',
    roughness: 0.5,
    clearcoat: 0.34,
    clearcoatRoughness: 0.26,
    sheen: 0.2,
    sheenColor: '#ff6a5c',
    sheenRoughness: 0.55,
    sss: 0.3,
    sssColor: '#ff2a1a',
    bump: 1,
    fade: [2.0, 2.95],
    minAlpha: 0.06,
    rimAlpha: 0.32,
    order: 1,
  },
  atrium: {
    kind: 'muscle',
    color: '#661b1d',
    roughness: 0.48,
    clearcoat: 0.34,
    clearcoatRoughness: 0.26,
    sheen: 0.22,
    sheenColor: '#ff7466',
    sheenRoughness: 0.55,
    sss: 0.5,
    sssColor: '#ff3322',
    bump: 0.9,
    fade: [2.0, 2.95],
    minAlpha: 0.06,
    rimAlpha: 0.32,
    order: 1,
  },
  papillary: {
    kind: 'muscle',
    color: '#7a2125',
    roughness: 0.4,
    clearcoat: 0.45,
    clearcoatRoughness: 0.25,
    sheen: 0.4,
    sheenColor: '#ff7466',
    sheenRoughness: 0.5,
    sss: 0.45,
    sssColor: '#ff3322',
    bump: 0.8,
    order: 0,
  },
  epicardium: {
    kind: 'fat',
    color: '#8a3035',
    roughness: 0.36,
    clearcoat: 0.62,
    clearcoatRoughness: 0.16,
    sheen: 0.22,
    sheenColor: '#ffd9a0',
    sheenRoughness: 0.4,
    sss: 0.55,
    sssColor: '#ffb45a',
    bump: 1,
    fade: [1.15, 1.95],
    minAlpha: 0,
    rimAlpha: 0.05,
    order: 5,
    transparentAlways: true,
    userMinAlpha: 0,
  },
  artery: {
    kind: 'vessel',
    color: '#8e1a21',
    roughness: 0.38,
    clearcoat: 0.5,
    clearcoatRoughness: 0.22,
    sheen: 0.3,
    sheenColor: '#ff6b6b',
    sheenRoughness: 0.4,
    sss: 0.3,
    sssColor: '#ff2020',
    bump: 0.6,
    fade: [3.0, 3.8],
    minAlpha: 0.35,
    rimAlpha: 0.6,
    order: 3,
    userMinAlpha: 0.4,
  },
  vein: {
    kind: 'vessel',
    color: '#34295f',
    roughness: 0.38,
    clearcoat: 0.5,
    clearcoatRoughness: 0.22,
    sheen: 0.3,
    sheenColor: '#8a86ff',
    sheenRoughness: 0.4,
    sss: 0.3,
    sssColor: '#5040ff',
    bump: 0.6,
    fade: [3.0, 3.8],
    minAlpha: 0.35,
    rimAlpha: 0.6,
    order: 3,
    userMinAlpha: 0.4,
  },
  greatArtery: {
    kind: 'vessel',
    color: '#c4907f',
    roughness: 0.5,
    clearcoat: 0.4,
    clearcoatRoughness: 0.3,
    sheen: 0.35,
    sheenColor: '#ffe0d0',
    sheenRoughness: 0.5,
    sss: 0.25,
    sssColor: '#ff7050',
    bump: 0.5,
    fade: [2.2, 3.1],
    minAlpha: 0.1,
    rimAlpha: 0.35,
    order: 2,
  },
  pulmonaryArtery: {
    kind: 'vessel',
    color: '#b98a93',
    roughness: 0.5,
    clearcoat: 0.4,
    clearcoatRoughness: 0.3,
    sheen: 0.35,
    sheenColor: '#f4dcea',
    sheenRoughness: 0.5,
    sss: 0.22,
    sssColor: '#e06080',
    bump: 0.5,
    fade: [2.2, 3.1],
    minAlpha: 0.1,
    rimAlpha: 0.35,
    order: 2,
  },
  greatVein: {
    kind: 'vessel',
    color: '#4a3c6c',
    roughness: 0.44,
    clearcoat: 0.45,
    clearcoatRoughness: 0.3,
    sheen: 0.35,
    sheenColor: '#b3a8ff',
    sheenRoughness: 0.5,
    sss: 0.35,
    sssColor: '#6040ff',
    bump: 0.5,
    fade: [2.2, 3.1],
    minAlpha: 0.1,
    rimAlpha: 0.35,
    order: 2,
  },
  pulmonaryVein: {
    kind: 'vessel',
    color: '#96505a',
    roughness: 0.44,
    clearcoat: 0.45,
    clearcoatRoughness: 0.3,
    sheen: 0.35,
    sheenColor: '#ffb0a0',
    sheenRoughness: 0.5,
    sss: 0.35,
    sssColor: '#ff4030',
    bump: 0.5,
    fade: [2.2, 3.1],
    minAlpha: 0.1,
    rimAlpha: 0.35,
    order: 2,
  },
  valve: {
    kind: 'valve',
    color: '#e7d6b3',
    roughness: 0.5,
    clearcoat: 0.6,
    clearcoatRoughness: 0.3,
    sheen: 0.5,
    sheenColor: '#fff2d8',
    sheenRoughness: 0.5,
    sss: 0.9,
    sssColor: '#ffb08a',
    bump: 0.7,
    order: 0,
  },
  chordae: {
    kind: 'valve',
    color: '#f0e6d2',
    roughness: 0.38,
    clearcoat: 0.7,
    clearcoatRoughness: 0.2,
    sheen: 0.4,
    sheenColor: '#ffffff',
    sheenRoughness: 0.4,
    sss: 0.7,
    sssColor: '#ffc0a0',
    bump: 0.3,
    order: 0,
  },
  bloodOxy: {
    kind: 'blood',
    color: '#c0121f',
    roughness: 0.12,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    sheen: 0,
    sss: 0.8,
    sssColor: '#ff1010',
    bump: 0,
    fade: [3.1, 3.9],
    minAlpha: 0.45,
    rimAlpha: 0.2,
    baseAlpha: 0.34,
    order: 4,
    transparentAlways: true,
    userMinAlpha: 0.5,
  },
  bloodDeoxy: {
    kind: 'blood',
    color: '#5a1c5e',
    roughness: 0.12,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    sheen: 0,
    sss: 0.8,
    sssColor: '#6030ff',
    bump: 0,
    fade: [3.1, 3.9],
    minAlpha: 0.45,
    rimAlpha: 0.2,
    baseAlpha: 0.34,
    order: 4,
    transparentAlways: true,
    userMinAlpha: 0.5,
  },
};

/**
 * Creates the uniforms shared by every tissue material (one object, so a
 * single assignment per frame updates all of them).
 */
export function createSharedUniforms() {
  return {
    uTime: { value: 0 },
    uCameraPos: { value: new THREE.Vector3() },
    uTarget: { value: new THREE.Vector3() },
    uRevealProgress: { value: 0 },
    uRevealEnabled: { value: 1 },
    uWindowRadius: { value: 6 },
    uUserTransparency: { value: 0 },
    uNearFade: { value: new THREE.Vector2(0.35, 1.4) },
    uMicroDetail: { value: 1 },
    uElectrical: { value: 0 },
    uSinceP: { value: 0 },
    uQTime: { value: 0 },
    uQT: { value: 380 },
    uApex: { value: new THREE.Vector3() },
    uLongAxis: { value: new THREE.Vector3(0, 1, 0) },
    uVesselGlow: { value: 0 },
    uKeyLightView: { value: new THREE.Vector3(0.3, 0.6, 0.7) },
  };
}

/** Everything a structure's material needs to know. */
export function familyOf(material) {
  return FAMILIES[material] ?? FAMILIES.myocardium;
}

/**
 * Shading cost level (quality profiles):
 *   full      clearcoat (wet film) + sheen (velvety scattering)
 *   standard  clearcoat only
 *   lite      plain PBR (no extra lobes)
 * Three.js compiles the extra lobes only when they are > 0, so this really
 * removes work from the fragment shader.
 */
export function setMaterialLevel(material, level) {
  const family = material.userData.family;
  const clearcoat = level === 'lite' ? 0 : family.clearcoat;
  const sheen = level === 'full' ? family.sheen ?? 0 : 0;
  if (material.clearcoat !== clearcoat || material.sheen !== sheen) {
    material.clearcoat = clearcoat;
    material.sheen = sheen;
    material.needsUpdate = true;
  }
}

export function createTissueMaterial(materialName, shared) {
  const family = familyOf(materialName);
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(family.color),
    roughness: family.roughness,
    metalness: 0,
    clearcoat: family.clearcoat,
    clearcoatRoughness: family.clearcoatRoughness,
    sheen: family.sheen ?? 0,
    sheenColor: new THREE.Color(family.sheenColor ?? '#ffffff'),
    sheenRoughness: family.sheenRoughness ?? 0.5,
    side: THREE.DoubleSide,
    transparent: Boolean(family.transparentAlways),
    depthWrite: !family.transparentAlways,
  });
  const fade = family.fade ?? [99, 100];
  const own = {
    uFadeStart: { value: fade[0] },
    uFadeEnd: { value: fade[1] },
    uMinAlpha: { value: family.minAlpha ?? 1 },
    uRimAlpha: { value: family.rimAlpha ?? 0 },
    uUserMinAlpha: { value: family.userMinAlpha ?? (family.fade ? 0.08 : 1) },
    uBaseAlpha: { value: family.baseAlpha ?? 1 },
    uLayerOpacity: { value: 1 },
    uDim: { value: 0 },
    uHighlight: { value: 0 },
    uSelected: { value: 0 },
    uDetailFade: { value: 1 },
    uTissueKind: { value: TISSUE_KIND[family.kind] },
    uBumpStrength: { value: family.bump ?? 0 },
    uSSS: { value: family.sss ?? 0 },
    uSSSColor: { value: new THREE.Color(family.sssColor ?? '#ff3020') },
    uHighlightColor: { value: new THREE.Color('#ffd0b0') },
  };
  material.userData.family = family;
  material.userData.uniforms = own;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, own);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${tissueVertexPars}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${tissueVertexMain}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${tissueFragmentPars}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${tissueColorChunk}\n${tissueAlphaChunk}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${tissueRoughnessChunk}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${tissueNormalChunk}`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${tissueAoChunk}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${tissueEmissiveChunk}`);
  };
  // Every structure gets its own material instance (own uniforms), but they
  // all compile to the same few programs.
  material.customProgramCacheKey = () => 'heart-tissue-v1';
  return material;
}

/** Depth-only pre-pass material that mirrors the reveal alpha of `source`. */
export function createDepthPrepassMaterial(source, shared) {
  const material = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, source.userData.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 _tissue;\nvarying vec3 vWorldPos;`)
      .replace('#include <project_vertex>', `#include <project_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${depthFragmentPars}`)
      .replace('void main() {', `void main() {\n${depthFragmentMain}`);
  };
  material.customProgramCacheKey = () => 'heart-depth-v1';
  return material;
}

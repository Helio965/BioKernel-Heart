import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

/**
 * WebGL 2 renderer. Like the Black-Hole project it asks for the dedicated
 * GPU (powerPreference: 'high-performance'); the operating system has the last
 * word, see README.
 */
export function createRenderer(canvas) {
  try {
    const context = canvas.getContext('webgl2', { powerPreference: 'high-performance', antialias: false, alpha: false });
    if (!context) throw new Error('WebGL 2 is not available');
    const renderer = new THREE.WebGLRenderer({
      canvas,
      context,
      antialias: false, // anti-aliasing happens in the composer's multisampled target
      powerPreference: 'high-performance',
    });
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.setClearColor(0x050203, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.82;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    return renderer;
  } catch (error) {
    console.error('WebGL initialisation failed:', error);
    document.getElementById('fallback').hidden = false;
    document.getElementById('loader').hidden = true;
    return null;
  }
}

/** Dark background with a faint warm glow behind the heart. */
function createBackground() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  const gradient = g.createRadialGradient(size / 2, size * 0.46, 0, size / 2, size / 2, size * 0.72);
  gradient.addColorStop(0, '#2a0c10');
  gradient.addColorStop(0.45, '#12050a');
  gradient.addColorStop(1, '#030102');
  g.fillStyle = gradient;
  g.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Studio-like lighting for wet tissue: an image-based environment for the
 * reflections, a warm key light with soft shadows, a cool rim light for the
 * silhouette, a large soft area light and a hemisphere fill. Key, rim and area
 * lights follow the camera, so the heart stays well lit from every angle.
 */
export function createLighting(renderer, scene, camera) {
  scene.background = createBackground();

  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();

  RectAreaLightUniformsLib.init();

  const rig = new THREE.Group();
  rig.name = 'LightRig';
  camera.add(rig);
  scene.add(camera);

  // Directions in camera space (from the lit point towards the light).
  const KEY_DIR = new THREE.Vector3(0.36, 0.52, 0.78).normalize(); // front, upper right
  const RIM_DIR = new THREE.Vector3(-0.42, 0.34, -0.84).normalize(); // behind, upper left

  const key = new THREE.DirectionalLight(0xfff1e6, 2.4);
  key.castShadow = true;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 80;
  const extent = 13;
  Object.assign(key.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent });
  rig.add(key, key.target);

  const rim = new THREE.DirectionalLight(0xa4b6ff, 1.3);
  rig.add(rim, rim.target);

  // Soft "surgical lamp" above the heart (fixed in the scene).
  const area = new THREE.RectAreaLight(0xffe2d6, 1.6, 24, 16);
  area.position.set(0, 24, 6);
  area.lookAt(0, 0, 0);
  scene.add(area);

  const fill = new THREE.HemisphereLight(0xffe4dc, 0x1a0506, 0.45);
  scene.add(fill);

  /** Aims the camera-attached lights at the orbit target `distance` ahead. */
  function update(distance) {
    key.target.position.set(0, 0, -distance);
    key.position.copy(key.target.position).addScaledVector(KEY_DIR, 35);
    rim.target.position.set(0, 0, -distance);
    rim.position.copy(rim.target.position).addScaledVector(RIM_DIR, 35);
  }
  update(40);

  return {
    key,
    rim,
    area,
    fill,
    update,
    setShadows(enabled, mapSize) {
      key.castShadow = enabled;
      if (enabled && key.shadow.mapSize.x !== mapSize) {
        key.shadow.mapSize.set(mapSize, mapSize);
        key.shadow.map?.dispose();
        key.shadow.map = null;
      }
    },
    /** Key light direction in view space (for the subsurface approximation). */
    keyDirectionView(target) {
      return target.copy(KEY_DIR);
    },
  };
}

/**
 * Post-processing: render (multisampled, half float) -> ambient occlusion
 * (GTAO: contact shadows where a vessel lies on the muscle, between fat
 * lobules, in the grooves) -> bloom -> output (tone mapping + sRGB).
 */
export function createComposer(renderer, scene, camera, profile) {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: profile.msaa });
  const composer = new EffectComposer(renderer, target);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  // Radii in scene units (cm): about a centimetre of contact shadow.
  const ao = new GTAOPass(scene, camera, 1, 1, undefined, {
    radius: 1.1,
    distanceExponent: 1.1,
    thickness: 1.5,
    scale: 2,
    samples: 16,
    distanceFallOff: 1,
    screenSpaceRadius: false,
  });
  ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 16 });
  ao.blendIntensity = 0;
  ao.enabled = false;
  composer.addPass(ao);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.45, 0.92);
  bloom.enabled = profile.bloom;
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  return {
    composer,
    bloom,
    ao,
    setMsaa(samples) {
      if (target.samples === samples) return;
      target.samples = samples;
      composer.renderTarget1.samples = samples;
      composer.renderTarget2.samples = samples;
      target.dispose();
      composer.renderTarget1.dispose();
      composer.renderTarget2.dispose();
    },
  };
}

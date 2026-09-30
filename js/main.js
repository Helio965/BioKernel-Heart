import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { LAYERS } from './anatomy.js';
import { createRenderer, createLighting, createComposer } from './renderer.js';
import { describeGpu } from './gpu.js';
import { detectQualityProfile, profileFor, createFrameRateGovernor } from './quality.js';
import { createSharedUniforms } from './materials.js';
import { createHeart } from './heart.js';
import { createHeartbeat } from './heartbeat.js';
import { createControlsPanel, createPerformanceStatus, createVitals, createLoader, setupHint } from './ui.js';

// ---------------------------------------------------------------------------
// Scene units: 1 unit = 1 cm. Origin = centre of the four cardiac cavities,
// +Y superior, +Z anterior, +X the patient's left (anatomical position).
// ---------------------------------------------------------------------------

const CAMERA_FOV = 34;
const MIN_DISTANCE = 1.2;
const MAX_DISTANCE = 90;
const HOME_DIRECTION = new THREE.Vector3(0.12, 0.1, 1).normalize();
const HOME_TARGET = new THREE.Vector3(0.4, 1.2, 0);

const canvas = document.getElementById('scene');
const loader = createLoader();
const renderer = location.protocol === 'file:' ? null : createRenderer(canvas);

if (renderer) {
  start(renderer).catch((error) => {
    console.error(error);
    loader.fail('Não foi possível carregar o modelo: ' + (error?.message ?? error));
  });
}

/** Distance that frames the heart and the great vessels for an aspect ratio. */
function idealDistance(aspect) {
  const halfVertical = THREE.MathUtils.degToRad(CAMERA_FOV / 2);
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect);
  const fitHeight = 11.5 / Math.tan(halfVertical);
  const fitWidth = 9.5 / Math.tan(halfHorizontal);
  return THREE.MathUtils.clamp(Math.max(fitHeight, fitWidth), 36, 70);
}

function homePosition(aspect, target = new THREE.Vector3()) {
  return target.copy(HOME_DIRECTION).multiplyScalar(idealDistance(aspect)).add(HOME_TARGET);
}

async function start(renderer) {
  const gpu = describeGpu(renderer);
  let quality = detectQualityProfile(gpu);
  let maxPixelRatio = quality.maxPixelRatio;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, window.innerWidth / window.innerHeight, 0.05, 500);
  homePosition(camera.aspect, camera.position);

  // 360° orbit: drag to rotate, wheel / pinch to zoom (towards the pointer).
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = MIN_DISTANCE;
  controls.maxDistance = MAX_DISTANCE;
  controls.rotateSpeed = 0.65;
  controls.zoomSpeed = 0.9;
  controls.zoomToCursor = true;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.autoRotateSpeed = 0.9;
  controls.target.copy(HOME_TARGET);
  controls.update();
  const cameraMotion = createCameraMotion(camera, controls);

  const lighting = createLighting(renderer, scene, camera);
  const post = createComposer(renderer, scene, camera, quality);
  const shared = createSharedUniforms();
  shared.uMicroDetail.value = quality.microDetail;

  const heart = await createHeart({ shared, onProgress: (f) => loader.progress(f) });
  scene.add(heart.group);
  const heartbeat = createHeartbeat({ bpm: 72 });
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  const layers = Object.fromEntries(LAYERS.map((l) => [l.key, l.defaultOn]));
  function applyLayer(key, on) {
    layers[key] = on;
    heart.setLayerVisible(key, on);
  }

  function onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const pixelRatio = Math.min(window.devicePixelRatio, maxPixelRatio);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    post.composer.setPixelRatio(pixelRatio);
    post.composer.setSize(width, height);
  }
  window.addEventListener('resize', onResize);
  onResize();

  function applyQuality(profile) {
    quality = profile;
    maxPixelRatio = profile.maxPixelRatio;
    post.bloom.enabled = profile.bloom;
    post.setMsaa(profile.msaa);
    shared.uMicroDetail.value = profile.microDetail;
    lighting.setShadows(profile.shadows, profile.shadowMapSize);
    onResize();
    status.setQuality(profile.name, profile.adaptive);
    governor.restart();
  }

  const governor = createFrameRateGovernor({
    onDowngrade(step, fps) {
      if (!quality.adaptive) return;
      if (step === 'resolution') {
        maxPixelRatio = Math.max(0.75, Math.min(window.devicePixelRatio, maxPixelRatio) - 0.35);
        onResize();
      } else if (step === 'bloom') {
        post.bloom.enabled = false;
      } else if (step === 'microDetail') {
        shared.uMicroDetail.value *= 0.5;
      } else if (step === 'shadows') {
        lighting.setShadows(false);
      } else if (step === 'msaa') {
        post.setMsaa(0);
      }
      console.info(`[heart] ${fps.toFixed(1)} fps -> reduced ${step}`);
    },
  });

  const status = createPerformanceStatus(gpu);
  const vitals = createVitals();
  const panel = createControlsPanel({
    values: { bpm: 72, transparency: 0, sound: false, autoRotate: false },
    layers,
    onChange(key, value) {
      if (key === 'bpm') heartbeat.setBpm(value);
      if (key === 'autoRotate') controls.autoRotate = value;
    },
    onLayer: applyLayer,
    onQuality: (choice) => applyQuality(profileFor(choice, gpu)),
    onResetCamera: () => cameraMotion.reset(),
  });
  panel.setQualityChoice(quality.choice);
  setupHint(canvas);
  for (const [key, on] of Object.entries(layers)) applyLayer(key, on);
  applyQuality(quality);

  // Space pauses the beat (to look at one phase), unless a control has focus.
  document.addEventListener('keydown', (event) => {
    const typing = event.target instanceof HTMLElement && event.target.closest('button, input, select, textarea');
    if (event.code === 'Space' && !typing) {
      event.preventDefault();
      heartbeat.setPaused(!heartbeat.paused);
    }
  });

  window.__heart = { scene, camera, controls, heart, heartbeat, layers, applyLayer };
  await renderer.compileAsync(scene, camera);

  const clock = new THREE.Clock();
  const fpsMeter = { frames: 0, elapsed: 0 };
  const keyView = new THREE.Vector3();

  function frame() {
    requestAnimationFrame(frame);
    const rawDelta = clock.getDelta();
    if (quality.adaptive) governor.tick(rawDelta);
    fpsMeter.frames += 1;
    fpsMeter.elapsed += rawDelta;
    if (fpsMeter.elapsed >= 0.5) {
      status.setFps(fpsMeter.frames / fpsMeter.elapsed);
      fpsMeter.frames = 0;
      fpsMeter.elapsed = 0;
    }
    const delta = Math.min(rawDelta, 0.1);
    cameraMotion.update(delta);
    controls.update(delta);
    camera.updateMatrixWorld();

    const distance = camera.position.distanceTo(controls.target);
    lighting.update(distance);
    shared.uTime.value = clock.elapsedTime;
    shared.uCameraPos.value.copy(camera.position);
    shared.uTarget.value.copy(controls.target);
    shared.uKeyLightView.value.copy(lighting.keyDirectionView(keyView));

    const fading = [...heart.structures.values()].some((s) => s.layerOpacity > 0.003 && s.layerOpacity < 0.997);
    heart.setTranslucent(fading);
    const cycle = heartbeat.update(prefersReducedMotion ? delta * 0.6 : delta);
    heart.update(delta, cycle, distance);
    vitals.update(delta, cycle);
    post.composer.render(delta);
  }

  frame();
  canvas.classList.add('is-ready');
  loader.done();
}

/**
 * Smooth camera reset, like the Black-Hole project: interpolating in
 * spherical coordinates so the camera travels on an arc.
 */
function createCameraMotion(camera, controls) {
  const fromTarget = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const from = new THREE.Spherical();
  const to = new THREE.Spherical();
  const offset = new THREE.Vector3();
  let duration = 1.4;
  let elapsed = -1;

  function begin(targetPoint, cameraPosition, seconds) {
    fromTarget.copy(controls.target);
    toTarget.copy(targetPoint);
    from.setFromVector3(offset.copy(camera.position).sub(controls.target));
    to.setFromVector3(offset.copy(cameraPosition).sub(targetPoint));
    const turn = to.theta - from.theta;
    to.theta = from.theta + Math.atan2(Math.sin(turn), Math.cos(turn));
    duration = seconds;
    elapsed = 0;
    controls.autoRotate = false;
  }

  return {
    reset() {
      begin(HOME_TARGET, homePosition(camera.aspect), 1.6);
    },
    update(delta) {
      if (elapsed < 0) return;
      elapsed = Math.min(elapsed + delta, duration);
      const t = elapsed / duration;
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      controls.target.lerpVectors(fromTarget, toTarget, ease);
      offset.setFromSphericalCoords(
        THREE.MathUtils.lerp(from.radius, to.radius, ease),
        THREE.MathUtils.lerp(from.phi, to.phi, ease),
        THREE.MathUtils.lerp(from.theta, to.theta, ease),
      );
      camera.position.copy(controls.target).add(offset);
      camera.lookAt(controls.target);
      if (elapsed >= duration) elapsed = -1;
    },
  };
}

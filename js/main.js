import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { LAYERS, STRUCTURES } from './anatomy.js';
import { createRenderer, createLighting, createComposer } from './renderer.js';
import { describeGpu } from './gpu.js';
import { detectQualityProfile, profileFor, createFrameRateGovernor } from './quality.js';
import { createSharedUniforms } from './materials.js';
import { createHeart } from './heart.js';
import { createHeartbeat } from './heartbeat.js';
import { createCameraReveal } from './cameraReveal.js';
import { createBloodFlow } from './bloodFlow.js';
import { createCoronaryFlow } from './coronary.js';
import { createConductionSystem } from './conduction.js';
import { createInteraction } from './interaction.js';
import { createPicker } from './picking.js';
import { createLabels } from './labels.js';
import { createHeartSound } from './audio.js';
import { createIntro } from './intro.js';
import {
  createControlsPanel,
  createPerformanceStatus,
  createVitals,
  createInfoCard,
  createLegend,
  createLoader,
  setupHint,
} from './ui.js';

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
  let particleScale = 1;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, window.innerWidth / window.innerHeight, 0.05, 500);
  homePosition(camera.aspect, camera.position);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = MIN_DISTANCE;
  controls.maxDistance = MAX_DISTANCE;
  controls.rotateSpeed = 0.65;
  controls.zoomSpeed = 0.9;
  controls.zoomToCursor = true; // approach the structure under the pointer
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

  // --- Model --------------------------------------------------------------------
  const heart = await createHeart({ shared, onProgress: (f) => loader.progress(f) });
  scene.add(heart.group);

  const heartbeat = createHeartbeat({ bpm: 72 });
  const reveal = createCameraReveal(shared);
  const bloodFlow = createBloodFlow({ data: heart.data.vessels, field: heart.field, count: quality.flowParticles });
  const coronaryFlow = createCoronaryFlow({ data: heart.data.vessels.coronary, field: heart.field, count: quality.coronaryParticles });
  const conduction = createConductionSystem({ data: heart.data.conduction, field: heart.field, shared });
  scene.add(bloodFlow.object, coronaryFlow.object, conduction.group);
  const sound = createHeartSound();
  const intro = createIntro({ heart, scene });

  // --- Settings -----------------------------------------------------------------
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const settings = {
    bpm: 72,
    transparency: 0,
    sound: false,
    autoRotate: false,
  };
  const layers = Object.fromEntries(LAYERS.map((l) => [l.key, l.defaultOn]));

  function applyLayer(key, on) {
    layers[key] = on;
    if (key === 'bloodFlow') bloodFlow.setVisible(on);
    else if (key === 'coronaryFlow') coronaryFlow.setVisible(on);
    else if (key === 'conduction') conduction.setVisible(on);
    else if (key === 'labels') labels.setEnabled(on);
    else if (key === 'interior') {
      reveal.setEnabled(on);
      heart.setLayerVisible('interior', on);
    } else heart.setLayerVisible(key, on);
    legend.update({ flow: layers.bloodFlow || layers.coronaryFlow, conduction: layers.conduction });
  }

  const applySetting = {
    bpm: (v) => heartbeat.setBpm(v),
    transparency: () => {}, // blended every frame with the see-through assist
    sound: (v) => sound.setEnabled(v),
    autoRotate: (v) => {
      controls.autoRotate = v;
    },
  };

  // --- Interaction ------------------------------------------------------------------
  let selectedKey = null;
  let isolatedKey = null;
  const infoCard = createInfoCard({
    onIsolate: () => isolate(isolatedKey === selectedKey ? null : selectedKey),
    onFocus: () => selectedKey && cameraMotion.focus(labels.anchorPoint(selectedKey, heartbeat.state), selectedKey),
    onClose: () => select(null),
    onRestore: () => isolate(null),
  });
  function select(key) {
    selectedKey = key;
    heart.setSelected(key);
    conduction.setSelected(key);
    labels.setSelected(key);
    if (key) infoCard.show(STRUCTURES[key]);
    else infoCard.hide();
  }
  function isolate(key) {
    isolatedKey = key;
    heart.setIsolated(key);
    conduction.setIsolated(key);
    infoCard.setIsolated(Boolean(key));
  }
  const picker = createPicker();
  const interaction = createInteraction({
    canvas,
    camera,
    heart,
    conduction,
    shared,
    picker,
    onFocusPoint: (point, key) => cameraMotion.focus(point, key),
    onHover(key) {
      heart.setHovered(key);
      conduction.setHovered(key);
      labels.setHovered(key);
      canvas.classList.toggle('is-pointing', Boolean(key));
    },
    onSelect(key) {
      select(key);
    },
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (isolatedKey) isolate(null);
      else if (selectedKey) select(null);
    }
    // Space pauses the beat (to look at one phase of the cycle), unless a
    // control has the focus.
    const typing = event.target instanceof HTMLElement && event.target.closest('button, input, select, textarea');
    if (event.code === 'Space' && !typing) {
      event.preventDefault();
      heartbeat.setPaused(!heartbeat.paused);
    }
  });

  const labels = createLabels({
    container: document.getElementById('labels'),
    camera,
    heart,
    conduction,
    shared,
    picker,
    onPick: (key) => select(key),
  });

  // --- Responsiveness -----------------------------------------------------------------
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
    bloodFlow.setPixelRatio(pixelRatio);
    coronaryFlow.setPixelRatio(pixelRatio);
  }
  window.addEventListener('resize', onResize);
  onResize();

  // --- Quality ----------------------------------------------------------------------
  let effects = {};
  function applyQuality(profile, { keepGovernor = false } = {}) {
    quality = profile;
    maxPixelRatio = profile.maxPixelRatio;
    particleScale = 1;
    effects = {
      bloom: profile.bloom,
      microDetail: profile.microDetail,
      shadows: profile.shadows,
      msaa: profile.msaa,
      detailModel: profile.detailModel,
    };
    effects.materials = profile.materials;
    post.bloom.enabled = effects.bloom;
    post.setMsaa(effects.msaa);
    heart.setMaterialQuality(profile.materials);
    lighting.area.visible = profile.areaLight;
    shared.uMicroDetail.value = effects.microDetail;
    lighting.setShadows(effects.shadows, profile.shadowMapSize);
    bloodFlow.setCount(profile.flowParticles);
    coronaryFlow.setCount(profile.coronaryParticles);
    conduction.setPurkinje(profile.purkinje);
    if (effects.detailModel) {
      heart.loadDetail().then((ok) => ok && effects.detailModel && heart.useDetail(true));
    } else {
      heart.useDetail(false);
    }
    onResize();
    status.setQuality(profile.name, profile.adaptive);
    if (!keepGovernor) governor.restart();
  }

  const governor = createFrameRateGovernor({
    onDowngrade(step, fps) {
      if (!quality.adaptive) return;
      switch (step) {
        case 'bloom':
          effects.bloom = false;
          post.bloom.enabled = false;
          break;
        case 'microDetail':
          effects.microDetail *= 0.5;
          shared.uMicroDetail.value = effects.microDetail;
          break;
        case 'materials':
          effects.materials = effects.materials === 'full' ? 'standard' : 'lite';
          heart.setMaterialQuality(effects.materials);
          lighting.area.visible = false;
          break;
        case 'resolution': {
          const current = Math.min(window.devicePixelRatio, maxPixelRatio);
          maxPixelRatio = Math.max(0.75, current - 0.35);
          onResize();
          break;
        }
        case 'particles':
          particleScale *= 0.6;
          bloodFlow.setCount(Math.round(quality.flowParticles * particleScale));
          coronaryFlow.setCount(Math.round(quality.coronaryParticles * particleScale));
          break;
        case 'shadows':
          effects.shadows = false;
          lighting.setShadows(false);
          break;
        case 'msaa':
          effects.msaa = 0;
          post.setMsaa(0);
          break;
        case 'detailModel':
          effects.detailModel = false;
          heart.useDetail(false);
          break;
      }
      console.info(`[heart] ${fps.toFixed(1)} fps -> reduced ${step} (pixel ratio ${Math.min(window.devicePixelRatio, maxPixelRatio).toFixed(2)})`);
    },
  });

  // --- Interface ------------------------------------------------------------------
  const status = createPerformanceStatus(gpu);
  const vitals = createVitals();
  const legend = createLegend();
  const panel = createControlsPanel({
    values: settings,
    layers,
    onChange(key, value) {
      settings[key] = value;
      applySetting[key]?.(value);
    },
    onLayer: applyLayer,
    onQuality: (choice) => applyQuality(profileFor(choice, gpu)),
    onResetCamera: () => cameraMotion.reset(),
  });
  panel.setQualityChoice(quality.choice);
  setupHint(canvas);
  for (const [key, on] of Object.entries(layers)) applyLayer(key, on);
  for (const [key, apply] of Object.entries(applySetting)) apply(settings[key]);
  applyQuality(quality);

  // Debug / automated tests: read-only handle to the running app.
  window.__heart = { scene, camera, controls, heart, heartbeat, reveal, bloodFlow, coronaryFlow, conduction, labels, sound, settings, layers, select, isolate, applyLayer, panel, cameraMotion, quality: () => quality, applyQuality: (c) => applyQuality(profileFor(c, gpu)) };

  // Compile every shader variant up-front (opaque and translucent), so the
  // first zoom does not stutter.
  heart.setTranslucent(true);
  await renderer.compileAsync(scene, camera);
  heart.setTranslucent(false);
  await renderer.compileAsync(scene, camera);

  // --- Animation loop -------------------------------------------------------------
  const clock = new THREE.Clock();
  const fpsMeter = { frames: 0, elapsed: 0 };
  const keyView = new THREE.Vector3();
  let translucentHold = 0;
  let assist = 0;

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

    const cycle = heartbeat.update(prefersReducedMotion ? delta * 0.6 : delta);
    const view = reveal.update(delta, camera, controls.target);
    lighting.update(view.distance);
    status.setReveal(reveal.levelName);

    shared.uTime.value = clock.elapsedTime;
    shared.uSinceP.value = cycle.sinceP;
    shared.uQTime.value = cycle.qTime;
    shared.uQT.value = (cycle.timeline.qs2 - 0.02) * 1000;
    shared.uElectrical.value += ((layers.conduction ? 1 : 0) - shared.uElectrical.value) * (1 - Math.exp(-delta / 0.3));
    shared.uKeyLightView.value.copy(lighting.keyDirectionView(keyView));

    // Blood flow and the conduction system live inside the heart: while one of
    // them is on and the camera is outside, the walls become see-through by
    // themselves (the transparency slider can go further).
    const wantsAssist = layers.bloodFlow || layers.coronaryFlow || layers.conduction ? 0.62 : 0;
    assist += (wantsAssist - assist) * (1 - Math.exp(-delta / 0.35));
    shared.uUserTransparency.value = Math.max(settings.transparency, assist * (1 - THREE.MathUtils.smoothstep(view.progress, 2, 3)));

    // Translucent rendering only while something is see-through.
    const needsTranslucency = view.progress > 1.9 || shared.uUserTransparency.value > 0.001 || Boolean(isolatedKey) || heart.fading;
    translucentHold = needsTranslucency ? 0.5 : translucentHold - delta;
    heart.setTranslucent(translucentHold > 0);
    lighting.setShadows(effects.shadows && view.progress < 1.8, quality.shadowMapSize);

    heart.update(delta, cycle, view.distance);
    bloodFlow.update(delta, cycle);
    coronaryFlow.update(delta, cycle);
    conduction.update(delta, cycle);
    sound.update(heartbeat);
    intro.update(delta);
    interaction.update();
    labels.update(delta, cycle, view);
    vitals.update(delta, cycle);

    post.composer.render(delta);
  }

  frame();
  canvas.classList.add('is-ready');
  loader.done();
  intro.start();
  picker.warmUp(heart.pickables());
}

/**
 * Smooth camera moves: reset to the home view (like the Black-Hole project,
 * interpolating in spherical coordinates so the camera travels on an arc) and
 * focus on a selected structure.
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
      const home = homePosition(camera.aspect);
      begin(HOME_TARGET, home, 1.6);
    },
    /** Looks at `point` from the current direction, at a distance suited to its size. */
    focus(point, key) {
      if (!point) return;
      const info = STRUCTURES[key];
      const interior = ['valves', 'interior', 'chambers', 'conduction'].includes(info?.layer) || key === 'ivs' || key === 'ias';
      const distance = interior ? 8.5 : info?.layer === 'greatVessels' ? 22 : 20;
      const direction = offset.copy(camera.position).sub(controls.target).normalize();
      const target = new THREE.Vector3().copy(point);
      begin(target, target.clone().addScaledVector(direction, distance), 1.3);
    },
    get active() {
      return elapsed >= 0;
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

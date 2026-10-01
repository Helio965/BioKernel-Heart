/**
 * Quality management (same philosophy as the Black-Hole project): pick
 * sensible defaults for the GPU the browser is really using, then lower them
 * at runtime if the frame rate stays too low.
 *
 * Profiles only change rendering cost (resolution, shadows, post-processing,
 * particles, surface micro-detail, geometric detail). The anatomy is the same
 * on every profile: no structure is ever removed.
 *
 * `?quality=ultra|high|medium|low` in the URL forces a profile and disables
 * the automatic adjustment (useful for screenshots and benchmarks).
 */

export const PROFILES = {
  // Dedicated GPUs: subdivided geometry, MSAA, shadows, bloom, full detail.
  ultra: {
    name: 'ultra',
    maxPixelRatio: 2,
    materials: 'full',
    areaLight: true,
    msaa: 4,
    shadows: true,
    shadowMapSize: 2048,
    ao: true, // screen-space ambient occlusion (contact shadows)
    bloom: true,
    detailModel: true,
    microDetail: 1,
    flowParticles: 9000,
    coronaryParticles: 3200,
    purkinje: true,
  },
  high: {
    name: 'high',
    maxPixelRatio: 1.75,
    materials: 'full',
    areaLight: true,
    msaa: 4,
    shadows: true,
    shadowMapSize: 1024,
    ao: true, // screen-space ambient occlusion (contact shadows)
    bloom: true,
    detailModel: true,
    microDetail: 0.85,
    flowParticles: 6000,
    coronaryParticles: 2200,
    purkinje: true,
  },
  medium: {
    name: 'medium',
    maxPixelRatio: 1.25,
    materials: 'standard',
    areaLight: false,
    msaa: 0,
    shadows: false,
    shadowMapSize: 1024,
    ao: false, // screen-space ambient occlusion (contact shadows)
    bloom: true,
    detailModel: false,
    microDetail: 0.55,
    flowParticles: 3600,
    coronaryParticles: 1400,
    purkinje: true,
  },
  low: {
    name: 'low',
    maxPixelRatio: 1,
    materials: 'lite',
    areaLight: false,
    msaa: 0,
    shadows: false,
    shadowMapSize: 512,
    ao: false, // screen-space ambient occlusion (contact shadows)
    bloom: false,
    detailModel: false,
    microDetail: 0,
    flowParticles: 1800,
    coronaryParticles: 800,
    purkinje: true,
  },
};

export const QUALITY_NAMES = ['auto', 'ultra', 'high', 'medium', 'low'];

/** @param {{ kind: string }} gpu result of describeGpu() */
export function detectQualityProfile(gpu) {
  const forced = new URLSearchParams(window.location.search).get('quality');
  if (forced in PROFILES) return { ...PROFILES[forced], adaptive: false, choice: forced };
  return automaticProfile(gpu);
}

/** Profile chosen in the panel ('auto' re-runs the detection). */
export function profileFor(choice, gpu) {
  if (choice in PROFILES) return { ...PROFILES[choice], adaptive: false, choice };
  return automaticProfile(gpu);
}

function automaticProfile(gpu) {
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const smallScreen = Math.min(window.screen.width, window.screen.height) < 820;
  const auto = (profile, extra = {}) => ({ ...profile, ...extra, adaptive: true, choice: 'auto' });
  // Rendering on the CPU: keep it as light as possible.
  if (gpu.kind === 'software') return auto(PROFILES.low, { maxPixelRatio: 1 });
  if (coarsePointer && smallScreen) return auto(PROFILES.low, { maxPixelRatio: 1.5 });
  if (gpu.kind === 'integrated') return auto(PROFILES.medium);
  if (gpu.kind === 'discrete') return auto(PROFILES.ultra);
  return auto(PROFILES.high);
}

/**
 * The order in which the governor saves time when the frame rate is low
 * (secondary effects first, geometry last — the anatomy itself never goes).
 */
export const DOWNGRADE_STEPS = [
  'ao', // screen-space ambient occlusion (an extra geometry pass)
  'bloom', // secondary effect
  'microDetail', // procedural surface detail (fragment noise)
  'materials', // secondary shading lobes (sheen, then clearcoat) and area light
  'resolution', // internal resolution
  'particles', // blood-flow particles
  'shadows',
  'msaa', // post-processing anti-aliasing
  'resolution',
  'particles',
  'detailModel', // subdivided geometry -> base geometry (LOD)
];

/**
 * Measures the frame rate over short windows and calls `onDowngrade` whenever
 * it stays below `targetFps`, at most `maxSteps` times.
 */
export function createFrameRateGovernor({
  targetFps = 45,
  warmup = 2.5,
  sampleWindow = 1.5,
  maxSteps = DOWNGRADE_STEPS.length,
  onDowngrade,
}) {
  let running = 0;
  let elapsed = 0;
  let frames = 0;
  let steps = 0;

  function reset() {
    running = 0;
    elapsed = 0;
    frames = 0;
  }

  // Frames are not rendered while the tab is hidden: start over when it returns.
  document.addEventListener('visibilitychange', reset);

  return {
    reset,
    restart() {
      steps = 0;
      reset();
    },
    get steps() {
      return steps;
    },
    /** @param {number} delta unclamped seconds since the previous frame */
    tick(delta) {
      if (steps >= maxSteps) return;
      running += delta;
      if (running < warmup) return;

      elapsed += delta;
      frames += 1;
      if (elapsed < sampleWindow) return;

      const fps = frames / elapsed;
      elapsed = 0;
      frames = 0;
      if (fps < targetFps) {
        const step = DOWNGRADE_STEPS[steps];
        steps += 1;
        onDowngrade(step, fps, steps);
        running = 0; // give the new settings time to settle
      }
    },
  };
}

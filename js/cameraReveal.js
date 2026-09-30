import * as THREE from 'three';

/**
 * Progressive internal reveal driven by camera proximity.
 *
 * Nothing is cut. As the camera approaches, each layer becomes transparent
 * only inside a soft "window" around the line of sight, in front of the orbit
 * target, and keeps a faint rim so its shape stays readable:
 *
 *   level 0  exterior        complete external anatomy
 *   level 1  surface vessels coronary arteries and veins glow, fat thins out
 *   level 2  translucent     epicardium fades, the myocardium starts to open
 *   level 3  deep            myocardium and great vessels become see-through,
 *                            chambers, valves, septa, papillary muscles appear
 *   level 4  interior        only the structures around the camera remain
 *
 * The level is continuous (a float): every transition is a cross-fade.
 */
export const REVEAL_LEVELS = [
  'Exterior',
  'Vasos da superfície',
  'Miocárdio translúcido',
  'Estruturas profundas',
  'Interior',
];

// Camera distance (cm, to the orbit target) at which each level is reached.
const DISTANCES = [34, 28, 21.5, 15.5, 9.5];

export function revealProgressForDistance(distance) {
  if (distance >= DISTANCES[0]) return 0;
  for (let i = 1; i < DISTANCES.length; i++) {
    if (distance >= DISTANCES[i]) {
      const t = (DISTANCES[i - 1] - distance) / (DISTANCES[i - 1] - DISTANCES[i]);
      return i - 1 + t;
    }
  }
  return 4;
}

export function createCameraReveal(shared) {
  let progress = 0;
  let enabled = 1;
  let enabledTarget = 1;

  return {
    get progress() {
      return progress * enabled;
    },
    get levelName() {
      return REVEAL_LEVELS[Math.min(Math.floor(progress * enabled + 0.5), 4)];
    },
    setEnabled(on) {
      enabledTarget = on ? 1 : 0;
    },
    /**
     * @param {THREE.Camera} camera
     * @param {THREE.Vector3} target orbit target
     */
    update(delta, camera, target) {
      enabled += (enabledTarget - enabled) * (1 - Math.exp(-delta / 0.25));
      const distance = camera.position.distanceTo(target);
      const wanted = revealProgressForDistance(distance);
      // Slight smoothing so fast zooms still cross-fade.
      progress += (wanted - progress) * (1 - Math.exp(-delta / 0.12));

      shared.uRevealProgress.value = progress;
      shared.uRevealEnabled.value = enabled;
      shared.uWindowRadius.value = THREE.MathUtils.clamp(distance * 0.34, 3.4, 7.6);
      shared.uCameraPos.value.copy(camera.position);
      shared.uTarget.value.copy(target);
      const p = progress * enabled;
      shared.uVesselGlow.value = THREE.MathUtils.smoothstep(p, 0.55, 1.2) * (1 - THREE.MathUtils.smoothstep(p, 2.3, 3.3));
      return { progress: p, distance };
    },
  };
}

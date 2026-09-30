/**
 * Cardiac cycle clock.
 *
 * Turns a heart rate (BPM) into the timeline of one beat and evaluates, at any
 * moment, everything the rest of the application animates: chamber volumes,
 * blend-shape weights, valve opening, flow rates, electrical timing, heart
 * sounds and the ECG trace. Every system reads the same state, so muscle,
 * valves, blood flow, electrical activity and audio stay in sync.
 *
 * Timeline (time 0 = QRS onset, T = 60 / BPM):
 *   pre-ejection period  PEP  = 131 - 0.4·HR  ms   (Weissler et al., 1968)
 *   electromechanical    QS2  = 546 - 2.1·HR  ms   (end of ejection = A2)
 *   ejection             LVET = QS2 - PEP        (≈ 413 - 1.7·HR ms)
 *   isovolumic relax.    IVRT ≈ 70–90 ms
 *   PR interval          120–200 ms (P onset precedes the next QRS by PR)
 *   atrial systole       ≈ 100 ms, starting ~25 ms after the P wave
 *   passive filling      70–80% of the ventricular filling, atrial kick 20–30%
 * Systole shortens a little with the heart rate and diastole a lot (sources in
 * docs/ANATOMY_SOURCES.md), which is exactly what these relations produce.
 */

export const BPM_MIN = 40;
export const BPM_MAX = 180;

const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const gaussian = (x, center, width) => Math.exp(-((x - center) * (x - center)) / (2 * width * width));

/** Timeline of one beat for a given heart rate (seconds). */
export function cycleTimeline(bpm) {
  const hr = clamp(bpm, BPM_MIN, BPM_MAX);
  const T = 60 / hr;
  const qs2 = Math.min(0.546 - 0.0021 * hr, 0.52 * T);
  const pep = Math.min(0.131 - 0.0004 * hr, qs2 * 0.45);
  const lvet = qs2 - pep;
  const ivrt = clamp(0.1 - 0.0002 * hr, 0.05, 0.09);
  const pr = clamp(0.19 - 0.0004 * hr, 0.12, 0.2);
  const s1 = Math.min(0.05, pep * 0.5);
  const avOpen = qs2 + ivrt;
  const atrialDuration = Math.min(0.1, 0.3 * T);
  const pOnset = T - pr;
  const atrialStart = Math.min(pOnset + 0.025, T - atrialDuration);
  const ramp = Math.min(1, lvet / 0.25);
  return {
    bpm: hr,
    T,
    qs2,
    pep,
    lvet,
    ivrt,
    pr,
    s1,
    t1: s1 + 0.012 * ramp, // tricuspid component of S1
    s2: qs2,
    p2: qs2 + 0.02 * ramp, // pulmonary component slightly after the aortic one
    avOpen,
    pOnset,
    atrialStart,
    atrialEnd: atrialStart + atrialDuration,
    atrialDuration,
    ramp,
    systole: qs2,
    diastole: T - qs2,
  };
}

/** Ventricular volume, 0 = end-systolic, 1 = end-diastolic. */
function ventricularVolume(t, L) {
  if (t < L.pep) return 1;
  if (t < L.qs2) {
    const u = (t - L.pep) / L.lvet;
    return Math.pow(1 - u, 2.3); // most of the stroke volume leaves early
  }
  if (t < L.avOpen) return 0;
  const passive = (time) => 0.78 * (1 - Math.exp(-Math.max(time - L.avOpen, 0) / 0.075));
  if (t < L.atrialStart) return passive(t);
  const before = passive(L.atrialStart);
  if (t < L.atrialEnd) return before + (1 - before) * smoothstep(0, 1, (t - L.atrialStart) / L.atrialDuration);
  return 1;
}

/** Active atrial contraction (0..1). */
function atrialContraction(t, L) {
  const u = (t - L.atrialStart) / L.atrialDuration;
  if (u <= 0 || u >= 1) return 0;
  // Faster contraction than relaxation.
  const shaped = u < 0.4 ? u / 0.4 : 1 - (u - 0.4) / 0.6;
  return Math.pow(Math.sin((shaped * Math.PI) / 2), 1.4);
}

/** Opening of the atrioventricular valves (tricuspid, mitral). */
function avValveOpening(t, L, closeAt = L.s1, openAt = L.avOpen) {
  // Diastole runs from the AV opening to the next closure (T + closeAt), so
  // the first milliseconds of the cycle belong to the previous diastole.
  const tau = t < closeAt ? t + L.T : t;
  if (tau < openAt) return 0;
  const rampIn = 0.035 * L.ramp + 0.01;
  const open = smoothstep(openAt, openAt + rampIn, tau);
  // Mid-diastolic partial closure (diastasis), re-opening with the atrial kick.
  const diastasis =
    0.45 * smoothstep(0.12, 0.3, tau - openAt) * (1 - smoothstep(L.atrialStart - 0.03, L.atrialStart + 0.03, tau));
  // Leaflets float back after the atrial kick and close exactly at S1.
  const closing = 1 - smoothstep(L.atrialEnd - 0.015, L.T + closeAt, tau);
  return clamp(open * (1 - diastasis) * closing, 0, 1);
}

/** Opening of the semilunar valves (pulmonary, aortic). */
function slValveOpening(t, L, openAt = L.pep, closeAt = L.qs2) {
  const ramp = 0.03 * L.ramp + 0.008;
  if (t < openAt || t > closeAt) return 0;
  const u = (t - openAt) / (closeAt - openAt);
  return smoothstep(openAt, openAt + ramp, t) * (1 - smoothstep(closeAt - ramp * 1.2, closeAt, t)) * (1 - 0.18 * smoothstep(0.4, 1, u));
}

/**
 * Opening of each valve (0 closed .. 1 open). The right-sided valves are
 * slightly out of phase with the left ones: the tricuspid closes a little
 * after the mitral (M1 before T1) and the pulmonary valve opens a little
 * earlier and closes after the aortic one (A2 before P2).
 */
export function valveOpenings(t, L, out = {}) {
  out.mitral = avValveOpening(t, L, L.s1, L.avOpen);
  out.tricuspid = avValveOpening(t, L, L.t1, L.avOpen - 0.008);
  out.aortic = slValveOpening(t, L, L.pep, L.qs2);
  out.pulmonary = slValveOpening(t, L, L.pep - 0.008, L.p2);
  return out;
}

/** Simplified ECG (lead II like) for the HUD. */
export function ecgAt(t, L) {
  const T = L.T;
  const pCenter = L.pOnset + 0.045;
  let v = 0;
  for (const shift of [0, -T, T]) {
    const x = t + shift;
    v += 0.14 * gaussian(x, pCenter, 0.022);
    v += -0.1 * gaussian(x, 0.008, 0.006);
    v += 1.0 * gaussian(x, 0.022, 0.008);
    v += -0.24 * gaussian(x, 0.04, 0.008);
    v += 0.28 * gaussian(x, L.qs2 - 0.075, 0.045);
  }
  return v;
}

/**
 * Stateful clock: smooths BPM changes and integrates the phase, so changing
 * the rate never makes the heart jump.
 */
export function createHeartbeat({ bpm = 72 } = {}) {
  let target = bpm;
  let current = bpm;
  let phase = 0.62; // start in mid-diastole
  let timeline = cycleTimeline(current);
  let beat = 0;
  let paused = false;

  const state = {
    bpm: current,
    targetBpm: target,
    timeline,
    t: 0,
    beat: 0,
    volume: 1,
    ventricular: 0, // blend weight of the ventricular-systole shape
    atrial: 0, // blend weight of the atrial-systole shape
    distension: 0,
    avOpen: 0,
    slOpen: 0,
    valves: { mitral: 0, tricuspid: 0, aortic: 0, pulmonary: 0 },
    avFlow: 0,
    slFlow: 0,
    venousFlow: 0,
    arterialFlow: 0,
    coronaryLeft: 0,
    coronaryRight: 0,
    coronaryVenous: 0,
    sinceP: 0, // ms since the last P onset
    qTime: 0, // ms relative to the nearest QRS onset (negative before it)
    phaseName: 'rapidFilling',
    ecg: 0,
    events: [], // events fired during the last update: 'S1', 'S2', 'P', 'QRS'
  };

  function evaluate(t, L) {
    const volume = ventricularVolume(t, L);
    const dt = 0.004;
    const dV = (ventricularVolume(Math.min(t + dt, L.T - 1e-4), L) - ventricularVolume(Math.max(t - dt, 0), L)) / (2 * dt);
    const peakFilling = 0.78 / 0.075; // steepest passive filling (1/s)
    const peakEjection = 2.3 / L.lvet;
    state.t = t;
    state.volume = volume;
    state.ventricular = 1 - volume;
    state.atrial = atrialContraction(t, L);
    valveOpenings(t, L, state.valves);
    state.avOpen = state.valves.mitral;
    state.slOpen = state.valves.aortic;
    state.avFlow = clamp(dV / peakFilling, 0, 1) * state.avOpen + state.atrial * 0.5 * state.avOpen;
    state.slFlow = clamp(-dV / peakEjection, 0, 1) * (state.slOpen > 0.02 ? 1 : 0);

    const systolic = t < L.qs2 ? smoothstep(0, 0.04, t) : 1 - smoothstep(L.qs2, L.qs2 + 0.05, t);
    const diastolic = 1 - systolic;
    // Venous return: S wave (ventricular systole) + D wave (early diastole),
    // brief slowing during atrial contraction.
    state.venousFlow = clamp(0.25 + 0.55 * systolic + 0.5 * clamp(dV / peakFilling, 0, 1) - 0.4 * state.atrial, 0.05, 1);
    state.arterialFlow = clamp(state.slFlow + 0.12, 0, 1);
    // Left coronary flow is mostly diastolic (systolic compression of the
    // intramyocardial vessels); right coronary flow is more even; coronary
    // venous outflow increases in systole.
    state.coronaryLeft = 0.18 + 0.82 * diastolic;
    state.coronaryRight = 0.5 + 0.5 * diastolic;
    state.coronaryVenous = 0.3 + 0.7 * systolic;

    // Aortic pressure proxy for the arterial distension.
    if (t >= L.pep && t < L.qs2) {
      const u = (t - L.pep) / L.lvet;
      const rise = Math.sin((Math.PI / 2) * Math.min(u / 0.35, 1));
      state.distension = (0.12 + 0.88 * rise) * (1 - 0.15 * smoothstep(0.35, 1, u));
    } else {
      const since = t >= L.qs2 ? t - L.qs2 : t + L.T - L.qs2;
      const span = L.T - L.qs2 + L.pep;
      state.distension = 0.85 * Math.exp((-since / span) * Math.log(0.85 / 0.12));
    }

    state.sinceP = (t >= L.pOnset ? t - L.pOnset : t + L.pr) * 1000;
    state.qTime = (t >= L.pOnset ? t - L.T : t) * 1000;
    state.ecg = ecgAt(t, L);

    if (t < L.pep) state.phaseName = 'isovolumicContraction';
    else if (t < L.qs2) state.phaseName = 'ejection';
    else if (t < L.avOpen) state.phaseName = 'isovolumicRelaxation';
    else if (t >= L.atrialStart && t < L.atrialEnd) state.phaseName = 'atrialSystole';
    else if (t - L.avOpen < 0.16) state.phaseName = 'rapidFilling';
    else if (t < L.atrialStart) state.phaseName = 'diastasis';
    else state.phaseName = 'atrialSystole';
  }

  function update(delta) {
    state.events.length = 0;
    // Smooth BPM transitions (time constant ~0.7 s).
    current += (target - current) * (1 - Math.exp(-delta / 0.7));
    if (Math.abs(target - current) < 0.01) current = target;
    timeline = cycleTimeline(current);
    if (!paused) {
      const previousT = phase * timeline.T;
      phase += delta / timeline.T;
      let wrapped = false;
      if (phase >= 1) {
        phase -= 1;
        beat++;
        wrapped = true;
        state.events.push('QRS');
      }
      const t = phase * timeline.T;
      const crossed = (mark) => (wrapped ? mark > previousT || mark <= t : previousT < mark && mark <= t);
      if (crossed(timeline.s1)) state.events.push('S1');
      if (crossed(timeline.s2)) state.events.push('S2');
      if (crossed(timeline.pOnset)) state.events.push('P');
    }
    state.bpm = current;
    state.paused = paused;
    state.targetBpm = target;
    state.timeline = timeline;
    state.beat = beat;
    evaluate(phase * timeline.T, timeline);
    return state;
  }

  return {
    state,
    update,
    setBpm(value) {
      target = clamp(value, BPM_MIN, BPM_MAX);
    },
    get bpm() {
      return current;
    },
    get targetBpm() {
      return target;
    },
    /** Seconds until the clock next reaches `mark` (a time within the beat). */
    timeUntil(mark) {
      let d = mark - phase * timeline.T;
      if (d < 0) d += timeline.T;
      return d;
    },
    setPaused(value) {
      paused = value;
    },
    get paused() {
      return paused;
    },
    /** Jumps to a point of the beat (0..1, 0 = QRS onset); used by tests. */
    setPhase(value) {
      phase = ((value % 1) + 1) % 1;
    },
    evaluateAt(t) {
      evaluate(t, timeline);
      return state;
    },
  };
}

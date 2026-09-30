/**
 * Heart sounds ("lub-dub"), synthesised with the Web Audio API.
 *
 *   S1 ("lub"): closure of the AV valves at the start of ventricular systole,
 *               mitral (M1) then tricuspid (T1) component;
 *   S2 ("dub"): closure of the semilunar valves at the end of ejection,
 *               aortic (A2) then pulmonary (P2) component, shorter and higher.
 *
 * Each sound is an independent event scheduled on the audio clock at the exact
 * time given by the cardiac cycle (js/heartbeat.js), so when the BPM changes
 * the sounds get closer or further apart but keep their own duration and pitch
 * (nothing is played back faster).
 */

const LOOKAHEAD = 0.18; // seconds

export function createHeartSound() {
  let context = null;
  let master = null;
  let noise = null;
  let enabled = false;
  const scheduled = new Map(); // "beat:name" -> audio time

  function ensureContext() {
    if (context) return context;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    context = new AudioContext();
    const lowpass = context.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 420;
    lowpass.Q.value = 0.5;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 4;
    master = context.createGain();
    master.gain.value = 0.9;
    master.connect(lowpass).connect(compressor).connect(context.destination);

    // One second of white noise, reused by every sound.
    noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return context;
  }

  /** One valve-closure "thump": damped low-frequency tones + a noise burst. */
  function thump(time, { frequency, decay, gain }) {
    const end = time + decay * 7;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, time);
    envelope.gain.exponentialRampToValueAtTime(gain, time + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    envelope.connect(master);

    for (const [ratio, level] of [
      [1, 1],
      [2.05, 0.45],
      [3.1, 0.18],
    ]) {
      const osc = context.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency * ratio * 1.35, time);
      osc.frequency.exponentialRampToValueAtTime(frequency * ratio, time + 0.03);
      const g = context.createGain();
      g.gain.value = level;
      osc.connect(g).connect(envelope);
      osc.start(time);
      osc.stop(end + 0.02);
    }

    const burst = context.createBufferSource();
    burst.buffer = noise;
    const band = context.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = frequency * 2.6;
    band.Q.value = 0.9;
    const g = context.createGain();
    g.gain.value = 0.35;
    burst.connect(band).connect(g).connect(envelope);
    burst.start(time, Math.random() * 0.5);
    burst.stop(end);
  }

  const SOUNDS = {
    S1(time, L) {
      thump(time, { frequency: 46, decay: 0.03, gain: 0.9 }); // M1
      thump(time + (L.t1 - L.s1), { frequency: 42, decay: 0.028, gain: 0.55 }); // T1
    },
    S2(time, L) {
      thump(time, { frequency: 72, decay: 0.018, gain: 0.75 }); // A2
      thump(time + (L.p2 - L.s2), { frequency: 64, decay: 0.016, gain: 0.45 }); // P2
    },
  };

  return {
    get enabled() {
      return enabled;
    },
    setEnabled(on) {
      enabled = on;
      if (on) {
        // Called from a click/change handler: allowed to start audio.
        const ctx = ensureContext();
        ctx?.resume();
      } else {
        context?.suspend();
        scheduled.clear();
      }
    },
    update(heartbeat) {
      if (!enabled || !context || context.state !== 'running') return;
      const state = heartbeat.state;
      const L = state.timeline;
      for (const [name, mark] of [
        ['S1', L.s1],
        ['S2', L.s2],
      ]) {
        const wait = heartbeat.timeUntil(mark);
        if (wait > LOOKAHEAD) continue;
        const beat = mark >= state.t ? state.beat : state.beat + 1;
        const id = `${beat}:${name}`;
        if (scheduled.has(id)) continue;
        const when = context.currentTime + wait;
        scheduled.set(id, when);
        SOUNDS[name](when, L);
      }
      for (const [id, when] of scheduled) if (when < context.currentTime - 2) scheduled.delete(id);
    },
  };
}

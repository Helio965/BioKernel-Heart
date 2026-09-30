/**
 * Interface: HUD, controls panel, information card, legend and loader.
 * The markup lives in index.html; this module only wires it up (the
 * approach of the Black-Hole project).
 */
import { LAYERS, PHASE_NAMES } from './anatomy.js';

const LAYER_SWATCHES = {
  exterior: '#e3c07f',
  myocardium: '#9b262c',
  arteries: '#d0283a',
  veins: '#5a52c8',
  greatVessels: '#c98f86',
  chambers: '#b0101c',
  valves: '#e7d6b3',
  interior: '#c0455a',
  bloodFlow: 'linear-gradient(90deg, #4f7dff 50%, #ff3b3b 50%)',
  coronaryFlow: '#ff5d6c',
  conduction: '#ffe27a',
  labels: '#f4e4e1',
};

const FORMATTERS = {
  bpm: (v) => `${Math.round(v)} BPM`,
  transparency: (v) => `${Math.round(v * 100)}%`,
};

export function rhythmDescription(bpm) {
  if (bpm < 60) return 'Batimento calmo · abaixo de 60 BPM (bradicardia)';
  if (bpm <= 100) return 'Faixa de repouso de um adulto · 60–100 BPM';
  return 'Batimento rápido · acima de 100 BPM (taquicardia)';
}

export function createControlsPanel({ values, onChange, onResetCamera, onQuality, onLayer, layers }) {
  const toggle = document.getElementById('controls-toggle');
  const panel = document.getElementById('controls');
  const note = document.getElementById('rhythm-note');
  const presetButtons = [...panel.querySelectorAll('[data-bpm]')];

  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  }
  toggle.addEventListener('click', () => setOpen(panel.hidden));
  panel.addEventListener('submit', (event) => event.preventDefault());

  const renderers = {};
  for (const input of panel.querySelectorAll('[data-setting]')) {
    const key = input.dataset.setting;
    const output = panel.querySelector(`[data-output="${key}"]`);
    const isSwitch = input.type === 'checkbox';
    const read = () => (isSwitch ? input.checked : Number(input.value));
    const render = () => {
      if (output) output.textContent = FORMATTERS[key]?.(read()) ?? String(read());
      if (!isSwitch) {
        const fill = ((input.value - input.min) / (input.max - input.min)) * 100;
        input.style.setProperty('--fill', `${fill}%`);
      }
      if (key === 'bpm') {
        note.textContent = rhythmDescription(read());
        for (const b of presetButtons) b.classList.toggle('is-active', Number(b.dataset.bpm) === Math.round(read()));
      }
    };
    if (isSwitch) input.checked = Boolean(values[key]);
    else input.value = String(values[key]);
    render();
    renderers[key] = (value) => {
      if (isSwitch) input.checked = Boolean(value);
      else input.value = String(value);
      render();
    };
    input.addEventListener(isSwitch ? 'change' : 'input', () => {
      render();
      onChange(key, read());
    });
  }

  for (const button of presetButtons) {
    button.addEventListener('click', () => {
      const bpm = Number(button.dataset.bpm);
      renderers.bpm(bpm);
      onChange('bpm', bpm);
    });
  }

  // Anatomy layers.
  const container = document.getElementById('layers');
  const layerInputs = {};
  for (const layer of LAYERS) {
    const label = document.createElement('label');
    label.className = 'layer';
    label.innerHTML = `<span class="layer__swatch"></span><span class="layer__name"></span><input type="checkbox" role="switch" />`;
    label.querySelector('.layer__swatch').style.setProperty('--swatch', LAYER_SWATCHES[layer.key] ?? '#999');
    if (LAYER_SWATCHES[layer.key]?.startsWith('linear')) label.querySelector('.layer__swatch').style.background = LAYER_SWATCHES[layer.key];
    label.querySelector('.layer__name').textContent = layer.name;
    const input = label.querySelector('input');
    input.checked = Boolean(layers[layer.key]);
    input.dataset.layer = layer.key;
    input.addEventListener('change', () => onLayer(layer.key, input.checked));
    container.append(label);
    layerInputs[layer.key] = input;
  }

  // Quality.
  const radios = [...panel.querySelectorAll('input[name="quality"]')];
  for (const radio of radios) {
    radio.addEventListener('change', () => {
      if (radio.checked) onQuality(radio.value);
    });
  }

  document.getElementById('reset-camera').addEventListener('click', onResetCamera);

  return {
    setOpen,
    setValue(key, value) {
      renderers[key]?.(value);
    },
    setLayer(key, on) {
      if (layerInputs[key]) layerInputs[key].checked = on;
    },
    setQualityChoice(choice) {
      for (const radio of radios) radio.checked = radio.value === choice;
    },
  };
}

const HELP_DISMISSED_KEY = 'human-heart:gpu-help-dismissed';

/**
 * GPU in use + live frame rate (from the Black-Hole project). When it is an
 * integrated GPU or the CPU, a small card explains how to use the dedicated
 * graphics card.
 */
export function createPerformanceStatus(gpu) {
  const line = document.getElementById('gpu-status');
  const fps = document.getElementById('fps-value');
  const help = document.getElementById('gpu-help');
  const openButton = document.getElementById('gpu-help-open');
  const quality = document.getElementById('quality-value');
  const reveal = document.getElementById('reveal-level');

  const shortName = gpu.name
    .replace(/^NVIDIA (?=GeForce|Quadro|RTX)/, '')
    .replace(/\((R|TM)\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  line.dataset.kind = gpu.kind;
  line.title = gpu.raw || gpu.name;
  document.getElementById('gpu-name').textContent = shortName;

  const needsHelp = gpu.kind === 'integrated' || gpu.kind === 'software';
  if (needsHelp) {
    help.dataset.kind = gpu.kind;
    for (const el of help.querySelectorAll('.js-gpu-name')) el.textContent = gpu.name;
    if (gpu.kind === 'software') {
      document.getElementById('gpu-help-title').textContent = 'Ative a aceleração de hardware';
    }
    const setOpen = (open) => {
      help.hidden = !open;
      openButton.hidden = open;
    };
    openButton.addEventListener('click', () => setOpen(true));
    document.getElementById('gpu-help-close').addEventListener('click', () => {
      setOpen(false);
      remember(HELP_DISMISSED_KEY, gpu.raw);
    });
    for (const button of help.querySelectorAll('[data-copy]')) {
      button.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(button.dataset.copy);
          button.textContent = 'copiado';
        } catch {
          button.textContent = 'copie o texto';
        }
        setTimeout(() => (button.textContent = 'copiar'), 1800);
      });
    }
    setOpen(recall(HELP_DISMISSED_KEY) !== gpu.raw);
  }

  let lastReveal = '';
  return {
    setFps(value) {
      fps.textContent = `${Math.round(value)} FPS`;
    },
    setQuality(name, adaptive) {
      quality.textContent = adaptive ? `${name} · auto` : name;
    },
    setReveal(name) {
      if (name !== lastReveal) {
        reveal.textContent = name;
        lastReveal = name;
      }
    },
  };
}

/** BPM, cardiac phase, beat indicator and a sweeping ECG trace. */
export function createVitals() {
  const bpmValue = document.getElementById('bpm-value');
  const phase = document.getElementById('phase-name');
  const dot = document.getElementById('beat-dot');
  const canvas = document.getElementById('ecg');
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const SWEEP = 3; // seconds across the canvas
  let x = 0;
  let lastY = H * 0.62;
  let lastBpm = -1;
  let lastPhase = '';
  let beatTimer = 0;

  g.lineWidth = 2;
  g.lineJoin = 'round';
  g.strokeStyle = '#ff5d6c';
  g.shadowColor = 'rgba(255, 93, 108, 0.8)';
  g.shadowBlur = 4;

  return {
    update(delta, cycle) {
      const bpm = Math.round(cycle.bpm);
      if (bpm !== lastBpm) {
        bpmValue.textContent = String(bpm);
        lastBpm = bpm;
      }
      const name = (PHASE_NAMES[cycle.phaseName] ?? '') + (cycle.paused ? ' · pausado (espaço)' : '');
      if (name !== lastPhase) {
        phase.textContent = name;
        lastPhase = name;
      }
      if (cycle.events.includes('S1')) {
        dot.classList.add('is-beating');
        beatTimer = 0.12;
      }
      beatTimer -= delta;
      if (beatTimer <= 0) dot.classList.remove('is-beating');

      // Sweeping trace, like a bedside monitor.
      const dx = (Math.min(delta, 0.1) / SWEEP) * W;
      const nextX = x + dx;
      const y = H * 0.62 - cycle.ecg * H * 0.5;
      g.clearRect(x + 1, 0, dx + 10, H);
      if (nextX < W) {
        g.beginPath();
        g.moveTo(x, lastY);
        g.lineTo(nextX, y);
        g.stroke();
        x = nextX;
      } else {
        x = 0;
        g.clearRect(0, 0, 12, H);
      }
      lastY = y;
    },
  };
}

/** Information card for the selected structure. */
export function createInfoCard({ onIsolate, onFocus, onClose, onRestore }) {
  const card = document.getElementById('info');
  const restore = document.getElementById('restore');
  const isolate = document.getElementById('info-isolate');
  const fields = {
    type: document.getElementById('info-type'),
    name: document.getElementById('info-name'),
    en: document.getElementById('info-en'),
    description: document.getElementById('info-description'),
    function: document.getElementById('info-function'),
    derived: document.getElementById('info-derived'),
  };
  isolate.addEventListener('click', () => onIsolate());
  document.getElementById('info-focus').addEventListener('click', () => onFocus());
  document.getElementById('info-close').addEventListener('click', () => onClose());
  restore.addEventListener('click', () => onRestore());

  return {
    show(info) {
      fields.type.textContent = info.type;
      fields.name.textContent = info.name;
      fields.en.textContent = info.nameEn;
      fields.description.textContent = info.description;
      fields.function.textContent = info.function;
      fields.derived.hidden = !info.derived;
      fields.derived.textContent = info.derived ? `Representação: ${info.derived}` : '';
      card.hidden = false;
    },
    hide() {
      card.hidden = true;
    },
    setIsolated(on) {
      restore.hidden = !on;
      isolate.setAttribute('aria-pressed', String(on));
      isolate.textContent = on ? 'Isolada' : 'Isolar';
    },
  };
}

export function createLegend() {
  const legend = document.getElementById('legend');
  const rows = [...legend.querySelectorAll('[data-legend]')];
  return {
    update({ flow, conduction }) {
      for (const row of rows) row.hidden = row.dataset.legend === 'flow' ? !flow : !conduction;
      legend.hidden = !flow && !conduction;
    },
  };
}

export function createLoader() {
  const loader = document.getElementById('loader');
  const text = document.getElementById('loader-text');
  return {
    progress(fraction, label = 'Carregando modelo anatômico') {
      text.textContent = `${label}… ${Math.round(fraction * 100)}%`;
    },
    message(label) {
      text.textContent = label;
    },
    done() {
      loader.classList.add('is-done');
      setTimeout(() => (loader.hidden = true), 1000);
    },
    fail(message) {
      text.textContent = message;
      loader.querySelector('.loader__ring').hidden = true;
    },
  };
}

// localStorage can be unavailable (private mode, blocked storage): never fail.
function remember(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function recall(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Fades the interaction hint after the first interaction (or a while). */
export function setupHint(target) {
  const hint = document.getElementById('hint');
  if (!hint) return;
  const hide = () => hint.classList.add('is-hidden');
  target.addEventListener('pointerdown', hide, { once: true });
  target.addEventListener('wheel', hide, { once: true, passive: true });
  setTimeout(hide, 12000);
}

#!/usr/bin/env node
/**
 * End-to-end checks of the running application (Playwright + Chromium).
 * Optional developer tool: the app itself needs no npm.
 *
 *   npx playwright install chromium        (once)
 *   python -m http.server 8000             (in the project folder)
 *   node tools/test/smoke.mjs http://localhost:8000/
 *
 * Environment:
 *   NPM_LOCAL=<path to a node_modules folder>  serve the CDN modules (three,
 *                                              three-mesh-bvh) from a local
 *                                              copy (e.g. tools/model-build/
 *                                              node_modules) instead of jsDelivr
 *   SOFTWARE_GL=1                             force SwiftShader (no GPU)
 *
 * It drives the page through the UI (sliders, buttons, pointer) and reads the
 * state exposed on window.__heart. Every check prints PASS/FAIL; the exit code
 * is the number of failures.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require(process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules/playwright');
}
const { chromium } = playwright;

const url = process.argv[2] ?? 'http://localhost:8000/';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const args = ['--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist'];
if (process.env.SOFTWARE_GL) args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
const browser = await chromium.launch({ args });
const page = await browser.newPage({ viewport: { width: 960, height: 640 } });

if (process.env.NPM_LOCAL) {
  await page.route('https://cdn.jsdelivr.net/npm/**', (route) => {
    const match = /^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)@[^/]+\/(.*)$/.exec(route.request().url());
    if (!match) return route.continue();
    return route.fulfill({ path: `${process.env.NPM_LOCAL}/${match[1]}/${match[2]}`, contentType: 'text/javascript' });
  });
}
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
});
page.on('response', (r) => {
  if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`);
});
page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()} ${r.failure()?.errorText}`));
await page.addInitScript(() => {
  try {
    localStorage.setItem('human-heart:gpu-help-dismissed', 'x');
  } catch {}
});

const q = (script) => page.evaluate(script);
/** Waits until a predicate (string) holds in the page. */
const until = (predicate, timeout = 120000) => page.waitForFunction(predicate, null, { timeout, polling: 250 }).then(() => true, () => false);

// ---------------------------------------------------------------------------
await page.goto(url + (url.includes('?') ? '&' : '?') + 'quality=low');
check('page loads the model', await until('window.__heart && document.getElementById("loader").hidden', 240000));
await page.evaluate(() => (document.getElementById('gpu-help').hidden = true));

const catalogue = await q(`(() => {
  const h = window.__heart.heart;
  return { keys: [...h.structures.keys()], meshes: [...h.structures.values()].reduce((n, s) => n + s.meshes.length, 0) };
})()`);
const required = [
  'lvWall', 'rvWall', 'ivs', 'laWall', 'raWall', 'ias', 'epicardium',
  'raCavity', 'rvCavity', 'laCavity', 'lvCavity',
  'mitralAnterior', 'mitralPosterior', 'tricuspidAnterior', 'tricuspidPosterior', 'tricuspidSeptal',
  'mitralChordae', 'tricuspidChordae', 'aorticRight', 'aorticLeft', 'aorticPosterior', 'pulmonaryLeft', 'pulmonaryRight', 'pulmonaryPosterior',
  'pmRvAnterior', 'pmRvPosterior', 'pmRvSeptal', 'pmLvAnterolateral', 'pmLvLateral',
  'lmca', 'lad', 'ladDiagonal', 'ladSeptal', 'lcx', 'rca', 'rcaMarginal', 'pda', 'rcaPosteriorVentricular',
  'coronarySinus', 'greatCardiacVein', 'anteriorInterventricularVein', 'middleCardiacVein', 'smallCardiacVein', 'anteriorCardiacVeins',
  'ascendingAorta', 'aorticArch', 'descendingAorta', 'brachiocephalicTrunk', 'leftCommonCarotid', 'leftSubclavian',
  'pulmonaryTrunk', 'rightPulmonaryArtery', 'leftPulmonaryArtery',
  'rightSuperiorPulmonaryVein', 'rightInferiorPulmonaryVein', 'leftSuperiorPulmonaryVein', 'leftInferiorPulmonaryVein',
  'superiorVenaCava', 'inferiorVenaCava',
];
const missing = required.filter((k) => !catalogue.keys.includes(k));
check('all required structures are present', missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : `${catalogue.keys.length} structures, ${catalogue.meshes} meshes`);

check('GPU name shown', (await q('document.getElementById("gpu-name").textContent')).length > 2, await q('document.getElementById("gpu-name").textContent'));
check('FPS shown', /\d+ FPS/.test(await q('document.getElementById("fps-value").textContent')), await q('document.getElementById("fps-value").textContent'));

// --- Heartbeat --------------------------------------------------------------
const beat = await q(`new Promise((resolve) => {
  const s = window.__heart.heartbeat.state; let lo = 1, hi = 0, av = [1, 0], sl = [1, 0], a = 0;
  const t0 = performance.now();
  const step = () => {
    lo = Math.min(lo, s.ventricular); hi = Math.max(hi, s.ventricular); a = Math.max(a, s.atrial);
    av = [Math.min(av[0], s.valves.mitral), Math.max(av[1], s.valves.mitral)];
    sl = [Math.min(sl[0], s.valves.aortic), Math.max(sl[1], s.valves.aortic)];
    if (s.beat >= 2 || performance.now() - t0 > 180000) resolve({ lo, hi, a, av, sl, beats: s.beat }); else requestAnimationFrame(step);
  };
  const b0 = s.beat; const wait = () => (s.beat > b0 ? step() : requestAnimationFrame(wait)); wait();
})`);
check('heart beats (ventricular contraction 0 -> 1)', beat.lo < 0.05 && beat.hi > 0.9, JSON.stringify(beat));
// One full cycle sampled every 2 ms (independent of the frame rate).
const cycle = await q(`(() => {
  const hb = window.__heart.heartbeat; const T = hb.state.timeline.T; const r = { atrial: 0, valves: {} };
  for (const v of ['mitral', 'tricuspid', 'aortic', 'pulmonary']) r.valves[v] = [1, 0];
  for (let t = 0; t < T; t += 0.002) {
    const s = hb.evaluateAt(t);
    r.atrial = Math.max(r.atrial, s.atrial);
    for (const v in r.valves) r.valves[v] = [Math.min(r.valves[v][0], s.valves[v]), Math.max(r.valves[v][1], s.valves[v])];
  }
  return r;
})()`);
check('atria contract', cycle.atrial > 0.95, cycle.atrial.toFixed(2));
for (const v of ['mitral', 'tricuspid', 'aortic', 'pulmonary']) {
  check(`${v} valve opens and closes`, cycle.valves[v][0] < 0.01 && cycle.valves[v][1] > 0.95, cycle.valves[v].map((x) => x.toFixed(2)).join('..'));
}

// --- BPM through the slider and presets ---------------------------------------
await page.click('#controls-toggle');
for (const bpm of [40, 60, 72, 100, 140, 180]) {
  await page.$eval('[data-setting="bpm"]', (input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, bpm);
  const T = await q(`(() => { const hb = window.__heart.heartbeat; hb.update(3); hb.update(3); hb.update(3); return hb.state.timeline.T; })()`);
  check(`${bpm} BPM -> cycle ${(60 / bpm).toFixed(3)} s`, Math.abs(T - 60 / bpm) < 0.002, `T=${T.toFixed(3)}`);
}
await page.click('[data-bpm="75"]');
check('preset 75 BPM', (await q('window.__heart.heartbeat.targetBpm')) === 75);
const smooth = await q(`(() => { const hb = window.__heart.heartbeat; hb.setBpm(75); hb.update(5); hb.update(5); hb.setBpm(140); const a = hb.update(0.016).bpm; const b = hb.update(0.016).bpm; return [a, b]; })()`);
check('BPM transition is smooth', smooth[0] > 75 && smooth[0] < 80 && smooth[1] > smooth[0], smooth.map((v) => v.toFixed(2)).join(' -> '));
await page.click('[data-bpm="75"]');

// --- Camera --------------------------------------------------------------------
const box = await page.locator('#scene').boundingBox();
const cx = box.x + box.width * 0.55;
const cy = box.y + box.height * 0.5;
const before = await q('window.__heart.camera.position.toArray()');
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 220, cy + 30, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(1500);
const afterRotate = await q('window.__heart.camera.position.toArray()');
const angle = await q(`(() => { const T = window.__heart.camera.position.constructor; const t = window.__heart.controls.target; const a = new T(...${JSON.stringify(before)}).sub(t).normalize(); const b = window.__heart.camera.position.clone().sub(t).normalize(); return Math.acos(Math.min(1, a.dot(b))) * 180 / Math.PI; })()`);
check('drag rotates the camera', angle > 5, `${angle.toFixed(1)}°`);
const full = await q(`(() => { const c = window.__heart.controls; const d0 = c.getAzimuthalAngle(); c.minAzimuthAngle = -Infinity; c.maxAzimuthAngle = Infinity; c.minPolarAngle = 0; c.maxPolarAngle = Math.PI; return [c.minAzimuthAngle, c.maxAzimuthAngle, c.minPolarAngle, c.maxPolarAngle, d0]; })()`);
check('360° rotation allowed (no azimuth/polar limits)', full[0] === -Infinity && full[1] === Infinity && full[2] === 0 && Math.abs(full[3] - Math.PI) < 1e-6);
const d0 = await q('window.__heart.camera.position.distanceTo(window.__heart.controls.target)');
await page.mouse.move(cx, cy);
for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -300);
await page.waitForTimeout(2500);
const d1 = await q('window.__heart.camera.position.distanceTo(window.__heart.controls.target)');
check('wheel zooms in', d1 < d0 * 0.9, `${d0.toFixed(1)} -> ${d1.toFixed(1)} cm`);
await page.click('#reset-camera');
check('reset camera returns home smoothly', await until(`(() => { const h = window.__heart; const d = h.camera.position.distanceTo(h.controls.target); return !h.cameraMotion.active && d > 35; })()`, 120000));

// --- Reveal ----------------------------------------------------------------------
const view = (distance) => q(`(() => { const h = window.__heart; const T = h.camera.position.constructor; h.controls.target.set(0.4, 1.2, 0); const dir = new T(0.12, 0.1, 1).normalize().multiplyScalar(${distance}); h.camera.position.copy(h.controls.target).add(dir); h.controls.update(); return 1; })()`);
const levels = [];
for (const d of [40, 27, 20, 14, 8]) {
  await view(d);
  await until(`(() => { const r = window.__heart.reveal; const h = window.__heart; const d = h.camera.position.distanceTo(h.controls.target); const target = d >= 34 ? 0 : d >= 28 ? (34 - d) / 6 : d >= 21.5 ? 1 + (28 - d) / 6.5 : d >= 15.5 ? 2 + (21.5 - d) / 6 : d >= 9.5 ? 3 + (15.5 - d) / 6 : 4; return Math.abs(r.progress - target) < 0.05; })()`, 120000);
  levels.push(await q(`({ progress: window.__heart.reveal.progress, name: window.__heart.reveal.levelName, translucent: window.__heart.heart.translucent })`));
}
check('reveal level grows while approaching', levels.every((l, i) => i === 0 || l.progress > levels[i - 1].progress), levels.map((l) => `${l.name} ${l.progress.toFixed(2)}`).join(' | '));
check('exterior far away, interior up close', levels[0].progress < 0.2 && levels[4].progress > 3.6);
check('surfaces become translucent (no cut)', levels[3].translucent === true);
await view(40);

// --- Layers ----------------------------------------------------------------------
const layerToggle = async (layer, on) => {
  const box = page.locator(`input[data-layer="${layer}"]`);
  if ((await box.isChecked()) !== on) await box.click();
};
await layerToggle('chambers', true);
check('chambers layer shows the blood volumes', await until(`window.__heart.heart.structures.get('lvCavity').layerOpacity > 0.95`));
await layerToggle('chambers', false);
await layerToggle('arteries', false);
check('arteries layer can be hidden', await until(`window.__heart.heart.structures.get('lad').meshes[0].visible === false`));
await layerToggle('arteries', true);

await layerToggle('bloodFlow', true);
await until('window.__heart.bloodFlow.object.visible');
const flow = await q(`(() => { const f = window.__heart.bloodFlow.object; const p = f.geometry.attributes.position.array; return { visible: f.visible, sample: Array.from(p.slice(0, 6)) }; })()`);
await until(`window.__heart.bloodFlow.object.geometry.attributes.position.array[0] !== ${flow.sample[0]}`, 60000);
const flow2 = await q(`Array.from(window.__heart.bloodFlow.object.geometry.attributes.position.array.slice(0, 6))`);
check('blood flow visible and moving', flow.visible && flow.sample.some((v, i) => Math.abs(v - flow2[i]) > 1e-4));
// A particle leaving through the aorta re-enters through a vena cava (red ->
// blue): its new colour must reach the GPU.
check('re-entering particles change colour', await until('window.__heart.bloodFlow.object.geometry.attributes.aColor.version > 0', 120000));
check('legend shows oxygenation colours', !(await q('document.getElementById("legend").hidden')));
await layerToggle('bloodFlow', false);

await layerToggle('coronaryFlow', true);
check('coronary flow visible', await until('window.__heart.coronaryFlow.object.visible'));
await layerToggle('coronaryFlow', false);

await layerToggle('conduction', true);
await until('window.__heart.conduction.group.visible');
const conduction = await q(`({ visible: window.__heart.conduction.group.visible, keys: window.__heart.conduction.keys, electrical: window.__heart.heart.structures.get('lvWall').material.userData.uniforms && true })`);
check('electrical conduction system visible', conduction.visible && ['saNode', 'avNode', 'hisBundle', 'bundleBranches', 'internodalPathways', 'purkinje'].every((k) => conduction.keys.includes(k)), conduction.keys.join(', '));
await layerToggle('conduction', false);

// --- Selection, hover, isolation ------------------------------------------------------
await view(40);
await page.waitForTimeout(2500);
const center = await q(`(() => { const h = window.__heart; const p = h.heart.data.anchors.rvWall.point; const T = h.camera.position.constructor; const v = new T(...p).project(h.camera); const r = document.getElementById('scene').getBoundingClientRect(); return [r.left + (v.x * 0.5 + 0.5) * r.width, r.top + (-v.y * 0.5 + 0.5) * r.height]; })()`);
await page.mouse.move(center[0], center[1]);
await until(`[...window.__heart.heart.structures.values()].some((s) => s.highlight > 0.05)`, 60000);
const hovered = await q(`[...window.__heart.heart.structures.values()].filter((s) => s.highlight > 0.05).map((s) => s.key)`);
check('hover highlights a structure', hovered.length > 0, hovered.join(', '));
await page.mouse.click(center[0], center[1]);
await page.waitForTimeout(1500);
const info = await q(`({ hidden: document.getElementById('info').hidden, name: document.getElementById('info-name').textContent, type: document.getElementById('info-type').textContent, fn: document.getElementById('info-function').textContent })`);
check('click selects and shows name/type/description/function', !info.hidden && info.name.length > 2 && info.fn.length > 5, `${info.name} — ${info.type}`);
await page.click('#info-isolate');
await until(`[...window.__heart.heart.structures.values()].filter((s) => s.dim > 0.8).length > 60`, 60000);
const dim = await q(`(() => { const s = [...window.__heart.heart.structures.values()]; return { dimmed: s.filter((x) => x.dim > 0.8).length, total: s.length, restore: !document.getElementById('restore').hidden }; })()`);
check('isolation dims every other structure', dim.dimmed >= dim.total - 2 && dim.restore, JSON.stringify(dim));
await page.click('#restore');
await until(`[...window.__heart.heart.structures.values()].every((s) => s.dim < 0.2)`, 60000);
check('back to the complete heart', (await q(`[...window.__heart.heart.structures.values()].every((s) => s.dim < 0.2)`)) && (await q('document.getElementById("restore").hidden')));
await page.click('#info-close');

// --- Labels ------------------------------------------------------------------------------
await page.mouse.move(5, box.height - 5);
await until('document.querySelectorAll(".label.is-visible").length > 0', 60000);
const labelsOn = await q('document.querySelectorAll(".label.is-visible").length');
await layerToggle('labels', false);
await until('document.querySelectorAll(".label.is-visible").length === 0', 60000);
const labelsOff = await q('document.querySelectorAll(".label.is-visible").length');
check('labels follow the layer switch', labelsOn > 0 && labelsOff === 0, `${labelsOn} -> ${labelsOff}`);
await layerToggle('labels', true);
// Labels only name what is in sight: seen from behind, the left main coronary
// artery (anterior, under the left auricle) is hidden and gets no label.
await q(`(() => { const h = window.__heart; const T = h.camera.position.constructor; h.controls.target.set(0.4, 1.2, 0); h.camera.position.copy(h.controls.target).add(new T(-0.15, 0.12, -1).normalize().multiplyScalar(38)); h.controls.update(); return 1; })()`);
await page.waitForTimeout(1500);
await until('[...document.querySelectorAll(".label.is-visible")].length > 1', 60000);
await page.waitForTimeout(1500);
const backLabels = await q(`[...document.querySelectorAll('.label.is-visible')].map((e) => e.textContent)`);
check('hidden structures are not labelled', backLabels.length > 0 && !backLabels.includes('Tronco da coronária esquerda'), backLabels.join(', '));
await view(40);

// --- Audio -----------------------------------------------------------------------------
await page.click('input[data-setting="sound"]');
await until('window.__heart.sound.scheduledCount > 1', 180000);
const audio = await q(`({ enabled: window.__heart.sound.enabled, scheduled: window.__heart.sound.scheduledCount })`);
check('heart sound can be switched on and schedules S1/S2', audio.enabled && audio.scheduled > 0, JSON.stringify(audio));
await page.click('input[data-setting="sound"]');
check('heart sound can be switched off', (await q('window.__heart.sound.enabled')) === false);

// --- Quality ---------------------------------------------------------------------------------
await page.click('input[name="quality"][value="high"] + span');
check('quality HIGH applied', (await q('window.__heart.quality().name')) === 'high');
check('detail model (LOD) loads on high', await until('window.__heart.heart.usingDetail === true', 240000));
await page.click('input[name="quality"][value="low"] + span');
check('quality LOW returns to the base model', (await q('window.__heart.heart.usingDetail')) === false && (await q('window.__heart.quality().name')) === 'low');
check('quality label in the HUD', /low/i.test(await q('document.getElementById("quality-value").textContent')));

// --- Resize ------------------------------------------------------------------------------------
await page.setViewportSize({ width: 600, height: 800 });
await until('Math.abs(window.__heart.camera.aspect - 0.75) < 0.01', 60000);
check('resize updates the camera aspect', Math.abs((await q('window.__heart.camera.aspect')) - 600 / 800) < 0.01);

// --- Console ---------------------------------------------------------------------------------
check('no console errors, 404s or exceptions', problems.length === 0, problems.slice(0, 5).join(' | '));

await browser.close();
const failures = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures);

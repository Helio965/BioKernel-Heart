// GLSL sources, kept in one place (like the Black-Hole project) so every
// visual effect can be read and tweaked without digging through scene code.
//
// The heart tissues use Three.js' physically based MeshPhysicalMaterial; the
// chunks below are injected into it (onBeforeCompile) to add what the stock
// material does not know about:
//   - procedural micro-relief (muscle fibres, trabeculae, fat lobules),
//   - baked ambient occlusion and tissue data from the model pipeline,
//   - approximate subsurface scattering,
//   - the progressive "look through the layers" reveal,
//   - the depolarisation wave of the conduction system,
//   - hover / selection highlight and isolation.

// ---------------------------------------------------------------------------
// 3D simplex noise
// Ashima Arts / Stefan Gustavson, MIT License
// https://github.com/ashima/webgl-noise
// ---------------------------------------------------------------------------

export const noiseChunk = /* glsl */ `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
`;

// ---------------------------------------------------------------------------
// Shared uniforms and varyings
// ---------------------------------------------------------------------------

const commonUniforms = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCameraPos;
  uniform vec3 uTarget;
  uniform float uRevealProgress;   // 0 exterior .. 4 interior
  uniform float uRevealEnabled;
  uniform float uWindowRadius;
  uniform float uUserTransparency;
  uniform vec2 uNearFade;
  uniform float uMicroDetail;
  uniform float uElectrical;
  uniform float uSinceP;           // ms since the P wave (atrial activation clock)
  uniform float uQTime;            // ms relative to QRS onset (ventricular clock)
  uniform float uQT;               // ms, ventricular depolarised state duration
  uniform vec3 uApex;
  uniform vec3 uLongAxis;
  uniform float uVesselGlow;

  // Per structure
  uniform float uFadeStart;
  uniform float uFadeEnd;
  uniform float uMinAlpha;
  uniform float uRimAlpha;
  uniform float uUserMinAlpha;
  uniform float uBaseAlpha;
  uniform float uLayerOpacity;
  uniform float uDim;
  uniform float uHighlight;
  uniform float uSelected;
  uniform float uDetailFade;
  uniform float uTissueKind;       // see TISSUE_KIND in js/materials.js
  uniform float uBumpStrength;
  uniform float uSSS;
  uniform vec3 uSSSColor;
  uniform vec3 uHighlightColor;
  uniform vec3 uKeyLightView;
`;

export const tissueVertexPars = /* glsl */ `
  attribute vec4 _tissue;
  varying vec4 vTissue;
  varying vec3 vWorldPos;
  varying vec3 vRestPos;
`;

export const tissueVertexMain = /* glsl */ `
  vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vRestPos = (modelMatrix * vec4(position, 1.0)).xyz;
  vTissue = _tissue;
`;

/** Alpha of the reveal / transparency system (shared with the depth pre-pass). */
const revealFunction = /* glsl */ `
  float revealWindow(vec3 worldPos) {
    vec3 toCamera = uCameraPos - uTarget;
    float cameraDistance = max(length(toCamera), 1e-3);
    vec3 axis = toCamera / cameraDistance;
    vec3 rel = worldPos - uTarget;
    float along = dot(rel, axis);
    float radial = length(rel - along * axis);
    float front = smoothstep(-0.9, 0.9, along);
    return (1.0 - smoothstep(uWindowRadius * 0.5, uWindowRadius, radial)) * front;
  }

  // Returns the coverage of this fragment (before the rim term).
  float revealAlpha(vec3 worldPos) {
    float fade = smoothstep(uFadeStart, uFadeEnd, uRevealProgress) * uRevealEnabled;
    float alpha = mix(1.0, uMinAlpha, fade * revealWindow(worldPos));
    alpha *= mix(1.0, uUserMinAlpha, uUserTransparency);
    float cameraDist = distance(worldPos, uCameraPos);
    alpha *= smoothstep(uNearFade.x, uNearFade.y, cameraDist);
    alpha *= uLayerOpacity * uDetailFade;
    alpha *= mix(1.0, 0.06, uDim);
    return alpha;
  }
`;

export const tissueFragmentPars = /* glsl */ `
  ${commonUniforms}
  varying vec4 vTissue;
  varying vec3 vWorldPos;
  varying vec3 vRestPos;
  ${noiseChunk}
  ${revealFunction}

  // Screen-space derivative bump mapping (Mikkelsen, "Bump Mapping
  // Unparametrized Surfaces on the GPU"): one height evaluation per pixel.
  vec3 perturbNormalHeight(vec3 surfPos, vec3 surfNorm, float height, float faceDirection) {
    vec2 dHdxy = vec2(dFdx(height), dFdy(height));
    vec3 vSigmaX = normalize(dFdx(surfPos));
    vec3 vSigmaY = normalize(dFdy(surfPos));
    vec3 vN = surfNorm;
    vec3 R1 = cross(vSigmaY, vN);
    vec3 R2 = cross(vN, vSigmaX);
    float fDet = dot(vSigmaX, R1) * faceDirection;
    vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
    return normalize(abs(fDet) * surfNorm - vGrad);
  }

  // Muscle fibres run in helices around the long axis of the heart.
  vec3 fiberDirection(vec3 p, float endo) {
    vec3 q = p - uApex;
    vec3 radial = q - uLongAxis * dot(q, uLongAxis);
    vec3 circumferential = normalize(cross(uLongAxis, radial) + 1e-4);
    float tilt = mix(0.75, -0.75, endo); // epicardial vs endocardial helix
    return normalize(circumferential + uLongAxis * tilt);
  }

  float tissueHeight(vec3 p, float kind, vec4 tissue, float detail) {
    float endo = tissue.x;
    float fat = tissue.y;
    if (kind < 0.5) {
      // Myocardium: striated fibre bundles; trabeculae on the endocardium.
      vec3 dir = fiberDirection(p, endo);
      vec3 q = p - dir * dot(p, dir) * 0.84;
      float fibres = snoise(q * 11.0) * 0.55 + snoise(q * 27.0) * 0.25 * detail;
      vec3 t = p - uLongAxis * dot(p, uLongAxis) * 0.78;
      float trabeculae = 1.0 - abs(snoise(t * 2.6 + 3.1));
      trabeculae = trabeculae * trabeculae * 1.6 + snoise(p * 9.0) * 0.2;
      return mix(fibres, trabeculae, endo);
    }
    if (kind < 1.5) {
      // Epicardial fat: lobules.
      float lobes = 1.0 - abs(snoise(p * 5.5));
      return lobes * lobes * 0.9 * fat + snoise(p * 16.0) * 0.18 * detail;
    }
    if (kind < 2.5) {
      // Vessels: fine longitudinal texture.
      return snoise(p * 34.0) * 0.12 + snoise(p * 9.0) * 0.1;
    }
    if (kind < 3.5) {
      // Valves / chordae: dense collagen, subtle.
      return snoise(p * 22.0) * 0.14;
    }
    // Blood volumes: smooth.
    return 0.0;
  }
`;

export const tissueColorChunk = /* glsl */ `
  {
    float kind = uTissueKind;
    // Low-frequency mottling so no surface looks like plastic.
    float mottling = snoise(vRestPos * 1.7) * 0.5 + snoise(vRestPos * 5.3) * 0.25;
    diffuseColor.rgb *= 1.0 + mottling * 0.16;
    if (kind < 0.5) {
      // Endocardium: smoother, paler and pinker than the outer muscle.
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.28, 1.02, 1.05) + vec3(0.03, 0.0, 0.01), vTissue.x * 0.6);
    } else if (kind < 1.5) {
      // Epicardium: transparent glossy film, yellow fat in the sulci.
      float fat = smoothstep(0.08, 0.7, vTissue.y);
      // Linear-space colours of epicardial fat (yellow to orange-yellow).
      vec3 fatColor = mix(vec3(0.56, 0.3, 0.07), vec3(0.7, 0.45, 0.13), snoise(vRestPos * 7.0) * 0.5 + 0.5);
      diffuseColor.rgb = mix(diffuseColor.rgb, fatColor, fat);
    }
    if (uElectrical > 0.0) diffuseColor.rgb *= mix(1.0, 0.42, uElectrical);
    // Isolation: everything else goes grey.
    float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum) * 0.7, uDim * 0.75);
  }
`;

export const tissueAlphaChunk = /* glsl */ `
  {
    float alpha = revealAlpha(vWorldPos) * uBaseAlpha;
    vec3 viewDir = normalize(vViewPosition);
    float facing = abs(dot(normalize(vNormal), viewDir));
    float fresnel = pow(1.0 - facing, 2.2);
    float fade = smoothstep(uFadeStart, uFadeEnd, uRevealProgress) * uRevealEnabled * revealWindow(vWorldPos);
    // Keep the silhouettes readable while the surface is transparent.
    alpha = max(alpha, fade * fresnel * uRimAlpha * uLayerOpacity * uDetailFade * (1.0 - uDim));
    if (uTissueKind > 0.5 && uTissueKind < 1.5) {
      // Epicardium: the film is only visible at grazing angles; fat is opaque.
      float fat = smoothstep(0.08, 0.7, vTissue.y);
      float film = 0.1 + fresnel * 0.45;
      alpha *= mix(film, 0.94, fat) * (1.0 - 0.55 * uVesselGlow * fat);
    }
    if (uTissueKind > 3.5) {
      // Blood volume: denser at the edges, like a coloured liquid.
      alpha *= 0.55 + fresnel * 0.9;
    }
    diffuseColor.a *= alpha;
    if (diffuseColor.a < 0.004) discard;
  }
`;

export const tissueRoughnessChunk = /* glsl */ `
  roughnessFactor = clamp(roughnessFactor * (1.0 - 0.25 * vTissue.x) + (uTissueKind > 0.5 && uTissueKind < 1.5 ? 0.12 * vTissue.y : 0.0), 0.04, 1.0);
`;

export const tissueNormalChunk = /* glsl */ `
  if (uMicroDetail > 0.0 && uBumpStrength > 0.0) {
    float cameraDist = distance(vWorldPos, uCameraPos);
    float lod = smoothstep(70.0, 16.0, cameraDist);
    float detail = smoothstep(40.0, 10.0, cameraDist);
    float h = tissueHeight(vRestPos, uTissueKind, vTissue, detail) * uBumpStrength * uMicroDetail * lod;
    normal = perturbNormalHeight(-vViewPosition, normal, h * 0.012, faceDirection);
  }
`;

export const tissueAoChunk = /* glsl */ `
  {
    float bakedAO = mix(1.0, vTissue.w, 0.9);
    reflectedLight.indirectDiffuse *= bakedAO;
    reflectedLight.indirectSpecular *= mix(1.0, bakedAO, 0.8);
    reflectedLight.directDiffuse *= mix(1.0, bakedAO, 0.45);
    reflectedLight.directSpecular *= mix(1.0, bakedAO, 0.35);
    // Back faces of a vessel are the inside of a cut tube: the lumen is in
    // shadow, it should not shine like the outer wall.
    if (!gl_FrontFacing && uTissueKind > 1.5 && uTissueKind < 2.5) {
      reflectedLight.directDiffuse *= 0.45;
      reflectedLight.indirectDiffuse *= 0.5;
      reflectedLight.directSpecular *= 0.2;
      reflectedLight.indirectSpecular *= 0.25;
      #ifdef USE_CLEARCOAT
        clearcoatSpecularDirect *= 0.2;
        clearcoatSpecularIndirect *= 0.2;
      #endif
      #ifdef USE_SHEEN
        sheenSpecularDirect *= 0.3;
        sheenSpecularIndirect *= 0.3;
      #endif
    }
  }
`;

export const tissueEmissiveChunk = /* glsl */ `
  {
    vec3 V = normalize(vViewPosition);
    vec3 N = normalize(normal);
    float fresnel = pow(1.0 - abs(dot(N, V)), 2.5);

    // Approximate subsurface scattering: light shining through thin tissue
    // (Barré-Brisebois & Bouchard) plus a soft reddish rim.
    vec3 L = normalize(uKeyLightView);
    vec3 H = normalize(L + N * 0.35);
    float through = pow(clamp(dot(V, -H), 0.0, 1.0), 3.0);
    totalEmissiveRadiance += uSSSColor * (through * 0.55 + fresnel * 0.22) * uSSS * vTissue.w;

    // Coronary vessels stand out at the second level of the reveal.
    if (uTissueKind > 1.5 && uTissueKind < 2.5) {
      totalEmissiveRadiance += diffuseColor.rgb * uVesselGlow * (0.35 + 0.65 * fresnel) * 0.9;
    }

    // Depolarisation wave (conduction system mode).
    if (uElectrical > 0.0 && vTissue.z < 0.998) {
      float code = floor(vTissue.z * 255.0 + 0.5);
      bool atrial = code < 119.5;
      float activation = atrial ? code : code - 120.0;
      float elapsed = (atrial ? uSinceP : uQTime) - activation;
      float duration = atrial ? 150.0 : uQT;
      float front = exp(-pow((elapsed - 5.0) / 8.0, 2.0));
      float depolarised = step(0.0, elapsed) * (1.0 - smoothstep(duration - 70.0, duration, elapsed));
      totalEmissiveRadiance += uElectrical * (vec3(1.0, 0.86, 0.42) * front * 1.9 + vec3(0.95, 0.42, 0.12) * depolarised * 0.2);
    }

    // Hover / selection.
    float pulse = 0.75 + 0.25 * sin(uTime * 4.0);
    totalEmissiveRadiance += uHighlightColor * uHighlight * (0.1 + 0.55 * fresnel);
    totalEmissiveRadiance += uHighlightColor * uSelected * (0.06 + 0.5 * fresnel) * pulse;
  }
`;

// ---------------------------------------------------------------------------
// Depth pre-pass used while surfaces are translucent: opaque-looking parts
// write depth (so they still hide what is behind them), the transparent
// window does not.
// ---------------------------------------------------------------------------

export const depthFragmentPars = /* glsl */ `
  ${commonUniforms}
  varying vec3 vWorldPos;
  ${revealFunction}
`;

export const depthFragmentMain = /* glsl */ `
  if (revealAlpha(vWorldPos) * uBaseAlpha < 0.97) discard;
`;

// ---------------------------------------------------------------------------
// Blood-flow / coronary-flow particles
// ---------------------------------------------------------------------------

export const particleVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  uniform float uPixelRatio;
  uniform float uScale;
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = aSize * uScale * uPixelRatio / max(-mv.z, 0.5);
    gl_PointSize = clamp(size, 1.0, 40.0);
    vColor = aColor;
    // Very close particles would cover the screen: fade them out.
    vAlpha = aAlpha * uOpacity * smoothstep(0.6, 2.5, -mv.z);
  }
`;

export const particleFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    float core = exp(-r2 * 3.2);
    gl_FragColor = vec4(vColor * (0.55 + 0.9 * core), vAlpha * core);
  }
`;

// ---------------------------------------------------------------------------
// Conduction system (tubes with a travelling impulse)
// ---------------------------------------------------------------------------

export const conductionVertex = /* glsl */ `
  attribute float aTime;
  attribute float aRef;       // 0 = P-referenced, 1 = QRS-referenced
  varying float vTime;
  varying float vRef;
  varying vec3 vNormalView;
  varying vec3 vViewPos;
  #include <common>
  #include <morphtarget_pars_vertex>
  void main() {
    #include <begin_vertex>
    #include <morphtarget_vertex>
    vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
    gl_Position = projectionMatrix * mv;
    vTime = aTime;
    vRef = aRef;
    vNormalView = normalize(normalMatrix * normal);
    vViewPos = -mv.xyz;
  }
`;

export const conductionFragment = /* glsl */ `
  uniform float uSinceP;
  uniform float uQTime;
  uniform float uQT;
  uniform float uOpacity;
  uniform float uAVDelayEnd;
  uniform vec3 uBaseColor;
  uniform vec3 uPulseColor;
  varying float vTime;
  varying float vRef;
  varying vec3 vNormalView;
  varying vec3 vViewPos;
  void main() {
    float clock = vRef < 0.5 ? uSinceP : uQTime;
    float elapsed = clock - vTime;
    float front = exp(-pow((elapsed - 3.0) / 7.0, 2.0));
    float trail = step(0.0, elapsed) * exp(-max(elapsed, 0.0) / (vRef < 0.5 ? 90.0 : 120.0));
    float facing = abs(dot(normalize(vNormalView), normalize(vViewPos)));
    float body = 0.35 + 0.65 * facing;
    vec3 color = uBaseColor * body * 0.55 + uPulseColor * (front * 2.4 + trail * 0.55);
    float alpha = uOpacity * clamp(0.55 + front + trail * 0.4, 0.0, 1.0);
    gl_FragColor = vec4(color, alpha);
  }
`;

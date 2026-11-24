"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

const LOOP_LENGTH = 120;
const LOOP_K = (Math.PI * 2) / LOOP_LENGTH;

function getTerrainHeight(x, z) {
  const bankFactor = Math.min(Math.abs(x) / 34, 1.35);
  const valleyProfile = Math.pow(bankFactor, 2.05) * 7.6;
  const undulation =
    Math.sin(x * 0.14 + z * LOOP_K * 2.0) * 1.15 +
    Math.cos(x * 0.23 - z * LOOP_K * 3.0) * 0.62 +
    Math.sin(z * LOOP_K * 1.0) * 0.8;
  const micro = Math.sin(x * 0.65 + z * LOOP_K * 6.0) * 0.15;
  return valleyProfile + undulation + micro - 1.9;
}

function getValleyCenterX(z) {
  return Math.sin(z * LOOP_K * 1.0) * 2.4;
}

function seededRandom(seed) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Builds a multi-petal botanical blossom BufferGeometry (cupped bell or star lily)
 * with an aPetalWeight attribute (0 at stem base -> 1 at petal tips) for GPU swaying & blooming.
 */
function createFlowerGeometry(THREE, variant = "bell") {
  const positions = [];
  const normals = [];
  const petalWeights = [];
  const radialDirs = [];
  const indices = [];

  let vertexOffset = 0;

  // Slender stem from y=0 to y=0.38
  const stemSegs = 4;
  const stemRadiusBottom = 0.022;
  const stemRadiusTop = 0.015;
  const stemSides = 5;

  for (let i = 0; i <= stemSegs; i++) {
    const t = i / stemSegs;
    const y = t * 0.38;
    const r = stemRadiusBottom + (stemRadiusTop - stemRadiusBottom) * t;
    const bendX = Math.sin(t * Math.PI * 0.5) * 0.02;

    for (let s = 0; s <= stemSides; s++) {
      const a = (s / stemSides) * Math.PI * 2;
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      positions.push(bendX + nx * r, y, nz * r);
      normals.push(nx, 0.15, nz);
      petalWeights.push(t * 0.25);
      radialDirs.push(0, 0);
    }
  }

  for (let i = 0; i < stemSegs; i++) {
    for (let s = 0; s < stemSides; s++) {
      const a = vertexOffset + i * (stemSides + 1) + s;
      const b = a + stemSides + 1;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, b, c, c, b, d);
    }
  }
  vertexOffset += (stemSegs + 1) * (stemSides + 1);

  // Sculpted petals around the calyx
  const petalCount = variant === "star" ? 6 : 5;
  const lenSegs = 5;
  const widSegs = 2;

  for (let p = 0; p < petalCount; p++) {
    const angle = (p / petalCount) * Math.PI * 2 + (variant === "star" ? 0.2 : 0);
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    const tanX = -dirZ;
    const tanZ = dirX;

    for (let i = 0; i <= lenSegs; i++) {
      const t = i / lenSegs;
      const widthScale =
        variant === "star"
          ? Math.sin(t * Math.PI) * 0.12 * (1.0 - t * 0.25)
          : Math.sin(Math.pow(t, 0.72) * Math.PI) * 0.17;
      const reach =
        variant === "star"
          ? 0.05 + Math.pow(t, 0.85) * 0.42
          : 0.04 + Math.sin(t * Math.PI * 0.62) * 0.34;
      const height =
        variant === "star"
          ? 0.37 + Math.sin(t * Math.PI * 0.55) * 0.24 - Math.pow(t, 2.5) * 0.06
          : 0.36 + t * 0.36;

      for (let w = 0; w <= widSegs; w++) {
        const wt = (w / widSegs) * 2 - 1; // -1 .. +1
        const cupDepth = (1 - Math.abs(wt)) * 0.035;

        const vx = dirX * reach + tanX * wt * widthScale;
        const vy = height - cupDepth;
        const vz = dirZ * reach + tanZ * wt * widthScale;

        positions.push(vx, vy, vz);

        const nx = dirX * 0.45 + tanX * wt * 0.25;
        const ny = 0.82;
        const nz = dirZ * 0.45 + tanZ * wt * 0.25;
        const nLen = Math.hypot(nx, ny, nz) || 1;
        normals.push(nx / nLen, ny / nLen, nz / nLen);

        petalWeights.push(0.25 + t * 0.75);
        radialDirs.push(dirX * t, dirZ * t);
      }
    }

    for (let i = 0; i < lenSegs; i++) {
      for (let w = 0; w < widSegs; w++) {
        const a = vertexOffset + i * (widSegs + 1) + w;
        const b = a + widSegs + 1;
        const c = a + 1;
        const d = b + 1;
        indices.push(a, b, c, c, b, d);
      }
    }

    vertexOffset += (lenSegs + 1) * (widSegs + 1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute(
    "aPetalWeight",
    new THREE.Float32BufferAttribute(petalWeights, 1)
  );
  geo.setAttribute(
    "aRadialDir",
    new THREE.Float32BufferAttribute(radialDirs, 2)
  );
  geo.setIndex(indices);
  return geo;
}

/**
 * Builds glowing center stamen cluster geometry positioned inside flower cup.
 */
function createStamenGeometry(THREE) {
  const base = new THREE.OctahedronGeometry(0.068, 1);
  base.translate(0, 0.5, 0);
  const count = base.attributes.position.count;
  const weights = new Float32Array(count).fill(0.55);
  const radials = new Float32Array(count * 2).fill(0);
  base.setAttribute("aPetalWeight", new THREE.BufferAttribute(weights, 1));
  base.setAttribute("aRadialDir", new THREE.BufferAttribute(radials, 2));
  return base;
}

/**
 * Builds slender arching nocturnal botanical leaf blade BufferGeometry.
 */
function createLeafGeometry(THREE) {
  const positions = [];
  const normals = [];
  const weights = [];
  const radials = [];
  const indices = [];

  const segs = 6;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const width = Math.sin(t * Math.PI) * 0.085 * (1 - t * 0.35) + 0.004;
    const y = t * 0.62;
    const z = Math.pow(t, 1.75) * 0.24;

    positions.push(-width, y, z, 0, y + 0.008, z - 0.006, width, y, z);
    normals.push(-0.2, 0.75, 0.6, 0, 0.85, 0.52, 0.2, 0.75, 0.6);
    weights.push(t, t, t);
    radials.push(0, t * 0.3, 0, t * 0.3, 0, t * 0.3);
  }

  for (let i = 0; i < segs; i++) {
    const row = i * 3;
    const next = (i + 1) * 3;
    indices.push(row, next, row + 1, row + 1, next, next + 1);
    indices.push(row + 1, next + 1, row + 2, row + 2, next + 1, next + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("aPetalWeight", new THREE.Float32BufferAttribute(weights, 1));
  geo.setAttribute("aRadialDir", new THREE.Float32BufferAttribute(radials, 2));
  geo.setIndex(indices);
  return geo;
}

const FLORA_VERTEX_SHADER = /* glsl */ `
  attribute vec4 aInstanceData; // xyz = base world pos, w = scale
  attribute vec4 aInstanceStyle; // x = rotY, y = phase, z = tint, w = isEmissiveCore
  attribute float aPetalWeight;
  attribute vec2 aRadialDir;

  uniform float uTime;
  uniform float uCameraZ;
  uniform float uHoverMix;
  uniform vec3 uCursorWorld;
  uniform float uCursorActive;
  uniform float uIsLeaf;

  varying float vPetalWeight;
  varying float vTint;
  varying float vCursorGlow;
  varying float vBloomFactor;
  varying float vViewDist;
  varying vec3 vNormalWorld;

  void main() {
    float centerZ = uCameraZ - 36.0;
    float relZ = mod((aInstanceData.z - centerZ) + 60.0, 120.0) - 60.0;
    float worldZ = centerZ + relZ;

    float distAhead = clamp(uCameraZ - worldZ, 0.0, 96.0);
    float bloomFactor = smoothstep(56.0, 11.0, distAhead);
    float farFade = smoothstep(92.0, 74.0, distAhead);

    float scale = aInstanceData.w * mix(0.46, 1.08, bloomFactor) * farFade;

    vec3 local = position;

    // Blossom opening as camera approaches
    if (uIsLeaf < 0.5) {
      float openAmount = mix(0.35, 1.25, bloomFactor) + uHoverMix * 0.18;
      local.xz += aRadialDir * openAmount * 0.14;
    }

    // Rotate instance around Y
    float ca = cos(aInstanceStyle.x);
    float sa = sin(aInstanceStyle.x);
    vec3 rotated = vec3(
      local.x * ca - local.z * sa,
      local.y,
      local.x * sa + local.z * ca
    );

    rotated *= scale;

    // Gentle organic wind sway anchored at stem base
    float wind = sin(uTime * 1.15 + aInstanceData.x * 0.28 + worldZ * 0.16 + aInstanceStyle.y);
    float gust = cos(uTime * 0.72 + aInstanceData.x * 0.14 - worldZ * 0.12 + aInstanceStyle.y * 1.7);
    float swayAmp = aPetalWeight * (0.08 + uHoverMix * 0.04) * scale;
    rotated.x += (wind * 0.75 + gust * 0.35) * swayAmp;
    rotated.z += (gust * 0.55 - wind * 0.25) * swayAmp;

    vec3 worldPos = vec3(aInstanceData.x, aInstanceData.y, worldZ) + rotated;

    // Cursor proximity glow and soft botanical parting
    vec2 toStem = worldPos.xz - uCursorWorld.xz;
    float dCursor = length(toStem);
    float cursorInf = uCursorActive * (1.0 - smoothstep(0.5, 8.5, dCursor));
    if (cursorInf > 0.001 && dCursor > 0.001) {
      vec2 pushDir = toStem / dCursor;
      worldPos.xz += pushDir * cursorInf * aPetalWeight * 0.55;
      worldPos.y -= cursorInf * aPetalWeight * 0.08;
    }

    vec3 rotNorm = vec3(
      normal.x * ca - normal.z * sa,
      normal.y,
      normal.x * sa + normal.z * ca
    );

    vec4 mvPos = viewMatrix * vec4(worldPos, 1.0);
    gl_Position = projectionMatrix * mvPos;

    vPetalWeight = aPetalWeight;
    vTint = aInstanceStyle.z;
    vCursorGlow = cursorInf;
    vBloomFactor = bloomFactor;
    vViewDist = -mvPos.z;
    vNormalWorld = normalize(rotNorm);
  }
`;

const FLORA_FRAGMENT_SHADER = /* glsl */ `
  uniform float uHoverMix;
  uniform float uIsLeaf;
  uniform float uIsStamen;
  uniform vec3 uFogColor;

  varying float vPetalWeight;
  varying float vTint;
  varying float vCursorGlow;
  varying float vBloomFactor;
  varying float vViewDist;
  varying vec3 vNormalWorld;

  void main() {
    vec3 lightDir = normalize(vec3(-0.3, 0.85, -0.45));
    float diff = max(dot(normalize(vNormalWorld), lightDir), 0.0) * 0.55 + 0.45;

    vec3 color;

    if (uIsStamen > 0.5) {
      // Glowing warm cream-gold blossom center (restrained so petals stay crisp)
      vec3 coreWarm = vec3(1.22, 1.08, 0.84);
      vec3 coreMoon = vec3(1.02, 1.12, 1.28);
      color = mix(coreWarm, coreMoon, step(0.72, vTint));
      color *= (0.68 + 0.34 * vBloomFactor + vCursorGlow * 0.55 + uHoverMix * 0.22);
    } else if (uIsLeaf > 0.5) {
      // Deep nocturnal botanical leaf with subtle luminous tips
      vec3 baseLeaf = vec3(0.03, 0.075, 0.065);
      vec3 tipLeaf = vec3(0.14, 0.32, 0.26);
      color = mix(baseLeaf, tipLeaf, smoothstep(0.25, 1.0, vPetalWeight)) * diff;
      color += vec3(0.18, 0.28, 0.22) * vCursorGlow * vPetalWeight;
    } else {
      // Luminous nocturnal flower petals
      vec3 stemColor = vec3(0.035, 0.06, 0.055);
      vec3 creamPetal = vec3(0.92, 0.88, 0.80);
      vec3 pearlBluePetal = vec3(0.74, 0.82, 0.98);
      vec3 blushCreamPetal = vec3(0.96, 0.83, 0.74);

      vec3 palette = mix(creamPetal, pearlBluePetal, smoothstep(0.35, 0.75, vTint));
      palette = mix(palette, blushCreamPetal, smoothstep(0.75, 1.0, vTint));

      float petalMask = smoothstep(0.2, 0.95, vPetalWeight);
      vec3 rimGlow = palette * (0.46 + 0.50 * vBloomFactor + uHoverMix * 0.18 + vCursorGlow * 0.62);
      color = mix(stemColor * diff, rimGlow * (0.72 + 0.28 * diff), petalMask);
    }

    float fogAmount = 1.0 - exp(-pow(max(vViewDist, 0.0) * 0.0175, 2.0));
    color = mix(color, uFogColor, clamp(fogAmount, 0.0, 1.0));

    gl_FragColor = vec4(color, 1.0);
  }
`;

const FIREFLY_VERTEX_SHADER = /* glsl */ `
  attribute vec4 aParticleData; // xyz = base pos, w = size
  attribute vec2 aParticleMeta; // x = phase, y = speed

  uniform float uTime;
  uniform float uCameraZ;
  uniform float uHoverMix;
  uniform vec3 uCursorWorld;
  uniform float uCursorActive;
  uniform float uPixelRatio;

  varying float vTwinkle;
  varying float vCursorGlow;
  varying float vViewDist;

  void main() {
    float centerZ = uCameraZ - 34.0;
    float relZ = mod((aParticleData.z - centerZ) + 60.0, 120.0) - 60.0;
    float worldZ = centerZ + relZ;

    float phase = aParticleMeta.x;
    float spd = aParticleMeta.y;

    vec3 pos = vec3(aParticleData.x, aParticleData.y, worldZ);
    pos.x += sin(uTime * 0.55 * spd + phase) * 1.15;
    pos.y += cos(uTime * 0.72 * spd + phase * 1.4) * 0.65 + uHoverMix * 1.45;
    pos.z += sin(uTime * 0.42 * spd + phase * 0.8) * 0.85;

    // Hover CTA dispersion: gently part center corridor outward
    float radialSign = pos.x >= 0.0 ? 1.0 : -1.0;
    float centerMask = 1.0 - smoothstep(0.0, 14.0, abs(pos.x));
    pos.x += radialSign * centerMask * uHoverMix * 5.2;

    // Cursor-based particle repulsion
    vec2 toCursor = pos.xz - uCursorWorld.xz;
    float dCursor = length(toCursor);
    float cursorInf = uCursorActive * (1.0 - smoothstep(0.4, 9.0, dCursor));
    if (cursorInf > 0.001 && dCursor > 0.001) {
      vec2 repel = toCursor / dCursor;
      pos.xz += repel * cursorInf * 2.8;
      pos.y += cursorInf * 1.1;
    }

    vec4 mvPos = viewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPos;

    float dist = max(-mvPos.z, 1.0);
    gl_PointSize = clamp((aParticleData.w * (1.0 + cursorInf * 0.65 + uHoverMix * 0.2) * uPixelRatio * 135.0) / dist, 1.5, 42.0);

    vTwinkle = 0.45 + 0.55 * sin(uTime * 1.8 * spd + phase * 3.1);
    vCursorGlow = cursorInf;
    vViewDist = dist;
  }
`;

const FIREFLY_FRAGMENT_SHADER = /* glsl */ `
  varying float vTwinkle;
  varying float vCursorGlow;
  varying float vViewDist;

  void main() {
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;

    float core = smoothstep(0.5, 0.0, dist);
    float glow = pow(core, 2.1);

    float fogFade = 1.0 - smoothstep(48.0, 92.0, vViewDist);
    vec3 warmFirefly = vec3(1.45, 1.32, 0.98);
    vec3 coolMist = vec3(0.85, 0.98, 1.25);
    vec3 color = mix(warmFirefly, coolMist, step(0.75, vTwinkle) * 0.35);
    color *= (0.75 + vCursorGlow * 1.1);

    float alpha = glow * (0.38 + 0.62 * vTwinkle) * fogFade;
    gl_FragColor = vec4(color, alpha);
  }
`;

const VIGNETTE_FILM_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uHoverMix: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uHoverMix;
    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 centered = vUv - 0.5;
      float radial = length(centered);

      // Subtle optical RGB micro-dispersion near edges
      float shift = pow(radial, 2.2) * (0.0022 + uHoverMix * 0.0012);
      vec2 dir = radial > 0.0001 ? centered / radial : vec2(0.0);
      float r = texture2D(tDiffuse, vUv + dir * shift).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - dir * shift).b;
      vec3 col = vec3(r, g, b);

      // Cinematic vignette
      float vig = smoothstep(0.92, 0.24, radial);
      col *= mix(0.45, 1.0, vig);

      // Ultra-restrained film grain to eliminate dark gradient banding
      float grain = (hash12(vUv * 900.0 + fract(uTime) * 37.0) - 0.5) * 0.018;
      col += grain;

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

const FernhollowCanvas = forwardRef(function FernhollowCanvas(
  { onReady, onFallback },
  ref
) {
  const containerRef = useRef(null);
  const hoverTargetRef = useRef(0);
  const [contextLost, setContextLost] = useState(false);

  useImperativeHandle(
    ref,
    () => ({
      startHoverTransition() {
        hoverTargetRef.current = 1;
      },
      stopHoverTransition() {
        hoverTargetRef.current = 0;
      },
    }),
    []
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof window === "undefined") return;

    let disposed = false;
    let rafId = null;
    let renderer = null;
    let composer = null;
    let cleanupListeners = null;
    const disposables = [];

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    async function initScene() {
      try {
        const [
          THREE,
          { EffectComposer },
          { RenderPass },
          { UnrealBloomPass },
          { ShaderPass },
          { OutputPass },
        ] = await Promise.all([
          import("three"),
          import("three/examples/jsm/postprocessing/EffectComposer.js"),
          import("three/examples/jsm/postprocessing/RenderPass.js"),
          import("three/examples/jsm/postprocessing/UnrealBloomPass.js"),
          import("three/examples/jsm/postprocessing/ShaderPass.js"),
          import("three/examples/jsm/postprocessing/OutputPass.js"),
        ]);

        if (disposed || !containerRef.current) return;

        const width = container.clientWidth || window.innerWidth;
        const height = container.clientHeight || window.innerHeight;
        const isMobile = width < 768;
        const pixelRatio = Math.min(window.devicePixelRatio || 1, isMobile ? 1.25 : 2);

        // Verify WebGL availability
        const testCanvas = document.createElement("canvas");
        const glTest =
          testCanvas.getContext("webgl2") ||
          testCanvas.getContext("webgl") ||
          testCanvas.getContext("experimental-webgl");
        if (!glTest) {
          onFallback?.("WebGL unavailable");
          return;
        }

        renderer = new THREE.WebGLRenderer({
          antialias: !isMobile,
          powerPreference: "high-performance",
          alpha: false,
        });
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(width, height);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        renderer.domElement.style.display = "block";
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        renderer.domElement.setAttribute("aria-hidden", "true");

        container.innerHTML = "";
        container.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const fogColor = new THREE.Color(0x03050c);
        scene.background = fogColor;
        scene.fog = new THREE.FogExp2(0x03050c, 0.0155);

        const camera = new THREE.PerspectiveCamera(52, width / height, 0.2, 160);
        camera.position.set(0, 2.35, 0);

        // Atmospheric moonlit sky backdrop dome
        const skyGeo = new THREE.SphereGeometry(135, 24, 16);
        const skyMat = new THREE.ShaderMaterial({
          side: THREE.BackSide,
          depthWrite: false,
          uniforms: {
            uHorizonColor: { value: new THREE.Color(0x091124) },
            uZenithColor: { value: new THREE.Color(0x000000) },
          },
          vertexShader: /* glsl */ `
            varying vec3 vLocal;
            void main() {
              vLocal = normalize(position);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: /* glsl */ `
            uniform vec3 uHorizonColor;
            uniform vec3 uZenithColor;
            varying vec3 vLocal;
            void main() {
              float h = smoothstep(-0.08, 0.42, vLocal.y);
              vec3 col = mix(uHorizonColor, uZenithColor, h);
              gl_FragColor = vec4(col, 1.0);
            }
          `,
        });
        const skyDome = new THREE.Mesh(skyGeo, skyMat);
        scene.add(skyDome);
        disposables.push(skyGeo, skyMat);

        // Subtle moonlight & valley rim lighting for terrain & distant hills
        const hemiLight = new THREE.HemisphereLight(0x28385c, 0x05070c, 0.85);
        scene.add(hemiLight);

        const moonLight = new THREE.DirectionalLight(0x9fb5e8, 0.9);
        moonLight.position.set(-18, 28, -45);
        scene.add(moonLight);

        // Cursor glow point light on terrain
        const cursorLight = new THREE.PointLight(0xf5efe2, 0, 14, 1.8);
        cursorLight.position.set(0, 1.5, -18);
        scene.add(cursorLight);

        // Procedurally generated seamless looping valley terrain (3 tiled segments of 120u)
        const terrainGeo = new THREE.PlaneGeometry(165, LOOP_LENGTH, 110, 80);
        terrainGeo.rotateX(-Math.PI / 2);
        const tPos = terrainGeo.attributes.position;
        for (let i = 0; i < tPos.count; i++) {
          const vx = tPos.getX(i);
          const vz = tPos.getZ(i);
          tPos.setY(i, getTerrainHeight(vx, vz));
        }
        terrainGeo.computeVertexNormals();

        const terrainMat = new THREE.MeshStandardMaterial({
          color: 0x060912,
          roughness: 0.92,
          metalness: 0.08,
        });
        disposables.push(terrainGeo, terrainMat);

        const terrainTiles = [-1, 0, 1].map((idx) => {
          const tile = new THREE.Mesh(terrainGeo, terrainMat);
          tile.position.z = idx * LOOP_LENGTH;
          scene.add(tile);
          return tile;
        });

        // Distant flanking mountain ridges (layered parallax silhouettes)
        const ridgeGeo = new THREE.PlaneGeometry(240, 46, 80, 12);
        const rPos = ridgeGeo.attributes.position;
        for (let i = 0; i < rPos.count; i++) {
          const rx = rPos.getX(i);
          const ry = rPos.getY(i);
          const topWeight = (ry + 23) / 46;
          const crest =
            (Math.sin(rx * 0.045) * 7.5 +
              Math.cos(rx * 0.11 + 1.2) * 3.8 +
              Math.sin(rx * 0.23) * 1.5) *
            topWeight;
          rPos.setY(i, ry + crest);
        }
        ridgeGeo.computeVertexNormals();
        const ridgeMat = new THREE.MeshStandardMaterial({
          color: 0x050814,
          roughness: 0.96,
          metalness: 0.05,
        });
        const farRidge = new THREE.Mesh(ridgeGeo, ridgeMat);
        farRidge.position.set(0, 6, -108);
        scene.add(farRidge);

        const midRidgeMat = new THREE.MeshStandardMaterial({
          color: 0x080d1d,
          roughness: 0.94,
          metalness: 0.06,
        });
        const midRidge = new THREE.Mesh(ridgeGeo, midRidgeMat);
        midRidge.position.set(18, 2.5, -86);
        midRidge.scale.set(0.9, 0.72, 1);
        scene.add(midRidge);
        disposables.push(ridgeGeo, ridgeMat, midRidgeMat);

        // Shared uniforms for GPU-wrapped instanced flora
        const sharedUniforms = {
          uTime: { value: 0 },
          uCameraZ: { value: 0 },
          uHoverMix: { value: 0 },
          uCursorWorld: { value: new THREE.Vector3(0, 0, -20) },
          uCursorActive: { value: 0 },
          uFogColor: { value: fogColor },
        };

        const bellCount = isMobile ? 520 : 1450;
        const starCount = isMobile ? 420 : 1150;
        const leafCount = isMobile ? 650 : 1850;
        const fireflyCount = isMobile ? 340 : 900;

        function populateFloraAttributes(count, seedOffset, isLeaf = false) {
          const instanceData = new Float32Array(count * 4);
          const instanceStyle = new Float32Array(count * 4);

          for (let i = 0; i < count; i++) {
            const s = i + seedOffset;
            const randX = seededRandom(s * 1.13);
            const randZ = seededRandom(s * 2.37);
            const randScale = seededRandom(s * 3.71);
            const randRot = seededRandom(s * 4.93);
            const randPhase = seededRandom(s * 5.47);
            const randTint = seededRandom(s * 6.83);

            // Concentrate flowers organically along the valley banks while leaving a clear central glide path
            const side = randX < 0.5 ? -1 : 1;
            const spread = Math.pow(seededRandom(s * 7.19), 0.72);
            const x = side * (1.2 + spread * 34.0);
            const z = (randZ - 0.5) * LOOP_LENGTH;
            const y = getTerrainHeight(x, z);

            const scale = isLeaf
              ? 0.75 + randScale * 1.15
              : 0.78 + randScale * 0.92;

            instanceData[i * 4] = x;
            instanceData[i * 4 + 1] = y;
            instanceData[i * 4 + 2] = z;
            instanceData[i * 4 + 3] = scale;

            instanceStyle[i * 4] = randRot * Math.PI * 2;
            instanceStyle[i * 4 + 1] = randPhase * Math.PI * 2;
            instanceStyle[i * 4 + 2] = randTint;
            instanceStyle[i * 4 + 3] = 0;
          }

          return { instanceData, instanceStyle };
        }

        function createInstancedFloraMesh(
          baseGeo,
          count,
          instanceData,
          instanceStyle,
          { isLeaf = false, isStamen = false }
        ) {
          const instGeo = new THREE.InstancedBufferGeometry();
          instGeo.index = baseGeo.index;
          instGeo.attributes.position = baseGeo.attributes.position;
          instGeo.attributes.normal = baseGeo.attributes.normal;
          instGeo.attributes.aPetalWeight = baseGeo.attributes.aPetalWeight;
          instGeo.attributes.aRadialDir = baseGeo.attributes.aRadialDir;
          instGeo.instanceCount = count;

          instGeo.setAttribute(
            "aInstanceData",
            new THREE.InstancedBufferAttribute(instanceData, 4)
          );
          instGeo.setAttribute(
            "aInstanceStyle",
            new THREE.InstancedBufferAttribute(instanceStyle, 4)
          );

          const mat = new THREE.ShaderMaterial({
            uniforms: {
              ...sharedUniforms,
              uIsLeaf: { value: isLeaf ? 1.0 : 0.0 },
              uIsStamen: { value: isStamen ? 1.0 : 0.0 },
            },
            vertexShader: FLORA_VERTEX_SHADER,
            fragmentShader: FLORA_FRAGMENT_SHADER,
            side: THREE.DoubleSide,
          });

          const mesh = new THREE.Mesh(instGeo, mat);
          mesh.frustumCulled = false;
          scene.add(mesh);
          disposables.push(baseGeo, instGeo, mat);
          return mesh;
        }

        const bellAttrs = populateFloraAttributes(bellCount, 100, false);
        const starAttrs = populateFloraAttributes(starCount, 5000, false);
        const leafAttrs = populateFloraAttributes(leafCount, 11000, true);

        const bellGeo = createFlowerGeometry(THREE, "bell");
        const starGeo = createFlowerGeometry(THREE, "star");
        const stamenGeoA = createStamenGeometry(THREE);
        const stamenGeoB = createStamenGeometry(THREE);
        const leafGeo = createLeafGeometry(THREE);

        createInstancedFloraMesh(
          bellGeo,
          bellCount,
          bellAttrs.instanceData,
          bellAttrs.instanceStyle,
          { isLeaf: false, isStamen: false }
        );
        createInstancedFloraMesh(
          stamenGeoA,
          bellCount,
          bellAttrs.instanceData,
          bellAttrs.instanceStyle,
          { isLeaf: false, isStamen: true }
        );
        createInstancedFloraMesh(
          starGeo,
          starCount,
          starAttrs.instanceData,
          starAttrs.instanceStyle,
          { isLeaf: false, isStamen: false }
        );
        createInstancedFloraMesh(
          stamenGeoB,
          starCount,
          starAttrs.instanceData,
          starAttrs.instanceStyle,
          { isLeaf: false, isStamen: true }
        );
        createInstancedFloraMesh(
          leafGeo,
          leafCount,
          leafAttrs.instanceData,
          leafAttrs.instanceStyle,
          { isLeaf: true, isStamen: false }
        );

        // Floating fireflies & luminous pollen spores
        const fireflyGeo = new THREE.BufferGeometry();
        const fPositions = new Float32Array(fireflyCount * 3);
        const fData = new Float32Array(fireflyCount * 4);
        const fMeta = new Float32Array(fireflyCount * 2);

        for (let i = 0; i < fireflyCount; i++) {
          const x = (seededRandom(i * 8.13 + 7) - 0.5) * 64;
          const z = (seededRandom(i * 9.41 + 19) - 0.5) * LOOP_LENGTH;
          const groundY = getTerrainHeight(x, z);
          const y = groundY + 0.5 + seededRandom(i * 4.17 + 31) * 7.5;

          fPositions[i * 3] = x;
          fPositions[i * 3 + 1] = y;
          fPositions[i * 3 + 2] = z;

          fData[i * 4] = x;
          fData[i * 4 + 1] = y;
          fData[i * 4 + 2] = z;
          fData[i * 4 + 3] = 0.65 + seededRandom(i * 2.71 + 43) * 1.6;

          fMeta[i * 2] = seededRandom(i * 5.29 + 61) * Math.PI * 2;
          fMeta[i * 2 + 1] = 0.55 + seededRandom(i * 3.83 + 79) * 0.9;
        }

        fireflyGeo.setAttribute(
          "position",
          new THREE.BufferAttribute(fPositions, 3)
        );
        fireflyGeo.setAttribute(
          "aParticleData",
          new THREE.BufferAttribute(fData, 4)
        );
        fireflyGeo.setAttribute(
          "aParticleMeta",
          new THREE.BufferAttribute(fMeta, 2)
        );

        const fireflyMat = new THREE.ShaderMaterial({
          uniforms: {
            uTime: sharedUniforms.uTime,
            uCameraZ: sharedUniforms.uCameraZ,
            uHoverMix: sharedUniforms.uHoverMix,
            uCursorWorld: sharedUniforms.uCursorWorld,
            uCursorActive: sharedUniforms.uCursorActive,
            uPixelRatio: { value: pixelRatio },
          },
          vertexShader: FIREFLY_VERTEX_SHADER,
          fragmentShader: FIREFLY_FRAGMENT_SHADER,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });

        const fireflies = new THREE.Points(fireflyGeo, fireflyMat);
        fireflies.frustumCulled = false;
        scene.add(fireflies);
        disposables.push(fireflyGeo, fireflyMat);

        // Postprocessing pipeline: Render -> UnrealBloom -> Vignette/RGB Film -> Output
        composer = new EffectComposer(renderer);
        const renderPass = new RenderPass(scene, camera);
        composer.addPass(renderPass);

        const bloomPass = new UnrealBloomPass(
          new THREE.Vector2(width, height),
          0.42,
          0.56,
          0.66
        );
        composer.addPass(bloomPass);

        const vignettePass = new ShaderPass(VIGNETTE_FILM_SHADER);
        composer.addPass(vignettePass);

        const outputPass = new OutputPass();
        composer.addPass(outputPass);

        // Camera & Interaction state
        let autoTravel = 0;
        let scrollOffset = window.scrollY * 0.042;
        let smoothCamZ = 0;
        let hoverMix = 0;

        const pointerNDC = new THREE.Vector2(0, 0);
        const smoothPointer = new THREE.Vector2(0, 0);
        let pointerActive = 0;
        const raycaster = new THREE.Raycaster();
        const cursorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.8);
        const rayHit = new THREE.Vector3(0, 0, -20);

        function handlePointerMove(e) {
          const rect = renderer.domElement.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
          pointerActive = 1;
        }

        function handlePointerLeave() {
          pointerActive = 0;
        }

        function handleTouchMove(e) {
          if (!e.touches?.[0]) return;
          const rect = renderer.domElement.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          pointerNDC.x = ((e.touches[0].clientX - rect.left) / rect.width) * 2 - 1;
          pointerNDC.y = -((e.touches[0].clientY - rect.top) / rect.height) * 2 + 1;
          pointerActive = 1;
        }

        function handleScroll() {
          scrollOffset = window.scrollY * 0.042;
        }

        function handleResize() {
          if (!containerRef.current || !renderer || !composer) return;
          const nextW = containerRef.current.clientWidth || window.innerWidth;
          const nextH = containerRef.current.clientHeight || window.innerHeight;
          const nextMobile = nextW < 768;
          const nextPR = Math.min(
            window.devicePixelRatio || 1,
            nextMobile ? 1.25 : 2
          );

          camera.aspect = nextW / nextH;
          camera.updateProjectionMatrix();
          renderer.setPixelRatio(nextPR);
          renderer.setSize(nextW, nextH);
          composer.setSize(nextW, nextH);
          bloomPass.setSize(nextW, nextH);
          fireflyMat.uniforms.uPixelRatio.value = nextPR;

          if (prefersReducedMotion) {
            composer.render();
          }
        }

        function handleContextLost(e) {
          e.preventDefault();
          if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
          setContextLost(true);
          onFallback?.("WebGL context lost");
        }

        function handleContextRestored() {
          setContextLost(false);
          if (!prefersReducedMotion && !disposed) {
            lastTime = performance.now();
            rafId = requestAnimationFrame(animate);
          }
        }

        window.addEventListener("pointermove", handlePointerMove, { passive: true });
        window.addEventListener("pointerleave", handlePointerLeave, { passive: true });
        window.addEventListener("touchmove", handleTouchMove, { passive: true });
        window.addEventListener("scroll", handleScroll, { passive: true });
        window.addEventListener("resize", handleResize);
        renderer.domElement.addEventListener("webglcontextlost", handleContextLost);
        renderer.domElement.addEventListener(
          "webglcontextrestored",
          handleContextRestored
        );

        cleanupListeners = () => {
          window.removeEventListener("pointermove", handlePointerMove);
          window.removeEventListener("pointerleave", handlePointerLeave);
          window.removeEventListener("touchmove", handleTouchMove);
          window.removeEventListener("scroll", handleScroll);
          window.removeEventListener("resize", handleResize);
          if (renderer?.domElement) {
            renderer.domElement.removeEventListener(
              "webglcontextlost",
              handleContextLost
            );
            renderer.domElement.removeEventListener(
              "webglcontextrestored",
              handleContextRestored
            );
          }
        };

        let lastTime = performance.now();
        let elapsed = 0;

        function updateSceneFrame(dt) {
          const hoverTarget = hoverTargetRef.current;
          hoverMix += (hoverTarget - hoverMix) * (1 - Math.exp(-3.6 * dt));

          // Slow forward drift gracefully during CTA hover
          const driftSpeed = 1.65 * (1 - hoverMix * 0.78);
          autoTravel += dt * driftSpeed;

          const targetCamZ = -(autoTravel + scrollOffset);
          smoothCamZ += (targetCamZ - smoothCamZ) * (1 - Math.exp(-4.2 * dt));

          // Smooth pointer orientation damping
          smoothPointer.x +=
            (pointerNDC.x - smoothPointer.x) * (1 - Math.exp(-4.5 * dt));
          smoothPointer.y +=
            (pointerNDC.y - smoothPointer.y) * (1 - Math.exp(-4.5 * dt));

          const camX =
            getValleyCenterX(smoothCamZ) + smoothPointer.x * 1.15;
          const groundHere = getTerrainHeight(camX, smoothCamZ);
          const camY = Math.max(groundHere + 2.35, 1.35) + smoothPointer.y * 0.45;

          camera.position.set(camX, camY, smoothCamZ);

          const lookZ = smoothCamZ - 16.0;
          const lookX =
            getValleyCenterX(lookZ) + smoothPointer.x * 2.1;
          const lookY =
            getTerrainHeight(lookX, lookZ) + 1.45 + smoothPointer.y * 1.25;
          camera.lookAt(lookX, lookY, lookZ);

          // Leapfrog seamless terrain tiles and horizon silhouettes
          const snappedZ = Math.round(smoothCamZ / LOOP_LENGTH) * LOOP_LENGTH;
          terrainTiles[0].position.z = snappedZ - LOOP_LENGTH;
          terrainTiles[1].position.z = snappedZ;
          terrainTiles[2].position.z = snappedZ + LOOP_LENGTH;

          skyDome.position.copy(camera.position);
          farRidge.position.z = smoothCamZ - 108;
          midRidge.position.z = smoothCamZ - 86;

          // Project pointer ray to valley floor for cursor glow & particle repulsion
          sharedUniforms.uCursorActive.value +=
            (pointerActive - sharedUniforms.uCursorActive.value) *
            (1 - Math.exp(-5.0 * dt));

          raycaster.setFromCamera(smoothPointer, camera);
          if (raycaster.ray.intersectPlane(cursorPlane, rayHit)) {
            const clampedZ = Math.max(
              smoothCamZ - 48,
              Math.min(smoothCamZ - 3, rayHit.z)
            );
            const clampedX = Math.max(-28, Math.min(28, rayHit.x));
            sharedUniforms.uCursorWorld.value.set(
              clampedX,
              getTerrainHeight(clampedX, clampedZ),
              clampedZ
            );
            cursorLight.position.set(
              clampedX,
              sharedUniforms.uCursorWorld.value.y + 2.1,
              clampedZ
            );
          }

          cursorLight.intensity =
            sharedUniforms.uCursorActive.value * (1.45 + hoverMix * 0.75);
          bloomPass.strength = 0.42 + hoverMix * 0.12;

          sharedUniforms.uTime.value = elapsed;
          sharedUniforms.uCameraZ.value = smoothCamZ;
          sharedUniforms.uHoverMix.value = hoverMix;
          vignettePass.uniforms.uTime.value = elapsed;
          vignettePass.uniforms.uHoverMix.value = hoverMix;
        }

        if (prefersReducedMotion) {
          elapsed = 2.4;
          updateSceneFrame(0.016);
          composer.render();
          onReady?.();
          return;
        }

        // Render initial frame immediately and notify hero UI
        updateSceneFrame(0.016);
        composer.render();
        onReady?.();

        function animate(now) {
          if (disposed) return;
          const dt = Math.min((now - lastTime) / 1000, 0.05);
          lastTime = now;
          elapsed += dt;

          updateSceneFrame(dt);
          composer.render();
          rafId = requestAnimationFrame(animate);
        }

        rafId = requestAnimationFrame(animate);
      } catch (err) {
        if (!disposed) {
          onFallback?.(err?.message || "WebGL initialization failed");
        }
      }
    }

    initScene();

    return () => {
      disposed = true;
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      if (cleanupListeners) {
        cleanupListeners();
      }
      for (const item of disposables) {
        try {
          item.dispose?.();
        } catch {
          // Ignore disposal errors
        }
      }
      if (composer) {
        try {
          composer.dispose?.();
        } catch {
          // Ignore composer disposal errors
        }
      }
      if (renderer) {
        try {
          renderer.dispose();
          if (renderer.domElement?.parentNode) {
            renderer.domElement.parentNode.removeChild(renderer.domElement);
          }
        } catch {
          // Ignore renderer disposal errors
        }
      }
    };
  }, [onReady, onFallback]);

  if (contextLost) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    />
  );
});

export default FernhollowCanvas;


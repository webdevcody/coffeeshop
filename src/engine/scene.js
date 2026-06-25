// Sets up the Three.js renderer, scene, camera, lights, and the CSS2D overlay
// renderer used for floating name labels and chat bubbles.

import * as THREE from "three";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";

export function createEngine(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // Gentle exposure lift for a warm, golden-hour read. ACES rolls off the bright
  // sun-lit faces softly while keeping the gradient sky + warm key punchy; a hair
  // higher than neutral so shaded sides still hold detail without washing out.
  renderer.toneMappingExposure = 1.22;

  const scene = new THREE.Scene();

  // Shared golden-hour sun direction (points FROM the city TOWARD the sun in the
  // sky). The key light, the visible sun disc, and its glow all read off this so
  // the cast shadows, the highlight side of the buildings, and the bright spot in
  // the sky all agree — that consistency is what sells a real sun. Low on the
  // horizon (small +y) for long, raking golden-hour shadows.
  const SUN_DIR = new THREE.Vector3(-0.62, 0.42, -0.66).normalize();

  // --- Gradient sky -------------------------------------------------------
  // A big back-side sphere with a vertical blue->pale CanvasTexture gives the
  // city real atmospheric depth instead of the old flat fill colour. The dome
  // ignores fog/lighting (basic material) so it always reads as open sky.
  // HORIZON_COLOR matches the fog so the city dissolves seamlessly into the
  // haze where the dome meets the ground plane.
  const ZENITH_COLOR = "#3a7bd5"; // deep sky blue overhead
  const HORIZON_COLOR = "#cfe3f2"; // pale, hazy blue at the horizon
  scene.add(makeSkyDome(ZENITH_COLOR, HORIZON_COLOR));
  // A soft sun disc + halo billboarded onto the dome in the key-light direction.
  scene.add(makeSunDisc(SUN_DIR));

  // Fog pushed WAY out for the expanded city (districts run 60–250m from the cafe).
  // Matches the sky-dome horizon so distant buildings fade into the haze line.
  // Only a faint distance haze past 220 m so the city reads crisp up close. Far
  // edge tucked just inside the (shrunk) sky-dome radius so the haze hides the cut.
  scene.fog = new THREE.Fog(HORIZON_COLOR, 220, 480);

  // near=1.0 (not 0.1) buys ~10x depth-buffer precision everywhere, which is what
  // stops the near-coplanar ground layers (base/slab/road/markings, all within a
  // few cm of y=0) from z-fighting out across the city. The camera sits at y=6 and
  // the player never gets within 1 m of it, so a 1.0 near clips nothing visible.
  // far=600 comfortably covers the ~365 m city + towers and stays inside the dome;
  // pairing it with near=1.0 keeps depth precision finer than every ground Y-gap.
  const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    1.0,
    600 // covers the whole city + towers; sits just inside the 500 m sky dome
  );
  camera.position.set(0, 6, 12);

  // CSS2D overlay renderer (labels/bubbles live in DOM, positioned in 3D).
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  const el = labelRenderer.domElement;
  el.style.position = "fixed";
  el.style.top = "0";
  el.style.left = "0";
  el.style.pointerEvents = "none";
  el.style.zIndex = "5";
  document.body.appendChild(el);

  addLights(scene, SUN_DIR);

  function onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
  }
  window.addEventListener("resize", onResize);

  return { renderer, scene, camera, labelRenderer, onResize };
}

// Builds the gradient sky dome: a large sphere rendered from the inside with a
// vertical CanvasTexture gradient. Unlit + fog-immune so it stays a clean
// backdrop. Radius 500 sits inside the 600 far plane and well outside the
// ~365 m city; the fog far (480) hazes the city out just before the dome.
function makeSkyDome(zenith, horizon) {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0.0, zenith); // top of the dome
  grad.addColorStop(0.55, "#7fb0e6"); // mid-sky transition
  grad.addColorStop(1.0, horizon); // hazy horizon (matches fog)
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;

  const geo = new THREE.SphereGeometry(500, 32, 16);
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.BackSide, // view from inside the dome
    fog: false, // sky is the backdrop, never fogged
    depthWrite: false, // never occludes geometry
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.renderOrder = -1; // draw first, behind everything
  dome.frustumCulled = false;
  return dome;
}

// Visible sun: a bright warm core wrapped in a soft falloff halo, painted into a
// radial-gradient CanvasTexture so it's a single cheap billboarded plane (no
// per-frame work, drawn once). It sits just inside the sky dome along SUN_DIR so
// it lines up with the key light's highlights and shadow direction, then is
// scaled up so the glow bleeds into the sky like real atmospheric scatter.
function makeSunDisc(sunDir) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const cx = 64;
  const cy = 64;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 64);
  grad.addColorStop(0.0, "rgba(255,250,235,1.0)"); // hot near-white core
  grad.addColorStop(0.18, "rgba(255,238,196,0.95)"); // warm golden body
  grad.addColorStop(0.42, "rgba(255,214,150,0.45)"); // soft golden falloff
  grad.addColorStop(0.72, "rgba(255,200,140,0.12)"); // faint outer glow
  grad.addColorStop(1.0, "rgba(255,200,140,0.0)"); // fades to nothing
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const mat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    blending: THREE.AdditiveBlending, // glow adds onto the sky, never darkens it
    depthWrite: false,
    depthTest: false, // always behind geometry via renderOrder, never z-fights
    fog: false,
    opacity: 0.95,
  });
  const sun = new THREE.Sprite(mat);
  // Park it on the dome's inner shell (radius 500) so it reads as infinitely far.
  sun.position.copy(sunDir).multiplyScalar(470);
  sun.scale.set(95, 95, 1); // big soft glow; the bright core is only the centre
  sun.renderOrder = -1; // with the dome, behind all city geometry
  sun.frustumCulled = false;
  return sun;
}

function addLights(scene, sunDir) {
  // Richer hemisphere bounce: a slightly deeper sky-blue from above grades into a
  // warmer, golden ground bounce, so shaded faces aren't flat grey — they pick up
  // cool sky on top and warm bounce underneath, the way a real golden-hour street
  // does. Pulled back a touch from before so the directional sun can do the
  // modelling instead of ambient washing everything flat.
  const ambient = new THREE.HemisphereLight("#bcdcff", "#9c7a4e", 0.95);
  ambient.position.set(0, 50, 0);
  scene.add(ambient);

  // Main warm golden-hour key light. Direction comes from the shared SUN_DIR so
  // it agrees with the visible sun disc and the sky's bright spot. Warmer + a
  // hair brighter for a sunset glow; placed far out along SUN_DIR so its rays are
  // effectively parallel across the whole city, throwing long raking shadows.
  const sun = new THREE.DirectionalLight("#ffdca0", 3.0); // warm golden sunlight
  // The city of interest is centred ~90 m in front of the cafe; anchor the light
  // rig there and offset along SUN_DIR so the frustum is centred on the action.
  const CITY_CENTER = new THREE.Vector3(0, 0, 90);
  sun.position.copy(sunDir).multiplyScalar(160).add(CITY_CENTER);
  sun.castShadow = true;
  // 4k map over the large frustum keeps texel density high enough that the soft
  // PCF falloff stays clean instead of blocky across the city. Still one map, so
  // perf cost is a single extra shadow pass — fine for a static directional sun.
  sun.shadow.mapSize.set(4096, 4096);
  // Frustum sized to wrap the cafe approach + the populated near city. Wide
  // enough that nothing near the player pops out of shadow, tight enough that the
  // 4k texels stay dense so the cafe interior and street furniture read crisp.
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 360; // pushed back along the longer light throw
  sun.shadow.camera.left = -110;
  sun.shadow.camera.right = 110;
  sun.shadow.camera.top = 110;
  sun.shadow.camera.bottom = -110;
  // Softer shadow edges: a small blur radius on top of PCFSoft gives the gentle
  // golden-hour penumbra falloff without the cost of a real area light.
  sun.shadow.radius = 3.0;
  sun.shadow.blurSamples = 12;
  // Bias tuned for the wider/4k frustum: a touch of depth bias kills acne on the
  // near-coplanar ground layers, and a healthy normalBias hides peter-panning on
  // the long raking shadows without detaching contact shadows at building bases.
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.035;
  // Aim the light rig at the city so the shadow camera tracks the populated area
  // rather than the world origin behind the cafe.
  sun.target.position.copy(CITY_CENTER);
  scene.add(sun.target);
  scene.add(sun);

  // Cool sky rim/fill from the opposite, shaded side. It rakes across the faces
  // the warm sun can't reach with a faint sky-blue, so buildings keep readable
  // form (a lit edge + a cool shaded edge) instead of going to dead silhouette.
  // No shadows — it's pure fill, cheap, and balances the warm key's white point.
  const fill = new THREE.DirectionalLight("#a8c8f0", 0.55);
  fill.position.copy(sunDir).multiplyScalar(-120).add(CITY_CENTER);
  fill.position.y = 45; // lift it off the ground so it grazes upper storeys
  scene.add(fill);
  scene.add(fill.target); // target defaults to origin; fine for a broad fill
}

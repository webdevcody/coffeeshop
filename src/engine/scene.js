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
  // Nudged up for a punchier, sunnier look — the gradient sky + warm sun read
  // brighter and crisper at a slightly higher exposure.
  renderer.toneMappingExposure = 1.18;

  const scene = new THREE.Scene();

  // --- Gradient sky -------------------------------------------------------
  // A big back-side sphere with a vertical blue->pale CanvasTexture gives the
  // city real atmospheric depth instead of the old flat fill colour. The dome
  // ignores fog/lighting (basic material) so it always reads as open sky.
  // HORIZON_COLOR matches the fog so the city dissolves seamlessly into the
  // haze where the dome meets the ground plane.
  const ZENITH_COLOR = "#3a7bd5"; // deep sky blue overhead
  const HORIZON_COLOR = "#cfe3f2"; // pale, hazy blue at the horizon
  scene.add(makeSkyDome(ZENITH_COLOR, HORIZON_COLOR));

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

  addLights(scene);

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

function addLights(scene) {
  // Bright hemisphere bounce: warm sky-lit fill from above, warm ground bounce
  // below so shadowed faces stay luminous and the whole scene reads sunny.
  const ambient = new THREE.HemisphereLight("#cfe6ff", "#8a7355", 1.05);
  ambient.position.set(0, 50, 0);
  scene.add(ambient);

  // Main warm sun key light. Stronger + warmer than before, dropped to a lower,
  // raking angle so buildings throw long soft shadows across the streets and the
  // city gains real depth and modelling.
  const sun = new THREE.DirectionalLight("#ffe3b0", 2.7); // warm golden sunlight
  sun.position.set(-70, 55, -30); // low raking angle -> long shadows
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // Frustum widened to cover the cafe approach + near city without smearing the
  // map. Kept reasonably tight (±70 m) so the cafe interior keeps crisp shadows.
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 220;
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02; // suppress peter-panning on the wider frustum
  // Aim the sun at the city so the shadow camera tracks the populated area
  // rather than the world origin behind the cafe.
  sun.target.position.set(0, 0, 90);
  scene.add(sun.target);
  scene.add(sun);

  // Cool sky bounce from the opposite side to lift the shaded faces with a touch
  // of sky-blue, balancing the warm sun for a believable outdoor white-point.
  const fill = new THREE.DirectionalLight("#aaccf2", 0.5);
  fill.position.set(60, 30, 50);
  scene.add(fill);
}

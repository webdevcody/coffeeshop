// Sets up the Three.js renderer, scene, camera, lights, and the CSS2D overlay
// renderer used for floating name labels and chat bubbles.
//
// DAY/NIGHT CYCLE: a single time-of-day value t (0..1) auto-advances slowly
// (a full sunrise→day→sunset→night loop in ~7 real minutes). Everything that
// reads the sky — the directional sun's position/colour/intensity, the gradient
// sky-dome, the hemisphere ambient, and the fog colour — is driven from t every
// frame via updateDayNight(dt). At night the whole scene sinks to a moody, deep
// blue so the emissive street lamps, neon signs and lit windows pop. Materials
// and geometry are reused; per-frame work mutates pre-allocated scratch colours
// and never allocates. The fog DISTANCES (220/480) and camera near/far
// (1.0/600) are deliberately left untouched — they fix z-fighting.

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
  // The day/night driver nudges this down at night so the emissive lamps/neon
  // read against a genuinely dark scene rather than a grey one.
  renderer.toneMappingExposure = 1.22;

  const scene = new THREE.Scene();

  // Shared sun direction. This is now a LIVE vector: the day/night driver swings
  // it through an arc across the sky each frame (see updateDayNight). The key
  // light, the visible sun disc and the sky's bright spot all read off it, so the
  // cast shadows, the highlight side of the buildings and the bright spot in the
  // sky stay in agreement as the sun moves. Seeded at a golden-hour pose.
  const SUN_DIR = new THREE.Vector3(-0.62, 0.42, -0.66).normalize();

  // --- Gradient sky -------------------------------------------------------
  // A big back-side sphere with a vertical CanvasTexture gradient gives the city
  // real atmospheric depth. The gradient stops are re-painted each frame from the
  // time-of-day colours (day blue → sunset orange/pink → deep night blue), so the
  // dome is the single biggest tell of the hour. The dome ignores fog/lighting
  // (basic material) so it always reads as open sky.
  const sky = makeSkyDome();
  scene.add(sky.dome);
  // A soft sun/moon disc + halo billboarded onto the dome in the key-light
  // direction; its colour + opacity are driven by the day/night cycle too.
  const sunDisc = makeSunDisc(SUN_DIR);
  scene.add(sunDisc.sprite);

  // Fog colour starts at the daytime horizon; the day/night driver re-tints it to
  // match the sky horizon each frame. DISTANCES are fixed at 220/480 and MUST NOT
  // change — only the colour is animated.
  scene.fog = new THREE.Fog(0xcfe3f2, 220, 480);
  // Bind the scene background to the SAME Color object as the fog. The sky dome is a
  // finite 500 m sphere at the origin; out over the huge ocean / far islands the
  // camera can see PAST the dome's edge, where an unset background renders as the
  // black clear colour ("black box in the sky"). Pointing background at fog.color
  // means any such gap reads as seamless horizon haze instead of black — and since
  // it's the same Color reference the day/night driver already re-tints via
  // fog.color.copy(...), the background tracks the hour for free, no per-frame cost.
  scene.background = scene.fog.color;

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

  const lights = addLights(scene, SUN_DIR);

  // --- Day/night cycle ----------------------------------------------------
  // The whole atmosphere is a function of one scalar, time-of-day t in [0,1):
  //   t=0.00 → deep night      t=0.25 → dawn/sunrise
  //   t=0.50 → bright midday    t=0.75 → dusk/sunset
  // The sun's elevation follows sin(2π·(t−0.25)) so it's highest at midday and
  // dips fully below the horizon around t≈0..0.1 / 0.9..1. Seeded at golden hour
  // so the scene opens warm, then advances on its own.
  const dayNight = makeDayNight({ sky, sunDisc, lights, fog: scene.fog, renderer, sunDir: SUN_DIR });
  // Seed a pleasant late-afternoon golden hour, then apply once so the very first
  // rendered frame already matches (no one-frame flash of the default daytime).
  dayNight.setTimeOfDay(0.7);

  function onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
  }
  window.addEventListener("resize", onResize);

  return {
    renderer,
    scene,
    camera,
    labelRenderer,
    onResize,
    // --- additive day/night surface (existing keys above are untouched) ---
    // Advance the cycle by real seconds and re-drive the whole atmosphere.
    updateDayNight: (dt) => dayNight.update(dt),
    // Jump the cycle to an absolute time-of-day (0..1); wraps. Useful for tests.
    setTimeOfDay: (t) => dayNight.setTimeOfDay(t),
    // Read the current time-of-day (0..1).
    getTimeOfDay: () => dayNight.t,
  };
}

// Builds the gradient sky dome: a large sphere rendered from the inside with a
// vertical CanvasTexture gradient. Unlit + fog-immune so it stays a clean
// backdrop. Radius 500 sits inside the 600 far plane and well outside the
// ~365 m city; the fog far (480) hazes the city out just before the dome.
//
// The day/night driver repaints the three gradient stops each frame and flags
// the texture for re-upload (texture.needsUpdate). The canvas/ctx are reused, so
// repainting is just three fillStyle + fillRect calls — no allocation.
function makeSkyDome() {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");

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

  // Repaint the vertical gradient from CSS colour strings (zenith → mid → horizon)
  // and a star amount (0..1, faint speckle that fades in at night). Reuses the
  // canvas + 2d context; the only per-call cost is the gradient fill + the GPU
  // re-upload three.js triggers off needsUpdate.
  function paint(zenithCss, midCss, horizonCss, stars) {
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0.0, zenithCss); // top of the dome
    grad.addColorStop(0.55, midCss); // mid-sky transition
    grad.addColorStop(1.0, horizonCss); // hazy horizon (matches fog)
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Subtle stars near the top of the dome at night: a sparse deterministic
    // speckle so it doesn't shimmer frame-to-frame. Cheap — a handful of dots
    // over a 4×256 canvas, only when stars > 0.
    if (stars > 0.01) {
      ctx.fillStyle = `rgba(255,255,255,${(stars * 0.85).toFixed(3)})`;
      // Deterministic pseudo-random positions (no Math.random churn per frame).
      for (let i = 0; i < STAR_SEEDS.length; i++) {
        const s = STAR_SEEDS[i];
        // Only the upper ~60% of the dome (away from the bright horizon haze).
        ctx.fillRect(s.x, s.y, 1, 1);
      }
    }
    texture.needsUpdate = true;
  }

  return { dome, mat, texture, paint };
}

// A fixed sparse set of star positions on the 4×256 sky canvas, biased to the
// upper (zenith) half. Computed once at module load so the night sky is stable.
const STAR_SEEDS = (() => {
  const out = [];
  let seed = 1337;
  const rnd = () => {
    // tiny LCG → deterministic, allocation-free at use sites
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 26; i++) {
    out.push({ x: Math.floor(rnd() * 4), y: Math.floor(rnd() * 150) });
  }
  return out;
})();

// Visible sun/moon: a bright warm core wrapped in a soft falloff halo, painted
// into a radial-gradient CanvasTexture so it's a single cheap billboarded plane.
// It rides the live SUN_DIR (the day/night driver repositions it on the dome each
// frame) so it lines up with the key light's highlights and shadow direction. Its
// colour tint (warm sun → pale moon) and opacity are driven by the cycle so it
// fades out below the horizon and turns silvery at night.
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
    color: 0xffffff, // tinted by the day/night driver (warm sun ↔ pale moon)
  });
  const sprite = new THREE.Sprite(mat);
  // Park it on the dome's inner shell (radius 500) so it reads as infinitely far.
  sprite.position.copy(sunDir).multiplyScalar(470);
  sprite.scale.set(95, 95, 1); // big soft glow; the bright core is only the centre
  sprite.renderOrder = -1; // with the dome, behind all city geometry
  sprite.frustumCulled = false;
  return { sprite, mat };
}

function addLights(scene, sunDir) {
  // Richer hemisphere bounce: a slightly deeper sky-blue from above grades into a
  // warmer, golden ground bounce, so shaded faces aren't flat grey — they pick up
  // cool sky on top and warm bounce underneath, the way a real golden-hour street
  // does. The day/night driver re-tints both colours and the intensity each frame
  // (dim cool moonlight at night, bright neutral by day).
  const ambient = new THREE.HemisphereLight("#bcdcff", "#9c7a4e", 0.95);
  ambient.position.set(0, 50, 0);
  scene.add(ambient);

  // Main key light (the sun by day, the moon by night). Direction comes from the
  // shared live SUN_DIR so it always agrees with the visible disc and the sky's
  // bright spot; the day/night driver re-tints its colour (warm dawn → bright
  // midday → orange dusk → faint cool moonlight) and its intensity (near zero at
  // night). Placed far out along SUN_DIR so its rays are effectively parallel
  // across the whole city, throwing long raking shadows.
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
  // The day/night driver dims it down at night (the moon doesn't fill like the
  // bright daytime sky bounce does).
  const fill = new THREE.DirectionalLight("#a8c8f0", 0.55);
  fill.position.copy(sunDir).multiplyScalar(-120).add(CITY_CENTER);
  fill.position.y = 45; // lift it off the ground so it grazes upper storeys
  scene.add(fill);
  scene.add(fill.target); // target defaults to origin; fine for a broad fill

  // Soft "moon" fill — a single cool directional that only contributes at night.
  // It comes down from high overhead so it washes rooftops + open streets with a
  // gentle moonlit sheen rather than raking like the sun. The day/night driver
  // ramps its intensity in via nightK (0 by day → moonFillMax deep at night), so
  // it costs nothing during the day. No shadows (pure cheap fill), created ONCE
  // here so the per-frame driver only mutates colour/intensity (zero allocation).
  const moonFill = new THREE.DirectionalLight("#9fb4e8", 0.0);
  moonFill.position.set(CITY_CENTER.x + 40, 180, CITY_CENTER.z - 30); // high, cool overhead
  moonFill.target.position.copy(CITY_CENTER);
  scene.add(moonFill);
  scene.add(moonFill.target);

  return { ambient, sun, fill, moonFill, cityCenter: CITY_CENTER, fillBaseIntensity: 0.55 };
}

// =============================================================================
// Day/night driver
// =============================================================================
// Owns the time-of-day scalar and re-paints/-tints everything each frame from a
// small set of pre-allocated scratch Colors (no per-frame allocation). The look
// is built from a handful of keyframed "moods" we lerp between by t.
function makeDayNight({ sky, sunDisc, lights, fog, renderer, sunDir }) {
  // A full cycle in ~7 real minutes (420 s). t advances by dt/CYCLE_SECONDS.
  const CYCLE_SECONDS = 420;

  // --- Mood keyframes ----------------------------------------------------
  // Each phase defines the sky gradient (zenith/mid/horizon), the fog tint, the
  // hemisphere sky/ground colours + intensity, the sun colour + max intensity,
  // and the exposure. We index these by sun ELEVATION-derived phases rather than
  // raw t so the transitions land where the sun actually is. Colours are 0xRRGGBB.
  // NIGHT (sun well below horizon) — deep blue, moody, lamps/neon carry the scene.
  const NIGHT = {
    zenith: 0x0b1228,
    mid: 0x142048,
    horizon: 0x243a60, // lifted off near-black so there's a visible night horizon
    fog: 0x243a60, // fog matches the horizon (distances fixed at 220/480)
    // Lift the hemisphere sky/ground toward a moonlit blue-grey so shaded faces
    // read as cool moonlight instead of dead black. Sky is a brighter slate-blue
    // and the ground bounce is lifted off near-black to a dim cool grey.
    skyAmb: 0x7d92d0, // bright moonlit slate-blue sky bounce (lifted hard for visibility)
    groundAmb: 0x47527a, // lifted cool blue-grey ground bounce (no more near-black)
    // Night must be clearly SEEABLE — a bright moonlit city, not pitch black. This
    // floor was 0.62 and still read as "can't see anything", so it's lifted hard.
    ambInt: 1.55,
    sun: 0xbecbe8, // pale cool moonlight
    sunMax: 0.62, // stronger moonlight key so surfaces get shape, not just flat ambient
    fill: 0x5f7fc0, // cooler, brighter moonlit fill
    fillInt: 0.55, // raised night fill floor for overall visibility
    exposure: 1.15, // lift the whole night frame a touch (was 1.0)
    stars: 1.0,
    discColor: 0xcdd8f5, // silvery moon
    // Soft directional "moon" fill — a cool key that ramps IN as the sun sets
    // (driven by nightK) and OUT at dawn. Separate from the main sun/key so it can
    // wash the whole city with bright moonlight without touching the warm sun
    // colour. Max intensity reached deep at night — pushed high for visibility.
    moonFill: 0xacc0ef, // cool silvery-blue moonlight
    moonFillMax: 1.15,
  };
  // DAWN/DUSK (sun near the horizon) — warm orange/pink twilight band.
  const TWILIGHT = {
    zenith: 0x2a4a86,
    mid: 0x9a6f8e,
    horizon: 0xff9b5c, // orange/pink horizon glow
    fog: 0xe2a07a,
    skyAmb: 0x8fa6d6,
    groundAmb: 0x6e4a38,
    ambInt: 0.7,
    sun: 0xffb066, // warm low-sun orange
    sunMax: 2.1,
    fill: 0x8c7fb0,
    fillInt: 0.32,
    exposure: 1.18,
    stars: 0.18,
    discColor: 0xffd2a0, // warm golden disc
  };
  // DAY (sun high) — bright open blue, neutral key, strong fill.
  const DAY = {
    zenith: 0x3a7bd5,
    mid: 0x7fb0e6,
    horizon: 0xcfe3f2,
    fog: 0xcfe3f2,
    skyAmb: 0xbcdcff,
    groundAmb: 0x9c7a4e,
    ambInt: 0.95,
    sun: 0xfff1d8, // bright slightly-warm midday
    sunMax: 3.0,
    fill: 0xa8c8f0,
    fillInt: 0.55,
    exposure: 1.22,
    stars: 0.0,
    discColor: 0xfff4e0, // hot near-white sun
  };

  // --- Scratch state (allocated ONCE; mutated in place every frame) -------
  const cZen = new THREE.Color();
  const cMid = new THREE.Color();
  const cHor = new THREE.Color();
  const cFog = new THREE.Color();
  const cSkyAmb = new THREE.Color();
  const cGndAmb = new THREE.Color();
  const cSun = new THREE.Color();
  const cFill = new THREE.Color();
  const cMoon = new THREE.Color(); // moon-fill colour (set once below; constant)
  const cDisc = new THREE.Color();
  // The moon-fill colour never changes, so set it ONCE here and only animate the
  // intensity each frame (keeps the hot path allocation- and setHex-free).
  cMoon.setHex(NIGHT.moonFill);
  // Scratch for the lerp endpoints so we never `new` a Color while blending.
  const tmpA = new THREE.Color();
  const tmpB = new THREE.Color();
  // Reused for repainting the sky canvas (CSS hex strings) — built per frame but
  // as primitive strings via a fixed scratch (getHexString returns a fresh string
  // regardless; that's unavoidable, but it's three small strings, not objects).

  const state = {
    t: 0.7,
    // expose the scratch numerics for the closure helpers below
  };

  // Lerp helper that writes into `out` (no allocation). Mixes a→b by k in linear
  // space via three.js Color.lerpColors.
  function mix(out, aHex, bHex, k) {
    tmpA.setHex(aHex);
    tmpB.setHex(bHex);
    out.lerpColors(tmpA, tmpB, k);
  }
  function lerpN(a, b, k) {
    return a + (b - a) * k;
  }
  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }
  function smooth(k) {
    k = clamp01(k);
    return k * k * (3 - 2 * k); // smoothstep
  }

  // Drive the entire atmosphere from the current t.
  function apply() {
    const t = state.t;
    // Sun elevation: highest at midday (t=0.5), below horizon around the wrap.
    // angle goes 0→2π over the day; we offset so t=0.25 is sunrise (elev=0 rising)
    // and t=0.75 is sunset (elev=0 falling).
    const ang = (t - 0.25) * Math.PI * 2;
    const elev = Math.sin(ang); // -1 (deep night) .. +1 (high noon)
    // Azimuth sweeps the sun east→west across the sky as the day progresses so
    // the disc and shadows actually travel rather than just bobbing up and down.
    const azi = (t - 0.25) * Math.PI * 2;

    // --- Update the live sun direction (arc across the sky) ---------------
    // y = elevation; x/z trace a horizontal circle for the azimuth sweep. We let
    // the sun dip below y=0 at night (the disc fades out, the key light dims to
    // moonlight, so a sub-horizon sun is fine and keeps shadows raking long near
    // dawn/dusk). Clamp the minimum height a touch so the shadow rig stays sane.
    const horiz = Math.cos(ang); // radius of the horizontal sweep component
    sunDir.set(Math.cos(azi) * 0.78, Math.max(elev, -0.35), Math.sin(azi) * 0.78 * Math.sign(horiz) || 0.0001);
    // Keep a sensible minimum so normalize never blows up and the rig isn't flat.
    if (Math.abs(sunDir.y) < 0.04 && Math.abs(sunDir.x) < 0.04 && Math.abs(sunDir.z) < 0.04) {
      sunDir.z = -0.66;
    }
    sunDir.normalize();

    // --- Blend the mood by elevation --------------------------------------
    // dayK: 0 at/below horizon → 1 when the sun is well up. twiK: peaks right at
    // the horizon (the orange band), falling off as the sun climbs or sinks.
    const dayK = smooth((elev - 0.06) / 0.34); // ramps in just above the horizon
    const nightK = smooth((-elev - 0.04) / 0.22); // ramps in just below
    // Twilight weight: strongest when |elev| is small (sun near the horizon).
    const twiK = clamp01(1 - Math.min(1, Math.abs(elev) / 0.28));

    // Choose the two endpoints to blend between based on which side of the horizon
    // the sun is on, then fold in the twilight band. We build it as:
    //   base = mix(NIGHT, DAY, dayK)      (the broad day/night axis)
    //   final = mix(base, TWILIGHT, twiK) (warm band near the horizon)
    // Doing it per-channel with scratch colours keeps allocation at zero.
    applyMood(dayK, twiK, nightK, elev);

    // --- Sun/key elevation gates the shadow + disc visibility -------------
    // Position the visible disc on the dome along the live sun direction.
    sunDisc.sprite.position.copy(sunDir).multiplyScalar(470);
    // Fade the disc out as it sinks below the horizon (and slightly as it climbs
    // to noon so the glow doesn't blow out the bright daytime sky).
    const discVis = clamp01((elev + 0.12) / 0.25);
    sunDisc.mat.opacity = 0.18 + discVis * 0.77;
    sunDisc.mat.color.copy(cDisc);

    // Reposition the key + fill rigs along the new sun direction so shadows and
    // the bright/shaded faces track the moving sun.
    const cc = lights.cityCenter;
    lights.sun.position.copy(sunDir).multiplyScalar(160).add(cc);
    lights.fill.position.copy(sunDir).multiplyScalar(-120).add(cc);
    lights.fill.position.y = 45;
  }

  // Per-channel mood blend writing into the scratch colours, then push to the GPU
  // objects. dayK ∈[0,1] day axis, twiK ∈[0,1] twilight band, nightK ∈[0,1].
  function applyMood(dayK, twiK, nightK, elev) {
    // Sky gradient stops.
    blend3(cZen, NIGHT.zenith, DAY.zenith, dayK, TWILIGHT.zenith, twiK);
    blend3(cMid, NIGHT.mid, DAY.mid, dayK, TWILIGHT.mid, twiK);
    blend3(cHor, NIGHT.horizon, DAY.horizon, dayK, TWILIGHT.horizon, twiK);
    // Fog matches the horizon mood (distances stay fixed at 220/480).
    blend3(cFog, NIGHT.fog, DAY.fog, dayK, TWILIGHT.fog, twiK);
    // Hemisphere ambient sky + ground.
    blend3(cSkyAmb, NIGHT.skyAmb, DAY.skyAmb, dayK, TWILIGHT.skyAmb, twiK);
    blend3(cGndAmb, NIGHT.groundAmb, DAY.groundAmb, dayK, TWILIGHT.groundAmb, twiK);
    // Sun / fill / disc colours.
    blend3(cSun, NIGHT.sun, DAY.sun, dayK, TWILIGHT.sun, twiK);
    blend3(cFill, NIGHT.fill, DAY.fill, dayK, TWILIGHT.fill, twiK);
    blend3(cDisc, NIGHT.discColor, DAY.discColor, dayK, TWILIGHT.discColor, twiK);

    // Scalar moods (intensities + exposure + stars).
    const ambInt = blendN(NIGHT.ambInt, DAY.ambInt, dayK, TWILIGHT.ambInt, twiK);
    const fillInt = blendN(NIGHT.fillInt, DAY.fillInt, dayK, TWILIGHT.fillInt, twiK);
    const exposure = blendN(NIGHT.exposure, DAY.exposure, dayK, TWILIGHT.exposure, twiK);
    const stars = blendN(NIGHT.stars, DAY.stars, dayK, TWILIGHT.stars, twiK);
    // Sun intensity: fade with elevation so it's near-zero below the horizon and
    // the night moonlight floor takes over. We drive the max-intensity through the
    // same mood blend, then gate it by how high the sun is.
    const sunMax = blendN(NIGHT.sunMax, DAY.sunMax, dayK, TWILIGHT.sunMax, twiK);
    const sunGate = clamp01((elev + 0.18) / 0.4); // 0 well below horizon → 1 up
    // Keep a faint moonlight floor at night so the scene isn't pitch black.
    const moonFloor = NIGHT.sunMax * nightK;
    const sunInt = Math.max(sunMax * sunGate, moonFloor);

    // --- Push to GPU objects (reusing materials/lights) -------------------
    // Sky dome: repaint the gradient (canvas reused) with CSS hex strings.
    sky.paint("#" + cZen.getHexString(), "#" + cMid.getHexString(), "#" + cHor.getHexString(), stars);
    // Fog colour (distances untouched).
    fog.color.copy(cFog);
    // Hemisphere ambient.
    lights.ambient.color.copy(cSkyAmb);
    lights.ambient.groundColor.copy(cGndAmb);
    lights.ambient.intensity = ambInt;
    // Directional key (sun/moon).
    lights.sun.color.copy(cSun);
    lights.sun.intensity = sunInt;
    // Cool fill.
    lights.fill.color.copy(cFill);
    lights.fill.intensity = fillInt;
    // Soft "moon" fill: ramps in via nightK (the same below-horizon phase value
    // that the moonlight floor uses), so it grows as the sun sets and fades out
    // at dawn. Colour is the constant cool moonlight set once at init; only the
    // intensity is touched here (no allocation, no setHex on the hot path).
    if (lights.moonFill) {
      lights.moonFill.color.copy(cMoon);
      lights.moonFill.intensity = NIGHT.moonFillMax * nightK;
    }
    // Tone-mapping exposure dips at night so the dark scene reads dark and the
    // emissive lamps/neon/windows pop instead of being lifted to grey.
    renderer.toneMappingExposure = exposure;
  }

  // Blend NIGHT/DAY along the day axis, then fold in TWILIGHT, into a scratch Color.
  function blend3(out, nightHex, dayHex, dayK, twiHex, twiK) {
    mix(out, nightHex, dayHex, dayK); // out = night→day
    tmpB.setHex(twiHex);
    out.lerp(tmpB, twiK); // out = base→twilight
  }
  function blendN(nightV, dayV, dayK, twiV, twiK) {
    const base = lerpN(nightV, dayV, dayK);
    return lerpN(base, twiV, twiK);
  }

  return {
    get t() {
      return state.t;
    },
    setTimeOfDay(t) {
      // wrap into [0,1)
      t = t % 1;
      if (t < 0) t += 1;
      state.t = t;
      apply();
    },
    update(dt) {
      if (!(dt > 0)) {
        // dt may be 0/NaN on a paused/first frame — still keep the look current.
        apply();
        return;
      }
      state.t = (state.t + dt / CYCLE_SECONDS) % 1;
      apply();
    },
  };
}

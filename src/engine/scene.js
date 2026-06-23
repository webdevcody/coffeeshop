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
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#d9c3a5");
  scene.fog = new THREE.Fog("#d9c3a5", 28, 55);

  const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    200
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

function addLights(scene) {
  // Warm ambient fill so shadows aren't pitch black.
  const ambient = new THREE.HemisphereLight("#fff3e0", "#5a4632", 0.85);
  scene.add(ambient);

  // Main "sunlight through the windows" key light.
  const sun = new THREE.DirectionalLight("#ffe9c7", 1.5);
  sun.position.set(-12, 16, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 60;
  sun.shadow.camera.left = -20;
  sun.shadow.camera.right = 20;
  sun.shadow.camera.top = 20;
  sun.shadow.camera.bottom = -20;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  // Subtle cool bounce from the opposite side.
  const fill = new THREE.DirectionalLight("#bcd4e6", 0.35);
  fill.position.set(10, 8, -8);
  scene.add(fill);
}

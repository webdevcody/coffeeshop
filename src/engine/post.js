// Post-processing pipeline.
//
// Wraps the existing renderer in an EffectComposer so the already-tuned scene
// (tone mapping / sky / day-night in scene.js — DO NOT touch that) gets a final
// screen-space pass that makes the bright bits GLOW: neon signs, street lamps,
// headlights, lit windows and the sun/moon disc bloom softly without washing
// out the daytime city.
//
// Pipeline (one bloom pass, kept performant):
//   RenderPass        — draw the scene/camera into the composer's HDR-ish buffer
//   UnrealBloomPass   — subtle threshold bloom over the bright emissive bits
//   ShaderPass(FXAA)  — cheap post-AA so bloom-softened edges stay clean
//   OutputPass        — tone-mapping/color-space resolve to the screen
//
// IMPORTANT — tone mapping lives on the renderer (scene.js sets
// ACESFilmicToneMapping + per-frame toneMappingExposure via the day/night
// driver). OutputPass reads renderer.toneMapping / .toneMappingExposure at draw
// time, so the day-night exposure dips keep working end-to-end: RenderPass draws
// linear, bloom adds linear glow, OutputPass applies ACES + sRGB once at the end.
// (The composer's internal render targets are linear; we never set the
// renderer's toneMapping to None here, OutputPass simply consumes it.)

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";

// Bloom tuning — deliberately restrained so daylight stays crisp.
//   threshold: only pixels brighter than this bloom (0.85 → daytime surfaces
//              mostly excluded; emissive neon/lamps/sun and HDR highlights pass).
//   strength : glow intensity (0.6 reads clearly at night without smearing day).
//   radius   : bloom spread (0.5 → soft, tight halo rather than a foggy wash).
const BLOOM_THRESHOLD = 0.85;
const BLOOM_STRENGTH = 0.6;
const BLOOM_RADIUS = 0.5;

export function createPostFX(renderer, scene, camera) {
  // Honour the renderer's device-pixel-ratio cap (scene.js clamps it to <=2) so
  // the composer's buffers match the canvas resolution exactly.
  const pixelRatio = renderer.getPixelRatio();
  const size = renderer.getSize(new THREE.Vector2());

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(size.x, size.y);

  // 1) Draw the scene exactly as before.
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // 2) Subtle bloom over the bright/emissive bits.
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(size.x, size.y),
    BLOOM_STRENGTH,
    BLOOM_RADIUS,
    BLOOM_THRESHOLD
  );
  composer.addPass(bloomPass);

  // 3) Cheap post-AA. Bloom is applied to a non-AA'd composer buffer, so we add
  //    FXAA here to keep edges (and the bloom-softened ones) clean. resolution
  //    is in *device* pixels: 1 / (cssPixels * pixelRatio).
  const fxaaPass = new ShaderPass(FXAAShader);
  fxaaPass.material.uniforms.resolution.value.set(
    1 / (size.x * pixelRatio),
    1 / (size.y * pixelRatio)
  );
  composer.addPass(fxaaPass);

  // 4) Final tone-mapping + color-space resolve (reads renderer.toneMapping /
  //    .toneMappingExposure, which scene.js owns and animates per frame).
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  function setSize(w, h) {
    // Keep in step with the renderer's current pixel ratio (it can change if the
    // window moves between displays).
    const pr = renderer.getPixelRatio();
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    bloomPass.setSize(w, h);
    fxaaPass.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
  }

  function render() {
    composer.render();
  }

  function dispose() {
    composer.dispose?.();
    bloomPass.dispose?.();
    fxaaPass.dispose?.();
    outputPass.dispose?.();
    renderPass.dispose?.();
  }

  return { composer, render, setSize, dispose };
}

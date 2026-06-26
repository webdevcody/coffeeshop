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
//   ShaderPass(Grade) — final cheap cinematic color-grade + vignette (last!)
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
//   threshold: only pixels brighter than this bloom (0.9 → even more of the daytime
//              surfaces excluded; emissive neon/lamps/sun and HDR highlights pass).
//   strength : glow intensity (0.6 reads clearly at night without smearing day).
//   radius   : bloom spread (0.3 → tighter halo = fewer/cheaper blur taps than 0.5,
//              still soft, just less per-pixel work for the GPU-bound budget).
const BLOOM_THRESHOLD = 0.9;
const BLOOM_STRENGTH = 0.6;
const BLOOM_RADIUS = 0.3;

// Cinematic color-grade tuning — deliberately gentle. This runs LAST, on the
// already-tone-mapped + sRGB-resolved OutputPass result, so it only *grades*
// whatever pixels come out (day or night) and must NOT re-tonemap. Keep every
// constant subtle: the goal is "enhance", not "stylize".
//   GRADE_VIGNETTE_STRENGTH : how much corners darken (0 = off). 0.28 is barely
//                             noticeable but adds depth.
//   GRADE_VIGNETTE_SMOOTH   : start/end radii of the corner falloff (smoothstep).
//   GRADE_CONTRAST          : pivot-based contrast lift around mid-grey (1 = none).
//   GRADE_SATURATION        : saturation lift (1 = none). A small push for punch.
//   GRADE_SPLIT_STRENGTH    : how strongly the warm-shadows / teal-highlights
//                             split-tone tints the image (0 = off).
//   GRADE_WARM / GRADE_TEAL : the shadow (warm) and highlight (teal) tint colors.
const GRADE_VIGNETTE_STRENGTH = 0.28;
const GRADE_VIGNETTE_SMOOTH = new THREE.Vector2(0.72, 0.18); // (outer, inner)
const GRADE_CONTRAST = 1.06;
const GRADE_SATURATION = 1.14;
const GRADE_SPLIT_STRENGTH = 0.07;
const GRADE_WARM = new THREE.Color(1.0, 0.86, 0.72); // warm tint pushed into shadows
const GRADE_TEAL = new THREE.Color(0.78, 0.92, 1.0); // teal tint pushed into highlights

// Tiny single-pass cinematic grade. Operates on the LDR, already tone-mapped
// sRGB output (so it is purely cosmetic — no tone mapping, no color-space work).
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignetteStrength: { value: GRADE_VIGNETTE_STRENGTH },
    uVignetteSmooth: { value: GRADE_VIGNETTE_SMOOTH.clone() },
    uContrast: { value: GRADE_CONTRAST },
    uSaturation: { value: GRADE_SATURATION },
    uSplitStrength: { value: GRADE_SPLIT_STRENGTH },
    uWarm: { value: GRADE_WARM.clone() },
    uTeal: { value: GRADE_TEAL.clone() },
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
    uniform float uVignetteStrength;
    uniform vec2  uVignetteSmooth; // x = outer radius, y = inner radius
    uniform float uContrast;
    uniform float uSaturation;
    uniform float uSplitStrength;
    uniform vec3  uWarm;
    uniform vec3  uTeal;
    varying vec2 vUv;

    // Rec. 709 luma — used for saturation and split-tone weighting.
    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 color = texel.rgb;

      // 1) Contrast around mid-grey pivot (0.5). Cheap and stable for LDR.
      color = (color - 0.5) * uContrast + 0.5;

      // 2) Saturation lift — blend toward/away from luma.
      float luma = dot(color, LUMA);
      color = mix(vec3(luma), color, uSaturation);

      // 3) Faint warm-shadow / teal-highlight split-tone. Weight by luma so
      //    shadows get warmth and highlights get a cool teal cast, subtly.
      float t = clamp(dot(color, LUMA), 0.0, 1.0);
      vec3 splitTint = mix(uWarm, uTeal, t);
      // Center the tint around neutral grey so it tints rather than brightens.
      color += (splitTint - vec3(1.0)) * uSplitStrength;

      // 4) Gentle vignette — darken corners via distance from center.
      vec2 d = vUv - 0.5;
      float dist = length(d) * 1.41421356; // normalize so corner ~= 1.0
      float vig = smoothstep(uVignetteSmooth.x, uVignetteSmooth.y, dist);
      // vig is 1 at center, ->0 toward corners; lerp toward darkened corners.
      color *= mix(1.0 - uVignetteStrength, 1.0, vig);

      gl_FragColor = vec4(clamp(color, 0.0, 1.0), texel.a);
    }
  `,
};

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

  // 5) Final cinematic color-grade + vignette. Runs LAST on the already
  //    tone-mapped / sRGB output, so it only grades the LDR result and never
  //    re-tonemaps. Resolution-independent (vignette uses normalized UVs), so
  //    no resize handling is needed for this pass.
  const gradePass = new ShaderPass(GradeShader);
  composer.addPass(gradePass);

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
    gradePass.dispose?.();
    renderPass.dispose?.();
  }

  return { composer, render, setSize, dispose };
}

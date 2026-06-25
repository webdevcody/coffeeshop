// A skateboard. Used two ways: as a small prop you can leave in the world
// (e.g. a rack in the skatepark), and as the board that appears under the local
// player's feet while skating (rides.js parents it beneath the character). The deck
// top uses the procedural "deck" art from cityArt (auto-upgrades to a real PNG if
// one is dropped into public/img/city/).

import * as THREE from "three";
import { artTexture } from "../world/cityArt.js";

// Build a skateboard Group ~0.8m long, lying flat, nose toward +Z.
export function makeSkateboard(opts = {}) {
  const g = new THREE.Group();

  const deckTex = artTexture("deck", { glyph: opts.glyph || "☠", accent: opts.accent || "#ff6a2b" });
  const deckMat = new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.6, metalness: 0.05 });
  const gripMat = new THREE.MeshStandardMaterial({ color: "#16171a", roughness: 0.95, metalness: 0.0 });
  const sideMat = new THREE.MeshStandardMaterial({ color: "#3a2a1c", roughness: 0.7 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: "#e8e4d8", roughness: 0.5 });
  const truckMat = new THREE.MeshStandardMaterial({ color: "#b9bcc4", roughness: 0.4, metalness: 0.7 });
  const boltMat = new THREE.MeshStandardMaterial({ color: "#6b6f78", roughness: 0.35, metalness: 0.85 });

  // ---- Deck ----------------------------------------------------------------
  // A 7-ply maple deck: a flat central section with two upturned ends (nose +Z,
  // tail -Z) for a kicktail feel. The flat middle carries the graphic; the kicked
  // ends are angled box segments so the silhouette reads as a real popsicle deck.
  const DECK_Y = 0.10;       // top-of-deck height (unchanged from the original)
  const DECK_W = 0.22;       // width
  const DECK_T = 0.032;      // ply thickness
  const FLAT_LEN = 0.52;     // length of the flat middle section
  const KICK_LEN = 0.16;     // length of each kicked end (along the board)
  const KICK_ANG = 0.34;     // upward angle of the kicked ends (~19.5 deg)

  // Flat middle, slightly thicker visual core so the graphic sits proud.
  const flat = new THREE.Mesh(new THREE.BoxGeometry(DECK_W, DECK_T, FLAT_LEN), sideMat);
  flat.position.set(0, DECK_Y - DECK_T / 2, 0);
  flat.castShadow = true;
  g.add(flat);

  // Grip-tape top (the riding surface) — a thin dark slab just above the core.
  const grip = new THREE.Mesh(new THREE.BoxGeometry(DECK_W - 0.012, 0.004, FLAT_LEN - 0.012), gripMat);
  grip.position.set(0, DECK_Y + 0.0025, 0);
  g.add(grip);

  // The cityArt "deck" graphic, inlaid on the grip as a stripe down the centre so
  // it stays visible (real grip is opaque, but the brand graphic shows through here).
  const art = new THREE.Mesh(new THREE.PlaneGeometry(DECK_W - 0.05, FLAT_LEN - 0.05), deckMat);
  art.rotation.x = -Math.PI / 2;
  art.position.set(0, DECK_Y + 0.0055, 0);
  g.add(art);

  // Two kicked ends. Each is an angled segment hinged at the edge of the flat
  // section; the inner face meets the flat end so there is no gap and no overlap.
  for (const dir of [1, -1]) {
    const end = new THREE.Group();
    // Place the hinge at the end of the flat section, on the deck centreline.
    const hingeZ = dir * (FLAT_LEN / 2);
    end.position.set(0, DECK_Y - DECK_T / 2, hingeZ);
    end.rotation.x = -dir * KICK_ANG; // nose/tail tilt up away from centre

    const kickWood = new THREE.Mesh(new THREE.BoxGeometry(DECK_W, DECK_T, KICK_LEN), sideMat);
    kickWood.position.set(0, 0, dir * KICK_LEN / 2);
    kickWood.castShadow = true;
    end.add(kickWood);

    const kickGrip = new THREE.Mesh(new THREE.BoxGeometry(DECK_W - 0.012, 0.004, KICK_LEN - 0.006), gripMat);
    kickGrip.position.set(0, DECK_T / 2 + 0.0025, dir * KICK_LEN / 2);
    end.add(kickGrip);

    g.add(end);
  }

  // ---- Trucks + wheels -----------------------------------------------------
  // A real axle: a baseplate + hanger under the deck, a metal axle rod spanning
  // the width, and a wheel at each end (4 wheels total). Wheels just kiss y=0.
  const wheelGeo = new THREE.CylinderGeometry(0.052, 0.052, 0.045, 16);
  const axleGeo = new THREE.CylinderGeometry(0.01, 0.01, DECK_W + 0.04, 8);
  const boltGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.012, 10);
  const WHEEL_X = (DECK_W + 0.04) / 2 - 0.012; // wheel centre near each axle tip
  const WHEEL_Y = 0.052;                        // radius -> bottom touches y=0

  for (const tz of [0.27, -0.27]) {
    // Baseplate bolted up against the underside of the deck.
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.012, 0.085), truckMat);
    base.position.set(0, DECK_Y - DECK_T - 0.006, tz);
    g.add(base);

    // Hanger: the triangular metal body, slung below the baseplate.
    const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.028, 0.05), truckMat);
    hanger.position.set(0, WHEEL_Y + 0.022, tz);
    g.add(hanger);

    // Axle rod across the width.
    const axle = new THREE.Mesh(axleGeo, boltMat);
    axle.rotation.z = Math.PI / 2;
    axle.position.set(0, WHEEL_Y, tz);
    g.add(axle);

    // Kingpin nut on top of the hanger (small detail bolt).
    const kingpin = new THREE.Mesh(boltGeo, boltMat);
    kingpin.position.set(0, WHEEL_Y + 0.04, tz);
    g.add(kingpin);

    for (const tx of [-WHEEL_X, WHEEL_X]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(tx, WHEEL_Y, tz);
      g.add(w);

      // Hub bolt cap on the outer wheel face.
      const cap = new THREE.Mesh(boltGeo, boltMat);
      cap.rotation.z = Math.PI / 2;
      cap.position.set(tx + (tx > 0 ? 0.026 : -0.026), WHEEL_Y, tz);
      g.add(cap);
    }
  }

  if (opts.scale) g.scale.setScalar(opts.scale);
  return g;
}

// A simple upright board-on-a-rack prop for decorating the skatepark.
export function makeBoardRack() {
  const g = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: "#55585f", roughness: 0.6, metalness: 0.4 });
  for (const px of [-0.5, 0.5]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.1, 8), postMat);
    post.position.set(px, 0.55, 0);
    post.castShadow = true;
    g.add(post);
  }
  for (let i = 0; i < 3; i++) {
    const b = makeSkateboard({ accent: ["#ff6a2b", "#2bd0ff", "#b35cff"][i] });
    b.rotation.x = Math.PI / 2; // stand it up
    b.position.set(-0.4 + i * 0.4, 0.6, 0);
    g.add(b);
  }
  return g;
}

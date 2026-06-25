// A low-poly skateboard. Used two ways: as a small prop you can leave in the world
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
  const sideMat = new THREE.MeshStandardMaterial({ color: "#3a2a1c", roughness: 0.7 });
  // Deck: a thin box; map the art on the top face. (BoxGeometry uses one material
  // for all faces unless we pass an array; top-art is close enough visually.)
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.82), [sideMat, sideMat, deckMat, sideMat, sideMat, sideMat]);
  deck.position.y = 0.10;
  deck.castShadow = true;
  g.add(deck);

  // trucks + wheels
  const wheelGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.05, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: "#e8e4d8", roughness: 0.5 });
  const truckMat = new THREE.MeshStandardMaterial({ color: "#b9bcc4", roughness: 0.4, metalness: 0.7 });
  for (const tz of [0.27, -0.27]) {
    const truck = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.05), truckMat);
    truck.position.set(0, 0.065, tz);
    g.add(truck);
    for (const tx of [-0.11, 0.11]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(tx, 0.05, tz);
      g.add(w);
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

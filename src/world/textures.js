// Small procedural canvas textures so the room has surface detail without
// shipping image assets. Each returns a THREE.CanvasTexture.

import * as THREE from "three";

function canvas(size = 256) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return c;
}

export function woodFloorTexture() {
  const c = canvas(512);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#7a4a25";
  ctx.fillRect(0, 0, 512, 512);
  const plankH = 64;
  for (let y = 0; y < 512; y += plankH) {
    // alternating plank tone
    const base = 100 + ((y / plankH) % 2) * 14;
    ctx.fillStyle = `rgb(${base + 24}, ${base - 18}, ${base - 60})`;
    ctx.fillRect(0, y + 1, 512, plankH - 2);
    // grain streaks
    for (let i = 0; i < 26; i++) {
      ctx.strokeStyle = `rgba(60,35,15,${0.05 + Math.random() * 0.12})`;
      ctx.lineWidth = 1;
      const gy = y + 4 + Math.random() * (plankH - 8);
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.bezierCurveTo(170, gy + (Math.random() * 6 - 3), 340, gy + (Math.random() * 6 - 3), 512, gy);
      ctx.stroke();
    }
    // plank seam
    ctx.fillStyle = "rgba(30,18,8,0.55)";
    ctx.fillRect(0, y, 512, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function plasterTexture(color = "#efe2cf") {
  const c = canvas(256);
  const ctx = c.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1800; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.04})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function chalkboardMenuTexture() {
  const c = canvas(512);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#20302b";
  ctx.fillRect(0, 0, 512, 512);
  ctx.textAlign = "center";
  ctx.fillStyle = "#f6efe0";
  ctx.font = "bold 52px Georgia, serif";
  ctx.fillText("MENU", 256, 70);
  ctx.strokeStyle = "rgba(246,239,224,0.5)";
  ctx.beginPath();
  ctx.moveTo(150, 88);
  ctx.lineTo(362, 88);
  ctx.stroke();

  const items = [
    ["Espresso", "3"],
    ["Cappuccino", "4"],
    ["Latte", "4.5"],
    ["Cold Brew", "5"],
    ["Mocha", "5"],
    ["Croissant", "3.5"],
    ["Matcha", "5"],
  ];
  ctx.font = "28px Georgia, serif";
  let y = 140;
  for (const [name, price] of items) {
    ctx.textAlign = "left";
    ctx.fillText(name, 70, y);
    ctx.textAlign = "right";
    ctx.fillText("$" + price, 442, y);
    y += 46;
  }
  ctx.textAlign = "center";
  ctx.font = "italic 22px Georgia, serif";
  ctx.fillStyle = "#d8c79e";
  ctx.fillText("~ welcome, friend ~", 256, y + 18);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

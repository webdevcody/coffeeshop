// The expanded city: 16 themed 60x60m districts laid out in a 4x4 grid in front of
// the cafe, radiating away from the entrance (+Z). Each district module builds its
// geometry in LOCAL space (centered on origin, spanning [-30,30] in X and Z) and
// returns { group, colliders, ground, update }. buildCity() places each at its world
// tile origin, offsets the colliders + walkable ground into world space, and merges
// everything so coffeeshop.js can fold it into the player's collision + fall system.
//
// Walkability: every tile contributes a full-tile ground rect, so the 4x4 grid tiles
// the plane continuously (x[-120,120], z[35,275]); buildings block via colliders. A
// wide connector rect bridges the cafe block to the city so you never fall crossing
// the road. The whole thing is drivable by the car (it falls off the same `ground`).

import * as THREE from "three";
import { buildPlaza } from "./zones/plaza.js";
import { buildSkatepark } from "./zones/skatepark.js";
import { buildMarket } from "./zones/market.js";
import { buildArcade } from "./zones/arcade.js";
import { buildDowntown } from "./zones/downtown.js";
import { buildAutoPlaza } from "./zones/autoplaza.js";
import { buildShopping } from "./zones/shopping.js";
import { buildArts } from "./zones/arts.js";
import { buildPark } from "./zones/park.js";
import { buildTransit } from "./zones/transit.js";
import { buildOffices } from "./zones/offices.js";
import { buildStadium } from "./zones/stadium.js";
import { buildPier } from "./zones/pier.js";
import { buildHarbor } from "./zones/harbor.js";
import { buildIndustrial } from "./zones/industrial.js";
import { buildNightlife } from "./zones/nightlife.js";
import { buildStreets } from "./cityStreets.js";
import { buildCityLife } from "./cityLife.js";
import { buildCityWeather } from "./cityWeather.js";

// 4 columns × 4 rows of 60m tiles. Row z grows AWAY from the cafe (entrance at z≈11).
const LAYOUT = [
  { build: buildPlaza, ox: -90, oz: 65 },
  { build: buildSkatepark, ox: -30, oz: 65 },
  { build: buildMarket, ox: 30, oz: 65 },
  { build: buildArcade, ox: 90, oz: 65 },
  { build: buildDowntown, ox: -90, oz: 125 },
  { build: buildAutoPlaza, ox: -30, oz: 125 },
  { build: buildShopping, ox: 30, oz: 125 },
  { build: buildArts, ox: 90, oz: 125 },
  { build: buildPark, ox: -90, oz: 185 },
  { build: buildTransit, ox: -30, oz: 185 },
  { build: buildOffices, ox: 30, oz: 185 },
  { build: buildStadium, ox: 90, oz: 185 },
  { build: buildPier, ox: -90, oz: 245 },
  { build: buildHarbor, ox: -30, oz: 245 },
  { build: buildIndustrial, ox: 30, oz: 245 },
  { build: buildNightlife, ox: 90, oz: 245 },
];

function offsetRect(r, ox, oz) {
  return { minX: r.minX + ox, maxX: r.maxX + ox, minZ: r.minZ + oz, maxZ: r.maxZ + oz };
}

export function buildCity(scene) {
  const group = new THREE.Group();
  group.name = "city";
  const colliders = [];
  const ground = [];
  const updates = [];

  // Unified pavement base + asphalt road grid carving the districts into blocks
  // (visual only — drivable/walkable; the ground rects already exist beneath it).
  try {
    const streets = buildStreets();
    if (streets && streets.group) group.add(streets.group);
    if (streets && typeof streets.update === "function") updates.push(streets.update);
    // Street-prop colliders are already in WORLD space (built around absolute road
    // coords), so merge them directly — do NOT offset like the per-tile district ones.
    if (streets && Array.isArray(streets.colliders)) for (const c of streets.colliders) colliders.push(c);
  } catch (e) {
    console.warn("[city] streets failed", e);
  }

  // Ambient life: cars driving the road grid + pedestrians on the sidewalks.
  // GTA hooks: getTraffic()/getPedestrians() surface the live roaming cars + people
  // so the player can steal/rob them. Default to empty accessors if life fails to
  // build, so the gameplay layer above can call them unconditionally.
  let getTraffic = () => [];
  let getPedestrians = () => [];
  try {
    const life = buildCityLife();
    if (life && life.group) group.add(life.group);
    if (typeof life.update === "function") updates.push(life.update);
    if (typeof life.getTraffic === "function") getTraffic = life.getTraffic;
    if (typeof life.getPedestrians === "function") getPedestrians = life.getPedestrians;
  } catch (e) {
    console.warn("[city] cityLife failed", e);
  }

  // Ambient weather: a slow clear→overcast→rain→clearing cycle with drifting clouds,
  // pooled instanced rain that blankets the map, distant lightning, and a wind value.
  // getRain()/getTornadoes() surface the live storm so the audio + tornado-fling
  // layers above can react. Default to inert accessors if weather fails to build.
  let getRain = () => 0;
  let getTornadoes = () => [];
  try {
    const weather = buildCityWeather();
    if (weather && weather.group) group.add(weather.group);
    if (weather && typeof weather.update === "function") updates.push(weather.update);
    if (weather && typeof weather.getRain === "function") getRain = weather.getRain;
    if (weather && typeof weather.getTornadoes === "function") getTornadoes = weather.getTornadoes;
  } catch (e) {
    console.warn("[city] cityWeather failed", e);
  }

  for (const tile of LAYOUT) {
    let d = null;
    try {
      d = tile.build();
    } catch (e) {
      // A single broken district must not take down the whole world.
      console.warn("[city] district build failed", tile.build?.name, e);
      continue;
    }
    if (!d || !d.group) continue;
    d.group.position.set(tile.ox, 0, tile.oz);
    group.add(d.group);
    for (const c of d.colliders || []) colliders.push(offsetRect(c, tile.ox, tile.oz));
    for (const g of d.ground || []) ground.push(offsetRect(g, tile.ox, tile.oz));
    if (typeof d.update === "function") updates.push(d.update);
  }

  // Connector apron: a wide walkable slab bridging the cafe block (z≈11) to the city
  // (z≥35), spanning the full city width so you can walk/drive out the door, across
  // the road, and into any district without falling.
  ground.push({ minX: -120, maxX: 120, minZ: 10, maxZ: 35 });

  scene.add(group);

  const update = (dt) => {
    for (const u of updates) {
      try { u(dt); } catch { /* a district anim error must not kill the loop */ }
    }
  };

  return { group, colliders, ground, update, getTraffic, getPedestrians, getRain, getTornadoes };
}

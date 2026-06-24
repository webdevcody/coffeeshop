// Central tuning constants for the coffeeshop. Keeping these in one place makes
// it cheap to iterate on feel without hunting through modules.

export const WORLD = {
  // The room is a rectangle on the XZ plane centered at the origin.
  width: 26, // X extent (wall to wall)
  depth: 22, // Z extent
  wallHeight: 5,
};

export const PLAYER = {
  radius: 0.45, // collision circle radius (XZ)
  speed: 4.2, // metres / second
  turnSpeed: 12, // how fast the body rotates toward movement direction
  height: 1.7,
};

export const CAMERA = {
  distance: 6.5, // how far behind the player
  lookHeight: 1.45, // point on the player the camera aims at
  follow: 6, // follow lerp speed
  baseHeight: 1.1, // constant lift added to the orbit height
  minPitch: 0.12,
  maxPitch: 0.92, // keep the camera from rising above the ceiling
  orbitSpeed: 0.005,
};

export const SEAT = {
  // How close (metres) you must stand to a chair/stool before you can sit on it.
  range: 1.2,
};

export const NET = {
  // Send local state at most this often (ms) to keep bandwidth modest.
  stateInterval: 60,
  // Remote players interpolate toward their latest known transform.
  lerp: 10,
};

export const VOICE = {
  // Distance (metres) at which a remote voice fades to silence.
  maxDistance: 12,
  minDistance: 2.5, // full volume within this radius
  // Voice-activity detection: mic RMS (0..1) at or above `speakThreshold`
  // counts as speaking; we hold the indicator on through `speakRelease`
  // seconds of quiet so it doesn't flicker between syllables.
  speakThreshold: 0.04,
  speakRelease: 0.35,
};

// A friendly palette used for character clothing when the player doesn't pick one.
export const PALETTE = [
  "#e76f51", "#2a9d8f", "#e9c46a", "#8ecae6", "#f4a261",
  "#a78bfa", "#ef476f", "#06d6a0", "#118ab2", "#ffb4a2",
];

// Skin and hair palettes shared by the character model and the customize panel,
// so the panel's swatches line up exactly with what the model can render.
export const SKIN_TONES = ["#ffdbac", "#f1c9a5", "#e0ac81", "#c68642", "#8d5524", "#5a3825"];
export const HAIR_TONES = ["#2b1b10", "#4a2f1b", "#1c1c1c", "#6b4423", "#8a8a8a", "#caa05a", "#d94f4f", "#7b4fd9"];

export function randomColor() {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

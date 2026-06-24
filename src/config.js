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

// Seated "board-view" camera. When the local player is seated at a game table
// and a board/menu is mounted, the camera eases from the walk-around follow-cam
// to a comfortable over-the-table view framed on the board centre, oriented so
// the player's own near edge is at the bottom of the screen. Gentle orbit + zoom
// still apply but are clamped around the board so you can't fly away.
export const SEATED_CAM = {
  // TRUE first-person seated view: the camera sits at the player's eyes and
  // looks across the table at the board (and the opponent beyond it). You should
  // NOT see your own head — the eye is leaned a touch forward over the table.
  eyeHeight: 0.95, // metres above the seat surface → eye ~0.65 m above the tabletop
  eyeForward: 0.12, // lean out over the table (your own body is hidden while seated)
  ease: 6.0, // lerp speed easing into/out of the seated view
  // Look-around while seated: yaw glances left/right, pitch tilts the gaze
  // between the board (down) and your opponent's face (up).
  yawRange: 0.6, // ± radians of horizontal glance
  minPitch: 0.15,
  maxPitch: 1.0,
  basePitch: 0.62, // resting gaze pitch (set on sit-down; looks down at the board)
  lookPitchGain: 1.2, // how far pitch raises/lowers the aim point (metres per rad)
  // Zoom dollies the eye relative to the board, hinged on a NEUTRAL anchor.
  // zoomNeutral (=default factor 1.0) is the framing with NO forced lean and NO
  // pull-back. Below it (toward zoomMin) the eye leans IN over the board, as
  // before. Above it (toward zoomMax) the eye dollies BACK along -fwd and rises
  // UP for a whole-board view, so large boards (battleship's two ocean grids)
  // fit fully on screen.
  zoomMin: 0.55, // scrolled all the way in (leans over the board)
  zoomNeutral: 1.0, // neutral / default (no lean, no pull-back)
  zoomMax: 1.8, // scrolled all the way out (eye dollied back + up); matches wheel max
  zoomLean: 0.4, // extra forward lean at full zoom-in (metres)
  zoomDrop: 0.16, // extra downward dip at full zoom-in (metres)
  zoomBack: 4.0, // eye retreat opposite the board at full zoom-out (metres)
  zoomRise: 1.2, // eye lift at full zoom-out (metres)
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

// Tiny, dependency-free localStorage persistence for the LOCAL player's state
// (appearance + money + last position + time-of-day). The whole thing lives as a
// single JSON blob under one key so callers can save just the field that changed.
//
// Every access is wrapped in try/catch so a blocked / full / private-mode
// localStorage degrades to a SILENT no-op instead of throwing — mirroring the
// mixer-persistence pattern in engine/audio.js (loadMixer/saveMixer). load()
// returns null when there's nothing usable so callers fall back to live defaults.

const STORE_KEY = "coffee.player";

export function createPersistence() {
  // Read the stored blob back, or null if absent / unreadable / corrupt / blocked.
  function load() {
    try {
      if (typeof localStorage === "undefined") return null;
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return obj && typeof obj === "object" ? obj : null;
    } catch (_) {
      return null; // storage blocked or corrupt — behave as a first visit
    }
  }

  // Write the given state object wholesale (replacing whatever was stored).
  function save(state) {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(STORE_KEY, JSON.stringify(state || {}));
    } catch (_) {
      /* storage blocked / over quota — non-fatal, just don't persist */
    }
  }

  // Merge `partial` into the stored object and save, so a caller can persist just
  // the changed field (money / appearance / lastPos / timeOfDay) without
  // clobbering the others. A no-op for an empty/falsy partial.
  function update(partial) {
    if (!partial || typeof partial !== "object") return;
    save(Object.assign(load() || {}, partial));
  }

  return { save, load, update };
}

// Floating DOM elements anchored to characters via CSS2DObject: persistent name
// tags and transient speech bubbles. All text goes in via textContent, so user
// names / chat can't inject markup.

import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

export function makeNameLabel(name) {
  const div = document.createElement("div");
  div.className = "name-label";
  div.textContent = name;
  const obj = new CSS2DObject(div);
  obj.position.set(0, 0.42, 0); // just above the head
  obj.center.set(0.5, 1);
  return obj;
}

export function makeChatBubble(text) {
  const div = document.createElement("div");
  div.className = "chat-bubble";
  div.textContent = text;
  const obj = new CSS2DObject(div);
  obj.position.set(0, 1.05, 0);
  obj.center.set(0.5, 1);
  // pop-in animation hook
  requestAnimationFrame(() => div.classList.add("show"));
  return obj;
}

// A small "muted" badge that floats above a remote player's head when *that*
// player can't hear you — because they've deafened (muted everyone) or muted you
// specifically. It warns you that talking to them is pointless. Starts hidden;
// toggle `obj.visible` to show it.
export function makeCantHearIndicator() {
  const div = document.createElement("div");
  div.className = "cant-hear-indicator";
  div.textContent = "🔇";
  div.title = "Can't hear you";
  const obj = new CSS2DObject(div);
  obj.position.set(0, 0.64, 0); // above the name label
  // Bottom-anchor so the badge grows upward, away from the name label below it,
  // instead of hanging down and overlapping it.
  obj.center.set(0.5, 0);
  obj.visible = false;
  return obj;
}

// A small animated "equalizer" badge that floats just above the name tag while
// a player is actively talking. Starts hidden; toggle `obj.visible` to show it
// (the CSS2D renderer maps that onto the element's display).
export function makeSpeakingIndicator() {
  const div = document.createElement("div");
  div.className = "speaking-indicator";
  for (let i = 0; i < 3; i++) div.appendChild(document.createElement("span"));
  const obj = new CSS2DObject(div);
  obj.position.set(0, 0.86, 0); // above the head, over the name + mute badge
  // Bottom-anchor so the indicator grows upward, away from the name + mute badge
  // below it, instead of hanging down and overlapping them.
  obj.center.set(0.5, 0);
  obj.visible = false;
  return obj;
}

// Update a name label's text (e.g. when a remote renames — currently unused but
// handy and cheap to keep).
export function setLabelText(labelObj, text) {
  if (labelObj?.element) labelObj.element.textContent = text;
}

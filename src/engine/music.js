// Procedural LOFI MUSIC manager — 100% synthesized with the WebAudio API.
//
// There are ZERO audio assets: the whole chill beat is built from oscillators and
// filtered noise, scheduled ahead on the AudioContext clock (a classic lookahead
// scheduler with setTimeout — NOT the render loop / rAF, so it never hitches with
// the frame rate). It plays into the shared mixer's "music" bus, so the J mixer
// panel + master volume + persistence all apply for free.
//
// The graph (built lazily on the first play(), once the ctx is resumed):
//
//   chords  ─► chordBus ─┐
//   bass    ─► bassBus  ─┼─► warmth (lowpass + slow "wow" LFO) ─┐
//   kick/snare/hat ─► drumBus ───────────────────────────────► out (music gain)
//   vinyl floor (looping noise) ─────────────────────────────►  │  └─► destination
//   vinyl pops  ─► crackleGain ──────────────────────────────►  ┘     (= music bus)
//
// Design rules (mirrors engine/audio.js):
//   • Everything is a no-op before the ctx is resumed (a user gesture). play()
//     bails when the ctx / music bus don't exist yet, so it's safe to wire up at
//     construction and call before the world unlocks audio.
//   • Scheduled per-note voices are short and auto-stop; each removes itself from
//     the live `active` set on `ended`. pause() clears the scheduler timer, fades
//     the bed out (no click), then force-stops any still-pending voices so nothing
//     leaks. The only always-on nodes are the wow LFO + the faint vinyl floor.
//   • No per-frame work: the host loop never calls into here. The setTimeout
//     scheduler drives itself.
//
// Transport API: play(), pause(), toggle(), next(), isPlaying(), trackName().

// Lofi 7th / 9th chord voicings (semitone intervals from the chord root). Soft,
// warm, and a touch jazzy — the bread and butter of a lofi progression.
const CHORD_TYPES = {
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom9: [0, 4, 7, 10, 14],
  min9: [0, 3, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
};

// A small set of progressions / keys to cycle with next(). Each: a display name,
// a laid-back tempo (BPM), a tonic `root` (MIDI note in a warm mid octave), and a
// 4-chord `prog` of [semitoneOffsetFromRoot, chordType]. The bass follows each
// chord's root an octave down.
const TRACKS = [
  // I – vi – ii – V in C — the cozy classic.
  { name: "Midnight Mocha", bpm: 72, root: 48, prog: [[0, "maj7"], [-3, "min7"], [2, "min7"], [7, "dom9"]] },
  // i – iv – ♭VII – v in D minor — rainy and a little wistful.
  { name: "Rainy Window", bpm: 75, root: 50, prog: [[0, "min9"], [5, "min7"], [-2, "maj7"], [-5, "min7"]] },
  // I – iii – IV – V in F — a dusty, sun-faded loop.
  { name: "Dusty Tape", bpm: 78, root: 53, prog: [[0, "maj9"], [4, "min7"], [5, "maj7"], [7, "dom9"]] },
  // i – iv – VI – v in E minor — slow and easy.
  { name: "Slow Sunday", bpm: 70, root: 52, prog: [[0, "min9"], [5, "min7"], [8, "maj7"], [7, "min7"]] },
];

// Scheduler timing. We plan at 8th-note resolution (8 steps per 4/4 bar) and look
// ~120 ms ahead, refilling every 25 ms — comfortably jitter-proof.
const SCHEDULE_AHEAD = 0.12; // seconds of audio scheduled in advance
const LOOKAHEAD_MS = 25; // how often the scheduler wakes to refill
const STEPS_PER_BAR = 8; // 8th notes per bar
const TARGET_GAIN = 0.85; // music bed level (the music bus rides on top of this)

// `ctx` and `destination` may each be a live value OR a getter — main.js passes
// getters because the AudioContext + music bus only exist after resume().
export function createLofiMusic({ ctx, destination } = {}) {
  const resolveCtx = () => (typeof ctx === "function" ? ctx() : ctx) || null;
  const resolveDest = () => (typeof destination === "function" ? destination() : destination) || null;

  // ── transport / scheduler state ───────────────────────────────────────────
  let playing = false;
  let trackIndex = 0;
  let step = 0; // running 8th-note counter (bar = floor(step / STEPS_PER_BAR))
  let nextStepTime = 0; // ctx time the next step should fire at
  let timerId = null; // setTimeout handle for the lookahead loop
  let noiseBuffer = null; // one shared white-noise buffer (drums / hats / vinyl)
  let g = null; // the persistent graph nodes, built once on first play()
  const active = new Set(); // live scheduled sources, so pause() can stop them

  // ── tiny helpers ──────────────────────────────────────────────────────────
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12); // MIDI note → Hz
  const rnd = (a, b) => a + Math.random() * (b - a);

  // One shared 2-second white-noise buffer for every noise voice (drums/vinyl).
  function getNoise(c) {
    if (noiseBuffer) return noiseBuffer;
    const len = Math.floor(c.sampleRate * 2);
    noiseBuffer = c.createBuffer(1, len, c.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuffer;
  }

  // Register a short source so it auto-cleans on end, and start+stop it. Tolerant
  // of a bad time/already-running node (never throws into the scheduler).
  function startStop(node, time, dur) {
    active.add(node);
    node.onended = () => {
      active.delete(node);
      try { node.disconnect(); } catch (_) { /* already gone */ }
    };
    try {
      node.start(time);
      node.stop(time + dur);
    } catch (_) {
      active.delete(node);
    }
  }

  // Force-stop + drop every still-pending scheduled voice (called after a pause
  // fade, so it never clicks). The always-on wow LFO + vinyl floor are NOT here.
  function stopActiveVoices() {
    const c = resolveCtx();
    const t = c ? c.currentTime : 0;
    for (const node of active) {
      try { node.onended = null; node.stop(t); } catch (_) { /* not started */ }
      try { node.disconnect(); } catch (_) { /* already gone */ }
    }
    active.clear();
  }

  // Smoothly ride the music bed level (used for fade-in / pause-out / crossfade).
  function fade(to, tau) {
    const c = resolveCtx();
    if (!g || !c) return;
    g.out.gain.setTargetAtTime(to, c.currentTime, tau);
  }

  // ── persistent graph (built once, lazily, when the ctx is available) ────────
  function buildGraph() {
    if (g) return g;
    const c = resolveCtx();
    const dest = resolveDest();
    if (!c || !dest) return null;

    // Master music gain → the mixer's music bus. Starts silent; faded in on play.
    const out = c.createGain();
    out.gain.value = 0.0001;
    out.connect(dest);

    // Warmth: a gentle lowpass over the tonal voices so nothing is harsh, with a
    // slow LFO breathing the cutoff for that wobbly cassette "wow/flutter".
    const warmth = c.createBiquadFilter();
    warmth.type = "lowpass";
    warmth.frequency.value = 2600;
    warmth.Q.value = 0.4;
    warmth.connect(out);
    const wow = c.createOscillator();
    wow.type = "sine";
    wow.frequency.value = 0.13;
    const wowDepth = c.createGain();
    wowDepth.gain.value = 260;
    wow.connect(wowDepth).connect(warmth.frequency);
    wow.start();

    // Sub-buses: chords + bass go through the warmth filter; drums stay a touch
    // brighter (straight to out) so the kick/snare keep their snap.
    const chordBus = c.createGain(); chordBus.gain.value = 0.5; chordBus.connect(warmth);
    const bassBus = c.createGain(); bassBus.gain.value = 0.65; bassBus.connect(warmth);
    const drumBus = c.createGain(); drumBus.gain.value = 0.9; drumBus.connect(out);

    // Faint, continuous vinyl noise floor (a soft hiss under everything).
    const floor = c.createBufferSource();
    floor.buffer = getNoise(c);
    floor.loop = true;
    const floorHP = c.createBiquadFilter();
    floorHP.type = "highpass";
    floorHP.frequency.value = 1400;
    const floorGain = c.createGain();
    floorGain.gain.value = 0.012;
    floor.connect(floorHP).connect(floorGain).connect(out);
    floor.start();

    // Bus for the scheduled random vinyl crackle pops.
    const crackleGain = c.createGain();
    crackleGain.gain.value = 0.5;
    crackleGain.connect(out);

    g = { out, warmth, chordBus, bassBus, drumBus, crackleGain };
    return g;
  }

  // ── voices ──────────────────────────────────────────────────────────────────
  // Warm chord: soft sine/triangle oscillators, each lightly detuned, through a
  // gentle attack→sustain→release envelope into the warmth filter.
  function playChord(notes, time, dur) {
    const c = resolveCtx();
    if (!c || !g) return;
    const peak = 0.13 / Math.sqrt(notes.length);
    for (const n of notes) {
      const o = c.createOscillator();
      o.type = Math.random() < 0.5 ? "sine" : "triangle";
      o.frequency.value = mtof(n);
      o.detune.value = rnd(-7, 7);
      const a = c.createGain();
      a.gain.setValueAtTime(0.0001, time);
      a.gain.linearRampToValueAtTime(peak, time + 0.35); // gentle swell in
      a.gain.setValueAtTime(peak, time + dur * 0.6);
      a.gain.exponentialRampToValueAtTime(0.0001, time + dur); // soft release
      o.connect(a).connect(g.chordBus);
      startStop(o, time, dur + 0.05);
    }
  }

  // Simple round sine bass following the chord root.
  function playBass(midi, time, dur) {
    const c = resolveCtx();
    if (!c || !g) return;
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.value = mtof(midi);
    const a = c.createGain();
    a.gain.setValueAtTime(0.0001, time);
    a.gain.linearRampToValueAtTime(0.5, time + 0.03);
    a.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(a).connect(g.bassBus);
    startStop(o, time, dur + 0.05);
  }

  // Soft kick: a low sine pitched down fast, with a quick decay.
  function playKick(time) {
    const c = resolveCtx();
    if (!c || !g) return;
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(125, time);
    o.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    const a = c.createGain();
    a.gain.setValueAtTime(0.9, time);
    a.gain.exponentialRampToValueAtTime(0.0001, time + 0.28);
    o.connect(a).connect(g.drumBus);
    startStop(o, time, 0.3);
  }

  // Snare: a bandpassed noise burst plus a faint tonal body.
  function playSnare(time) {
    const c = resolveCtx();
    if (!c || !g) return;
    const s = c.createBufferSource();
    s.buffer = getNoise(c);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1900;
    bp.Q.value = 0.7;
    const a = c.createGain();
    a.gain.setValueAtTime(0.0001, time);
    a.gain.exponentialRampToValueAtTime(0.32, time + 0.005);
    a.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
    s.connect(bp).connect(a).connect(g.drumBus);
    startStop(s, time, 0.2);

    const o = c.createOscillator();
    o.type = "triangle";
    o.frequency.value = 180;
    const ag = c.createGain();
    ag.gain.setValueAtTime(0.18, time);
    ag.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);
    o.connect(ag).connect(g.drumBus);
    startStop(o, time, 0.14);
  }

  // Hihat: a very short slice of highpassed noise. `vel` sets its level.
  function playHat(time, vel) {
    const c = resolveCtx();
    if (!c || !g) return;
    const s = c.createBufferSource();
    s.buffer = getNoise(c);
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const a = c.createGain();
    a.gain.setValueAtTime(0.0001, time);
    a.gain.exponentialRampToValueAtTime(vel, time + 0.004);
    a.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    s.connect(hp).connect(a).connect(g.drumBus);
    startStop(s, time, 0.06);
  }

  // A single vinyl crackle pop: a tiny resonant noise click at a random pitch.
  function playCrackle(time) {
    const c = resolveCtx();
    if (!c || !g) return;
    const s = c.createBufferSource();
    s.buffer = getNoise(c);
    s.playbackRate.value = rnd(0.8, 1.4);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = rnd(1500, 4000);
    bp.Q.value = 4;
    const a = c.createGain();
    const v = rnd(0.05, 0.18);
    a.gain.setValueAtTime(0.0001, time);
    a.gain.exponentialRampToValueAtTime(v, time + 0.002);
    a.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
    s.connect(bp).connect(a).connect(g.crackleGain);
    startStop(s, time, 0.04);
  }

  // ── scheduler ─────────────────────────────────────────────────────────────
  // Lay out one 8th-note step of the current track at `time`. Beats fall on the
  // even steps (0,2,4,6); offbeats (1,3,5,7) get a little swing delay.
  function scheduleStep(stepIndex, time) {
    const track = TRACKS[trackIndex];
    const localStep = ((stepIndex % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR;
    const bar = Math.floor(stepIndex / STEPS_PER_BAR);
    const chordPos = bar % track.prog.length;
    const eighth = (60 / track.bpm) / 2;
    const swing = localStep % 2 === 1 ? eighth * 0.12 : 0; // laid-back offbeats
    const swung = time + swing;

    const [off, type] = track.prog[chordPos];
    const chordRoot = track.root + off;

    // New chord + bass downbeat at the top of each bar.
    if (localStep === 0) {
      const intervals = CHORD_TYPES[type] || CHORD_TYPES.maj7;
      playChord(intervals.map((iv) => chordRoot + iv), time, eighth * STEPS_PER_BAR * 0.98);
      playBass(chordRoot - 12, time, eighth * 4 * 0.9);
    }
    // A second bass hit on beat 3 keeps the low end moving.
    if (localStep === 4) playBass(chordRoot - 12, time, eighth * 4 * 0.9);

    // Boom-bap drums: kick on 1 & 3, snare on 2 & 4 (snare a hair late), hats on
    // every 8th with the offbeats softer.
    if (localStep === 0 || localStep === 4) playKick(time);
    if (localStep === 2 || localStep === 6) playSnare(time + 0.012);
    playHat(swung, localStep % 2 === 0 ? 0.16 : 0.1);

    // Occasional vinyl crackle somewhere inside the step.
    if (Math.random() < 0.3) playCrackle(time + Math.random() * eighth);
  }

  // The lookahead loop: schedule every step whose time falls inside the window,
  // then re-arm. Self-terminating the moment we stop playing.
  function scheduler() {
    const c = resolveCtx();
    if (!c || !playing) { timerId = null; return; }
    while (nextStepTime < c.currentTime + SCHEDULE_AHEAD) {
      scheduleStep(step, nextStepTime);
      nextStepTime += (60 / TRACKS[trackIndex].bpm) / 2; // advance one 8th note
      step++;
    }
    timerId = setTimeout(scheduler, LOOKAHEAD_MS);
  }

  // ── transport (public) ──────────────────────────────────────────────────────
  // Start the bed. A no-op before the ctx is resumed (no ctx / music bus yet) or
  // when already playing. Fades in so it never clicks on.
  function play() {
    const c = resolveCtx();
    if (!c || !resolveDest()) return; // audio not unlocked yet — stay silent
    if (playing) return;
    if (!buildGraph()) return;
    if (c.state === "suspended") { try { c.resume(); } catch (_) { /* ignore */ } }
    playing = true;
    nextStepTime = c.currentTime + 0.12;
    fade(TARGET_GAIN, 0.4);
    if (!timerId) scheduler();
  }

  // Stop the bed: clear the scheduler, fade out (no click), then force-stop any
  // still-pending voices once the fade has passed so nothing lingers/leaks.
  function pause() {
    if (!playing) return;
    playing = false;
    if (timerId) { clearTimeout(timerId); timerId = null; }
    fade(0.0001, 0.12);
    setTimeout(() => { if (!playing) stopActiveVoices(); }, 260);
  }

  function toggle() {
    if (playing) pause();
    else play();
  }

  // Advance to a fresh progression / key. While playing, duck the bed, jump to the
  // new track at bar 0, and swell back — a quick crossfade. While paused, just
  // arm the next track so trackName() reflects it immediately.
  function next() {
    trackIndex = (trackIndex + 1) % TRACKS.length;
    step = 0; // restart cleanly at the top of the new progression
    if (playing && g) {
      const c = resolveCtx();
      fade(0.0001, 0.12); // duck out
      nextStepTime = c.currentTime + 0.4; // brief silent gap during the swap
      setTimeout(() => { if (playing) fade(TARGET_GAIN, 0.5); }, 380); // swell back
    }
  }

  const isPlaying = () => playing;
  const trackName = () => TRACKS[trackIndex].name;

  return { play, pause, toggle, next, isPlaying, trackName };
}

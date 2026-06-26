// Procedural sound engine — 100% synthesized with the WebAudio API.
//
// There are ZERO audio assets: every sound (ambient beds + one-shots) is built
// from oscillators and filtered noise so it works offline with no fetches. The
// graph is:
//
//   [beds: ambient / rain / engine / wind]  ─┐
//   [one-shots: blip/splash/whoosh/...]      ─┼─► master Gain ─► destination
//
// Design rules honoured here:
//   • The AudioContext is created LAZILY on the first resume() call, because
//     browsers block audio until a user gesture. Every public method is guarded
//     so calling it before resume() is a harmless no-op (the desired state is
//     remembered and applied once the context exists).
//   • Continuous beds are long-lived LOOPING graphs. Turning one "off" only
//     ramps its gain to 0 (the source keeps running) so starts/stops never
//     click. Each bed is a SINGLE idempotent instance, built on first use.
//   • Gain changes use setTargetAtTime() (exponential approach) so fades and
//     speed→pitch sweeps are smooth, never stepped.
//   • CPU is kept light: ONE white-noise AudioBuffer is shared by every voice,
//     and concurrent one-shot voices are capped. One-shots spin up a few
//     short-lived nodes that auto-stop — standard and allocation-cheap.
//
// ── Dropping in real audio files later ────────────────────────────────────
//   To use sampled sounds instead, add a loader next to getNoise():
//
//       async function loadSample(url) {
//         const buf = await fetch(url).then((r) => r.arrayBuffer());
//         return ctx.decodeAudioData(buf);
//       }
//
//   then in a one-shot play a BufferSource off that decoded AudioBuffer through
//   the same envelope→master path used below. The public API would not change.

export function createAudio() {
  // ── Context + master chain (all created on first resume) ──────────────────
  let ctx = null; // AudioContext | null  (null until the first user gesture)
  let master = null; // master GainNode → destination
  let noiseBuffer = null; // the one shared white-noise buffer

  let masterVolume = 0.8; // 0..1, user-facing master level
  let muted = false; // master mute (folds into the master gain)
  let voices = 0; // live one-shot voice count (capped)
  const MAX_VOICES = 14; // hard ceiling on concurrent one-shots

  // ── Mixer buses ────────────────────────────────────────────────────────────
  // Named GainNodes sit between every sound and the master so the player can ride
  // individual groups live (e.g. lower the wind without touching the music). Each
  // bus → master → destination. Built in resume() once the context exists; before
  // that the desired levels live in busVolume/busMuted and are applied on unlock.
  // The list (and order) the mixer panel renders:
  const BUS_DEFS = [
    { name: "ambient", label: "Ambience" }, // city/nature/space bed + birdsong
    { name: "wind", label: "Wind" },        // flight / altitude wind rush
    { name: "engine", label: "Engine" },    // vehicle hum (car/boat/rocket/…)
    { name: "weather", label: "Rain" },     // rain bed
    { name: "sfx", label: "Effects" },      // one-shots: blip/whoosh/splash/…
  ];
  let buses = null; // { ambient, wind, engine, weather, sfx } GainNodes (post-resume)
  // Per-bus level (0..1) + mute, defaulting to unity so default behaviour/levels
  // are byte-identical to before the mixer existed. Overwritten by any saved state.
  const busVolume = { ambient: 1, wind: 1, engine: 1, weather: 1, sfx: 1 };
  const busMuted = { ambient: false, wind: false, engine: false, weather: false, sfx: false };
  // Persisted mixer state (master + buses) so levels survive reloads.
  const STORE_KEY = "coffee.mixer";

  // Desired state, remembered so beds requested BEFORE resume() (e.g. weather
  // calling setRain) take effect the moment the context unlocks.
  const want = {
    ambient: false,
    rain: 0,
    engineOn: false,
    engineSpeed: 0,
    wind: 0,
  };

  // Long-lived bed graphs, each lazily built once then kept forever.
  let ambient = null; // { gain }  soft wind + scheduled birdsong
  let rain = null; // { gain }    filtered-noise rain + crackle
  let engine = null; // { gain, osc, sub, lp }  vehicle hum
  let wind = null; // { gain, bp } flight/altitude wind
  let birdTimer = null; // setTimeout handle for the next bird chirp

  // ── tiny helpers ──────────────────────────────────────────────────────────
  const now = () => (ctx ? ctx.currentTime : 0);
  // Exponential approach toward `value` (tau≈ time-constant in seconds). Tolerant
  // of being handed EITHER an AudioParam (e.g. master.gain) OR an AudioNode whose
  // own .gain is the param (e.g. a bed's GainNode) — call sites pass both. Never
  // throws: a bad/absent target is a silent no-op so audio can NEVER break the
  // game (this exact mismatch — calling setTargetAtTime on a GainNode — aborted
  // join before the player was created, so no avatar loaded).
  const ramp = (target, value, tau = 0.4) => {
    if (!ctx || !target) return;
    const param = typeof target.setTargetAtTime === "function" ? target : target.gain;
    if (param && typeof param.setTargetAtTime === "function") {
      param.setTargetAtTime(value, ctx.currentTime, tau);
    }
  };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp01 = (v) => Math.max(0, Math.min(1, v || 0));

  // ── Mixer persistence (guarded — storage can be blocked or corrupt) ─────────
  // Restore saved master + bus levels into the in-memory state. Called once at
  // construction (before any context), so the values are already live when
  // resume() seeds the bus GainNodes on the first user gesture.
  function loadMixer() {
    let raw = null;
    try {
      raw = typeof localStorage !== "undefined" && localStorage.getItem(STORE_KEY);
    } catch (_) {
      return; // storage blocked (private mode / sandbox) — keep defaults
    }
    if (!raw) return;
    try {
      const s = JSON.parse(raw);
      if (typeof s.master === "number") masterVolume = clamp01(s.master);
      if (typeof s.muted === "boolean") muted = s.muted;
      if (s.buses) for (const k in busVolume) if (typeof s.buses[k] === "number") busVolume[k] = clamp01(s.buses[k]);
      if (s.busMuted) for (const k in busMuted) if (typeof s.busMuted[k] === "boolean") busMuted[k] = s.busMuted[k];
    } catch (_) {
      /* corrupt JSON — keep defaults */
    }
  }
  // Write the live master + bus levels back to localStorage. Cheap; called on
  // every change (slider drag fires many, but each is a tiny JSON string).
  function saveMixer() {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(STORE_KEY, JSON.stringify({ master: masterVolume, muted, buses: busVolume, busMuted }));
    } catch (_) {
      /* storage blocked — non-fatal */
    }
  }
  loadMixer();

  // The GainNode a sound should connect into: its bus once resume() built them,
  // else the master (so a one-shot fired in the unlikely pre-bus window still
  // sounds). Post-resume every sound routes through its bus → master → out.
  function busNode(name) {
    return (buses && buses[name]) || master;
  }
  // Push a bus's effective level (muted → 0) to its GainNode, smoothed with
  // setTargetAtTime so moving a slider never clicks. No-op before the buses exist.
  function applyBus(name) {
    if (!buses || !buses[name]) return;
    ramp(buses[name].gain, busMuted[name] ? 0 : busVolume[name], 0.05);
  }

  // Build (once) a 2-second white-noise buffer shared by every noise voice.
  function getNoise() {
    if (noiseBuffer) return noiseBuffer;
    const len = Math.floor(ctx.sampleRate * 2);
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuffer;
  }

  // A looping noise source off the shared buffer (for the continuous beds).
  function noiseSource() {
    const s = ctx.createBufferSource();
    s.buffer = getNoise();
    s.loop = true;
    return s;
  }

  // Apply the live master level (mute folds straight into the same node).
  function applyMaster() {
    if (!master) return;
    ramp(master.gain, muted ? 0 : masterVolume, 0.05);
  }

  // ── beds ───────────────────────────────────────────────────────────────────
  // Gentle city/nature bed: low-passed noise "wind" with a slow LFO on its
  // cutoff for breathing gusts, plus sparse birdsong scheduled on a timer.
  function buildAmbient() {
    if (ambient) return ambient;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(busNode("ambient"));

    const src = noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 480;
    lp.Q.value = 0.5;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.5;
    src.connect(lp).connect(windGain).connect(gain);

    // Slow LFO breathes the wind cutoff so gusts swell and fade.
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.08;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 220;
    lfo.connect(lfoDepth).connect(lp.frequency);

    src.start();
    lfo.start();
    ambient = { gain };
    return ambient;
  }

  // One short bird chirp: a triangle whose pitch sweeps up-then-down through a
  // bandpass, wrapped in a fast pluck envelope. Cheap, auto-stops.
  function chirp(delay = 0) {
    if (!ctx || voices >= MAX_VOICES) return;
    const t0 = now() + delay;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2400;
    bp.Q.value = 6;
    const g = ctx.createGain();
    const base = rnd(1900, 2900);
    osc.frequency.setValueAtTime(base, t0);
    osc.frequency.linearRampToValueAtTime(base * 1.25, t0 + 0.05);
    osc.frequency.linearRampToValueAtTime(base * 0.95, t0 + 0.12);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.18, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
    osc.connect(bp).connect(g).connect(ambient ? ambient.gain : busNode("ambient"));
    track(osc, t0, 0.16);
    osc.start(t0);
    osc.stop(t0 + 0.16);
  }

  // While ambient is on, schedule a little 1–3 note bird burst every few sec.
  function scheduleBird() {
    if (birdTimer) clearTimeout(birdTimer);
    if (!ctx || !want.ambient) return;
    birdTimer = setTimeout(() => {
      if (want.ambient && ambient) {
        const notes = 1 + (Math.random() * 3) | 0;
        for (let i = 0; i < notes; i++) chirp(i * rnd(0.1, 0.22));
      }
      scheduleBird();
    }, rnd(2600, 7000));
  }

  function applyAmbient() {
    if (!ctx) return;
    buildAmbient();
    ramp(ambient.gain, want.ambient ? 0.5 : 0, 0.8);
    if (want.ambient) scheduleBird();
    else if (birdTimer) {
      clearTimeout(birdTimer);
      birdTimer = null;
    }
  }

  // Rain bed: shared noise through a bandpass for the hiss, plus a second
  // brighter highpassed branch for faint crackle. Gain tracks intensity.
  function buildRain() {
    if (rain) return rain;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(busNode("weather"));

    const src = noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1600;
    bp.Q.value = 0.7;
    const body = ctx.createGain();
    body.gain.value = 0.8;
    src.connect(bp).connect(body).connect(gain);

    // Faint high crackle so it isn't a flat hiss.
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 5200;
    const crackle = ctx.createGain();
    crackle.gain.value = 0.12;
    src.connect(hp).connect(crackle).connect(gain);

    src.start();
    rain = { gain };
    return rain;
  }

  function applyRain() {
    if (!ctx) return;
    buildRain();
    ramp(rain.gain, Math.max(0, Math.min(1, want.rain)) * 0.5, 0.6);
  }

  // Vehicle engine: a sawtooth + a sub sine through a lowpass. speed (0..1)
  // raises both the pitch and the level, smoothed so it never buzzes or steps.
  function buildEngine() {
    if (engine) return engine;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(busNode("engine"));

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 600;
    lp.Q.value = 1.2;
    lp.connect(gain);

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 60;
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.3;
    osc.connect(oscGain).connect(lp);

    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.value = 30;
    const subGain = ctx.createGain();
    // Low sub level: a heavy 0.6 sub-sine read as an annoying constant RUMBLE under
    // the car/rocket. Keep just a hint of low body.
    subGain.gain.value = 0.18;
    sub.connect(subGain).connect(lp);

    osc.start();
    sub.start();
    engine = { gain, osc, sub, lp };
    return engine;
  }

  function applyEngine() {
    if (!ctx) return;
    buildEngine();
    const sp = Math.max(0, Math.min(1, want.engineSpeed));
    const on = want.engineOn;
    // Idle ~70Hz rising to ~190Hz; lift the sub off the deep-rumble range and
    // brighten the lowpass with speed. Overall level kept LOW (was 0.14+sp*0.22,
    // which droned/rumbled) so the engine is a subtle hum, not a constant roar.
    ramp(engine.osc.frequency, 70 + sp * 120, 0.2);
    ramp(engine.sub.frequency, 40 + sp * 55, 0.2);
    ramp(engine.lp.frequency, 600 + sp * 1500, 0.2);
    ramp(engine.gain, on ? 0.05 + sp * 0.09 : 0, 0.25);
  }

  // Flight/altitude wind: louder, brighter bandpassed noise than ambient, with
  // an LFO buffeting the cutoff. intensity (0..1) drives gain + brightness.
  function buildWind() {
    if (wind) return wind;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(busNode("wind"));

    const src = noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900;
    bp.Q.value = 0.8;
    src.connect(bp).connect(gain);

    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.5;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 300;
    lfo.connect(lfoDepth).connect(bp.frequency);

    src.start();
    lfo.start();
    wind = { gain, bp };
    return wind;
  }

  function applyWind() {
    if (!ctx) return;
    buildWind();
    const it = Math.max(0, Math.min(1, want.wind));
    ramp(wind.bp.frequency, 700 + it * 1100, 0.3);
    // Quieter wind (was it*0.5 — too loud/roaring); a soft airy rush.
    ramp(wind.gain, it * 0.16, 0.4);
  }

  // ── one-shot plumbing ──────────────────────────────────────────────────────
  // Register a source so it decrements the voice counter when it ends, keeping
  // the concurrent-voice cap honest even if onended is delayed.
  function track(node, t0, dur) {
    voices++;
    let done = false;
    const free = () => {
      if (done) return;
      done = true;
      voices = Math.max(0, voices - 1);
    };
    node.onended = free;
    // Safety net in case onended doesn't fire (some browsers on disposed ctx).
    setTimeout(free, (t0 - now() + dur + 0.1) * 1000);
  }

  // Gate one-shots on context + the voice cap. Returns the start time or null.
  function beginVoice() {
    if (!ctx || voices >= MAX_VOICES) return null;
    return now();
  }

  // ── one-shots ──────────────────────────────────────────────────────────────
  // UI click/confirm: a tiny high sine blip with a fast pluck envelope.
  function blip() {
    const t0 = beginVoice();
    if (t0 === null) return;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, t0);
    osc.frequency.exponentialRampToValueAtTime(1320, t0 + 0.04);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    osc.connect(g).connect(busNode("sfx"));
    track(osc, t0, 0.14);
    osc.start(t0);
    osc.stop(t0 + 0.14);
  }

  // Water splash: a bright noise burst swept downward by a lowpass, plus a short
  // pitched "bloop" sine so it reads as something hitting water.
  function splash() {
    const t0 = beginVoice();
    if (t0 === null) return;
    const src = ctx.createBufferSource();
    src.buffer = getNoise();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(6000, t0);
    lp.frequency.exponentialRampToValueAtTime(700, t0 + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
    src.connect(lp).connect(g).connect(busNode("sfx"));
    track(src, t0, 0.36);
    src.start(t0);
    src.stop(t0 + 0.36);

    const bloop = ctx.createOscillator();
    bloop.type = "sine";
    bloop.frequency.setValueAtTime(600, t0);
    bloop.frequency.exponentialRampToValueAtTime(180, t0 + 0.18);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t0);
    bg.gain.exponentialRampToValueAtTime(0.22, t0 + 0.01);
    bg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
    bloop.connect(bg).connect(busNode("sfx"));
    track(bloop, t0, 0.22);
    bloop.start(t0);
    bloop.stop(t0 + 0.22);
  }

  // Jump / launch whoosh: bandpassed noise whose centre frequency sweeps up then
  // away, with a quick swell-and-fade envelope.
  function whoosh() {
    const t0 = beginVoice();
    if (t0 === null) return;
    const src = ctx.createBufferSource();
    src.buffer = getNoise();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(400, t0);
    bp.frequency.exponentialRampToValueAtTime(2200, t0 + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.3, t0 + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
    src.connect(bp).connect(g).connect(busNode("sfx"));
    track(src, t0, 0.36);
    src.start(t0);
    src.stop(t0 + 0.36);
  }

  // Explosion: a sharp filtered-noise crack, a fast-decaying low sine "boom",
  // and a longer low-passed noise tail (rumble) layered together.
  function explosion() {
    const t0 = beginVoice();
    if (t0 === null) return;

    // 1) crack — broadband noise burst, quick.
    const crack = ctx.createBufferSource();
    crack.buffer = getNoise();
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.5, t0);
    cg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    crack.connect(cg).connect(busNode("sfx"));
    track(crack, t0, 0.2);
    crack.start(t0);
    crack.stop(t0 + 0.2);

    // 2) boom — low sine dropping in pitch, fast decay.
    const boom = ctx.createOscillator();
    boom.type = "sine";
    boom.frequency.setValueAtTime(120, t0);
    boom.frequency.exponentialRampToValueAtTime(40, t0 + 0.4);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.6, t0);
    bg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
    boom.connect(bg).connect(busNode("sfx"));
    track(boom, t0, 0.5);
    boom.start(t0);
    boom.stop(t0 + 0.5);

    // 3) tail — longer low-passed noise rumble.
    const tail = ctx.createBufferSource();
    tail.buffer = getNoise();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(900, t0);
    lp.frequency.exponentialRampToValueAtTime(180, t0 + 0.9);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.0001, t0);
    tg.gain.linearRampToValueAtTime(0.3, t0 + 0.05);
    tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.0);
    tail.connect(lp).connect(tg).connect(busNode("sfx"));
    track(tail, t0, 1.0);
    tail.start(t0);
    tail.stop(t0 + 1.0);
  }

  // Vehicle horn: two stacked sawtooths (a slightly detuned interval) through a
  // lowpass, held flat then cut — the classic "beep".
  function horn() {
    const t0 = beginVoice();
    if (t0 === null) return;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.22, t0 + 0.02);
    g.gain.setValueAtTime(0.22, t0 + 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
    lp.connect(g).connect(busNode("sfx"));
    const freqs = [277, 370]; // a minor-thirdish honk
    const oscs = freqs.map((f) => {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.connect(lp);
      o.start(t0);
      o.stop(t0 + 0.6);
      return o;
    });
    track(oscs[0], t0, 0.62);
  }

  // Soft footstep: a brief low-passed noise tick with a snappy envelope.
  function footstep() {
    const t0 = beginVoice();
    if (t0 === null) return;
    const src = ctx.createBufferSource();
    src.buffer = getNoise();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = rnd(700, 1100);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(rnd(0.1, 0.18), t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
    src.connect(lp).connect(g).connect(busNode("sfx"));
    track(src, t0, 0.1);
    src.start(t0);
    src.stop(t0 + 0.1);
  }

  // ── lifecycle / public API ─────────────────────────────────────────────────
  // Call on the first user gesture (join/Enter click) to create + unlock the
  // context, then (re)apply whatever bed state was requested beforehand.
  function resume() {
    if (!ctx) {
      const AC =
        typeof window !== "undefined" &&
        (window.AudioContext || window.webkitAudioContext);
      if (!AC) return; // no WebAudio support — every method stays a no-op
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : masterVolume;
      master.connect(ctx.destination);
      // Build the mixer buses (each → master) and seed them with the restored
      // levels, so every bed/one-shot below routes through its bus from the start.
      buses = {};
      for (const def of BUS_DEFS) {
        const g = ctx.createGain();
        g.gain.value = busMuted[def.name] ? 0 : busVolume[def.name];
        g.connect(master);
        buses[def.name] = g;
      }
    }
    if (ctx.state === "suspended") ctx.resume();
    // Flush any state set before we had a context.
    applyAmbient();
    applyRain();
    applyEngine();
    applyWind();
  }

  function setMasterVolume(v) {
    masterVolume = clamp01(v);
    applyMaster();
    saveMixer();
  }
  function getMasterVolume() {
    return masterVolume;
  }

  function setMuted(b) {
    muted = !!b;
    applyMaster();
    saveMixer();
  }
  function getMuted() {
    return muted;
  }

  // ── Mixer bus controls (live, smoothed, persisted) ──────────────────────────
  // The {name,label} list the mixer panel renders one row per (master is its own
  // row, handled via get/setMasterVolume + get/setMuted).
  function getBuses() {
    return BUS_DEFS.map((b) => ({ name: b.name, label: b.label }));
  }
  function setBusVolume(name, v) {
    if (!(name in busVolume)) return;
    busVolume[name] = clamp01(v);
    applyBus(name);
    saveMixer();
  }
  function getBusVolume(name) {
    return name in busVolume ? busVolume[name] : 1;
  }
  function setBusMuted(name, b) {
    if (!(name in busMuted)) return;
    busMuted[name] = !!b;
    applyBus(name);
    saveMixer();
  }
  function getBusMuted(name) {
    return name in busMuted ? busMuted[name] : false;
  }

  function setAmbient(on) {
    want.ambient = !!on;
    applyAmbient();
  }

  function setRain(intensity) {
    want.rain = Math.max(0, Math.min(1, intensity || 0));
    applyRain();
  }

  function setEngine(on, speed = 0) {
    want.engineOn = !!on;
    want.engineSpeed = Math.max(0, Math.min(1, speed || 0));
    applyEngine();
  }

  function setWind(intensity) {
    want.wind = Math.max(0, Math.min(1, intensity || 0));
    applyWind();
  }

  // Tear everything down (used on teardown/hot-reload). Safe to call anytime.
  function dispose() {
    if (birdTimer) {
      clearTimeout(birdTimer);
      birdTimer = null;
    }
    if (ctx) {
      try {
        ctx.close();
      } catch (_) {
        /* already closed */
      }
    }
    ctx = null;
    master = null;
    buses = null;
    noiseBuffer = null;
    ambient = rain = engine = wind = null;
    voices = 0;
  }

  return {
    resume,
    setMasterVolume,
    getMasterVolume,
    setMuted,
    getMuted,
    getBuses,
    setBusVolume,
    getBusVolume,
    setBusMuted,
    getBusMuted,
    setAmbient,
    setRain,
    setEngine,
    setWind,
    blip,
    splash,
    whoosh,
    explosion,
    horn,
    footstep,
    dispose,
  };
}

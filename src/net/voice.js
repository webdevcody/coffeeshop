// Proximity voice chat over a WebRTC mesh. Each pair of mic-enabled players forms
// a peer connection; the remote audio's volume is scaled by in-world distance so
// conversations feel local. Signaling rides the server's `signal` relay.
//
// Glare avoidance: of any two peers, the one with the numerically lower id makes
// the offer. A tiny "hello" handshake announces mic availability both ways.

import { VOICE } from "../config.js";

const ICE = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export class Voice {
  constructor(network, positions) {
    this.net = network;
    this.positions = positions; // { local(): {x,z}, remote(id): {x,z}|null }
    this.enabled = false;
    this.localStream = null;
    /** Local mic muted: stay connected but stop transmitting (others can't hear you). */
    this.micMuted = false;
    /** Deafened: silence every remote voice at once, overriding per-person mutes. */
    this.deafened = false;
    /** @type {Map<string, {pc: RTCPeerConnection, audio: HTMLAudioElement, ready: boolean}>} */
    this.peers = new Map();
    this.knownIds = new Set();
    /** Ids the local player has chosen to mute (works even before a peer exists). */
    this.muted = new Set();
    this.onStatus = null;
    // Fires whenever your listening state changes (deafen toggled, or someone
    // muted/unmuted) so the app can tell the server who you can no longer hear.
    // Payload: { deafened, muted: string[] }.
    this.onMuteChange = null;
    // Voice-activity detection. One AnalyserNode per audible stream (each remote
    // peer + your own mic); `onSpeaking(id, speaking)` fires on each transition.
    this.onSpeaking = null;
    this.audioCtx = null;
    /** @type {Map<string, {source: AudioNode, analyser: AnalyserNode, data: Uint8Array, speaking: boolean, silent: number}>} */
    this.detectors = new Map();

    network.on("welcome", (m) => {
      this.myId = m.id;
      for (const p of m.players) this.knownIds.add(p.id);
    });
    network.on("player-joined", (m) => {
      this.knownIds.add(m.player.id);
      if (this.enabled) this._hello(m.player.id);
    });
    network.on("player-left", (m) => {
      this.knownIds.delete(m.id);
      this.muted.delete(m.id);
      this._closePeer(m.id);
    });
    network.on("signal", (m) => this._onSignal(m.from, m.data));
  }

  async enable() {
    if (this.enabled) return true;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (err) {
      this._status("mic blocked");
      return false;
    }
    this.enabled = true;
    // Honor a mic-mute chosen before voice was enabled.
    this._applyMicMute();
    this._status("on");
    // Watch your own mic so your indicator lights up as you talk.
    this._watch(this.myId, this.localStream);
    // Announce to everyone currently known.
    for (const id of this.knownIds) this._hello(id);
    return true;
  }

  disable() {
    this.enabled = false;
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    for (const id of [...this.peers.keys()]) this._closePeer(id);
    for (const id of [...this.detectors.keys()]) this._unwatch(id);
    this._status("off");
  }

  toggle() {
    return this.enabled ? (this.disable(), Promise.resolve(false)) : this.enable();
  }

  _status(s) {
    this.onStatus?.(s);
  }

  _notifyMute() {
    this.onMuteChange?.({ deafened: this.deafened, muted: [...this.muted] });
  }

  // --- Own mic muting ------------------------------------------------------
  // Stop transmitting your voice without tearing down the connection. Disabling
  // the track emits silence, so remote peers (and your own speaking indicator,
  // which watches the same stream) go quiet automatically.
  _applyMicMute() {
    if (!this.localStream) return;
    for (const t of this.localStream.getAudioTracks()) t.enabled = !this.micMuted;
  }

  setMicMuted(on) {
    this.micMuted = on;
    this._applyMicMute();
    return on;
  }

  toggleMicMute() {
    return this.setMicMuted(!this.micMuted);
  }

  // --- Deafen (mute everyone) ----------------------------------------------
  // Silence every remote voice at once. Per-person mute choices are preserved
  // underneath and take over again when you un-deafen.
  setDeafened(on) {
    this.deafened = on;
    for (const [id, peer] of this.peers) peer.audio.muted = on || this.muted.has(id);
    this._notifyMute();
    return on;
  }

  toggleDeafen() {
    return this.setDeafened(!this.deafened);
  }

  // --- Per-person muting ---------------------------------------------------
  isMuted(id) {
    return this.muted.has(id);
  }

  setMuted(id, on) {
    if (on) this.muted.add(id);
    else this.muted.delete(id);
    const peer = this.peers.get(id);
    if (peer) peer.audio.muted = on || this.deafened; // applies immediately; survives volume updates
    this._notifyMute();
    return on;
  }

  toggleMute(id) {
    return this.setMuted(id, !this.muted.has(id));
  }

  _hello(id) {
    this.net.signal(id, { kind: "hello" });
  }

  _initiator(otherId) {
    return Number(this.myId) < Number(otherId);
  }

  async _onSignal(from, data) {
    if (!data || !data.kind) return;
    switch (data.kind) {
      case "hello": {
        // Peer has mic on. If we do too, the lower id starts negotiation.
        this.knownIds.add(from);
        if (this.enabled) {
          if (!this.peers.has(from)) this._hello(from); // ensure they heard us
          if (this._initiator(from)) this._createPeer(from, true);
        }
        break;
      }
      case "offer": {
        const peer = this._createPeer(from, false);
        await peer.pc.setRemoteDescription(data.sdp);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.net.signal(from, { kind: "answer", sdp: peer.pc.localDescription });
        break;
      }
      case "answer": {
        const peer = this.peers.get(from);
        if (peer) await peer.pc.setRemoteDescription(data.sdp);
        break;
      }
      case "ice": {
        const peer = this.peers.get(from);
        if (peer && data.candidate) {
          try {
            await peer.pc.addIceCandidate(data.candidate);
          } catch {
            /* candidate may arrive before remote desc; ignore */
          }
        }
        break;
      }
    }
  }

  _createPeer(id, initiator) {
    let peer = this.peers.get(id);
    if (peer) return peer;

    const pc = new RTCPeerConnection(ICE);
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.dataset.peer = id;
    audio.muted = this.deafened || this.muted.has(id); // honor deafen / mute chosen before the peer connected
    document.body.appendChild(audio);

    peer = { pc, audio, ready: false };
    this.peers.set(id, peer);

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) this.net.signal(id, { kind: "ice", candidate: e.candidate });
    };
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0];
      peer.ready = true;
      this._watch(id, e.streams[0]); // light up their indicator while they talk
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        // leave cleanup to player-left / explicit disable
      }
    };

    if (initiator) {
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => this.net.signal(id, { kind: "offer", sdp: pc.localDescription }))
        .catch(() => {});
    }
    return peer;
  }

  _closePeer(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this._unwatch(id);
    try {
      peer.pc.close();
    } catch {
      /* ignore */
    }
    peer.audio.srcObject = null;
    peer.audio.remove();
    this.peers.delete(id);
  }

  // Called each frame: fade each remote voice by distance to the local player.
  updateVolumes() {
    if (this.peers.size === 0) return;
    const me = this.positions.local();
    for (const [id, peer] of this.peers) {
      if (!peer.ready) continue;
      if (this.deafened || this.muted.has(id)) {
        peer.audio.muted = true;
        continue;
      }
      peer.audio.muted = false;
      const rp = this.positions.remote(id);
      if (!rp) {
        peer.audio.volume = 0;
        continue;
      }
      const d = Math.hypot(rp.x - me.x, rp.z - me.z);
      let v;
      if (d <= VOICE.minDistance) v = 1;
      else if (d >= VOICE.maxDistance) v = 0;
      else v = 1 - (d - VOICE.minDistance) / (VOICE.maxDistance - VOICE.minDistance);
      peer.audio.volume = v * v; // perceptual-ish falloff
    }
  }

  // --- Voice-activity detection -------------------------------------------
  // A shared AudioContext drives one analyser per audible stream. Created lazily
  // (and resumed) from the user gesture that enables voice, so autoplay policies
  // don't leave it suspended.
  _ensureCtx() {
    if (!this.audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      this.audioCtx = new Ctx();
      // Silent sink. Chromium won't "pull" audio through an AnalyserNode fed by a
      // remote WebRTC stream unless the graph reaches a destination, so each
      // analyser feeds this muted gain node. Gain 0 ⇒ nothing is heard; playback
      // still happens through the per-peer <audio> element (and its distance
      // volume), so this only unblocks the meter. (Local mic streams work without
      // it, but routing them here too is harmless and keeps one code path.)
      this.sink = this.audioCtx.createGain();
      this.sink.gain.value = 0;
      this.sink.connect(this.audioCtx.destination);
    }
    if (this.audioCtx.state === "suspended") this.audioCtx.resume().catch(() => {});
    return this.audioCtx;
  }

  // Begin measuring loudness on a stream, keyed by player id. The analyser taps
  // the stream and drains into the silent sink, so it never affects playback.
  _watch(id, stream) {
    if (id == null || !stream) return;
    const ctx = this._ensureCtx();
    if (!ctx) return;
    this._unwatch(id); // replace any prior detector for this id
    let source;
    try {
      source = ctx.createMediaStreamSource(stream);
    } catch {
      return; // stream may not carry an audio track
    }
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.4;
    source.connect(analyser);
    analyser.connect(this.sink);
    this.detectors.set(id, {
      source,
      analyser,
      data: new Uint8Array(analyser.fftSize),
      speaking: false,
      silent: 0,
    });
  }

  _unwatch(id) {
    const det = this.detectors.get(id);
    if (!det) return;
    try {
      det.source.disconnect();
      det.analyser.disconnect();
    } catch {
      /* ignore */
    }
    this.detectors.delete(id);
    if (det.speaking) this._emitSpeaking(id, false);
  }

  _emitSpeaking(id, speaking) {
    this.onSpeaking?.(id, speaking);
  }

  // Called each frame: sample every watched stream's loudness and fire
  // onSpeaking transitions, with a short release so the indicator holds steady
  // through the natural gaps between syllables.
  updateSpeaking(dt) {
    if (this.detectors.size === 0) return;
    for (const [id, det] of this.detectors) {
      det.analyser.getByteTimeDomainData(det.data);
      let sum = 0;
      for (let i = 0; i < det.data.length; i++) {
        const v = (det.data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / det.data.length);
      if (rms >= VOICE.speakThreshold) {
        det.silent = 0;
        if (!det.speaking) {
          det.speaking = true;
          this._emitSpeaking(id, true);
        }
      } else if (det.speaking) {
        det.silent += dt;
        if (det.silent >= VOICE.speakRelease) {
          det.speaking = false;
          this._emitSpeaking(id, false);
        }
      }
    }
  }
}

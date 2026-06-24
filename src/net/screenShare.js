// Screen sharing over WebRTC. When you share your screen, the people who can
// hear you — table-mates when you're seated at a game table, or anyone nearby
// otherwise — see it in a little floating panel. It's deliberately one-way: the
// sharer is always the offerer and viewers just receive, so there's no glare to
// arbitrate. Signaling rides the same server `signal` relay as voice, namespaced
// with an `ss-` prefix so the two never cross wires.

import { VOICE } from "../config.js";

const ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

export class ScreenShare {
  constructor(network, positions, opts = {}) {
    this.net = network;
    this.positions = positions; // { local(): {x,z}, remote(id): {x,z}|null }
    this.getName = opts.getName || (() => "Someone");
    this.radius = opts.radius ?? VOICE.maxDistance; // proximity audience when not seated
    this.onStateChange = null; // (sharing: boolean) => void
    this.onError = null; // (message) => void

    this.sharing = false;
    this.stream = null;
    this.myId = null;
    this.knownIds = new Set();
    this.tableOf = new Map(); // id -> tableId (mirrors voice's table scoping)

    /** People I'm sending my screen to: id -> { pc }. */
    this.outPeers = new Map();
    /** People sharing their screen TO me: id -> { pc, tile, video }. */
    this.inPeers = new Map();

    this._tiles = document.createElement("div");
    this._tiles.className = "screenshare-tiles";
    (document.getElementById("ui") || document.body).appendChild(this._tiles);

    this._tick = 0;

    network.on("welcome", (m) => {
      this.myId = m.id;
      if (m.you?.gameTable) this.tableOf.set(m.id, m.you.gameTable);
      for (const p of m.players) {
        this.knownIds.add(p.id);
        if (p.gameTable) this.tableOf.set(p.id, p.gameTable);
      }
    });
    network.on("player-joined", (m) => {
      this.knownIds.add(m.player.id);
      if (m.player.gameTable) this.tableOf.set(m.player.id, m.player.gameTable);
    });
    network.on("player-left", (m) => {
      this.knownIds.delete(m.id);
      this.tableOf.delete(m.id);
      this._dropOut(m.id);
      this._dropIn(m.id);
    });
    network.on("seat-update", (m) => {
      if (m.table) this.tableOf.set(m.id, m.table);
      else this.tableOf.delete(m.id);
    });
    network.on("signal", (m) => this._onSignal(m.from, m.data));
  }

  // --- Public control ----------------------------------------------------
  async start() {
    if (this.sharing) return true;
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: "always" }, audio: false });
    } catch (err) {
      this.onError?.("Screen share was cancelled or blocked.");
      return false;
    }
    this.stream = stream;
    this.sharing = true;
    // The browser's own "Stop sharing" affordance ends the track — mirror it.
    stream.getVideoTracks().forEach((t) => (t.onended = () => this.stop()));
    this._refreshAudience();
    this.onStateChange?.(true);
    return true;
  }

  stop() {
    if (!this.sharing) return;
    this.sharing = false;
    for (const id of [...this.outPeers.keys()]) this._dropOut(id, true);
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.onStateChange?.(false);
  }

  toggle() {
    return this.sharing ? (this.stop(), Promise.resolve(false)) : this.start();
  }

  // Called each frame: while sharing, keep the audience in sync as people move,
  // sit down, or stand up.
  update(dt) {
    if (!this.sharing) return;
    this._tick += dt;
    if (this._tick < 1.2) return;
    this._tick = 0;
    this._refreshAudience();
  }

  // --- Audience (who should see my screen) -------------------------------
  // Same rule as voice audibility: seated → your table-mates; otherwise → people
  // within earshot. Keeps screen sharing scoped to "the people you're with".
  _audienceIds() {
    const out = new Set();
    const myTable = this.tableOf.get(this.myId) || null;
    const me = this.positions.local();
    for (const id of this.knownIds) {
      const theirTable = this.tableOf.get(id) || null;
      if (myTable || theirTable) {
        if (myTable && myTable === theirTable) out.add(id);
      } else {
        const rp = this.positions.remote(id);
        if (rp && Math.hypot(rp.x - me.x, rp.z - me.z) <= this.radius) out.add(id);
      }
    }
    return out;
  }

  _refreshAudience() {
    const want = this._audienceIds();
    for (const id of want) if (!this.outPeers.has(id)) this._connect(id);
    for (const id of [...this.outPeers.keys()]) if (!want.has(id)) this._dropOut(id, true);
  }

  // --- Outgoing (I'm the sharer) -----------------------------------------
  _connect(id) {
    if (this.outPeers.has(id) || !this.stream) return;
    const pc = new RTCPeerConnection(ICE);
    const peer = { pc };
    this.outPeers.set(id, peer);
    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.net.signal(id, { kind: "ss-ice", role: "sharer", candidate: e.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(pc.connectionState)) this._dropOut(id, false);
    };
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() => this.net.signal(id, { kind: "ss-offer", sdp: pc.localDescription }))
      .catch(() => {});
  }

  _dropOut(id, notify) {
    const peer = this.outPeers.get(id);
    if (!peer) return;
    if (notify) this.net.signal(id, { kind: "ss-stop" });
    try { peer.pc.close(); } catch { /* ignore */ }
    this.outPeers.delete(id);
  }

  // --- Incoming (someone is sharing to me) -------------------------------
  _onSignal(from, data) {
    if (!data || typeof data.kind !== "string" || !data.kind.startsWith("ss-")) return;
    switch (data.kind) {
      case "ss-offer": return this._onOffer(from, data.sdp);
      case "ss-answer": {
        const peer = this.outPeers.get(from);
        if (peer) peer.pc.setRemoteDescription(data.sdp).catch(() => {});
        return;
      }
      case "ss-ice": {
        // role tells us which side the candidate belongs to: a candidate from the
        // sharer is for our incoming peer; one from a viewer is for our outgoing.
        const peer = data.role === "sharer" ? this.inPeers.get(from) : this.outPeers.get(from);
        if (peer && data.candidate) peer.pc.addIceCandidate(data.candidate).catch(() => {});
        return;
      }
      case "ss-stop": return this._dropIn(from);
    }
  }

  async _onOffer(from, sdp) {
    this._dropIn(from); // replace any stale view from this person
    const pc = new RTCPeerConnection(ICE);
    const { tile, video } = this._makeTile(from);
    const peer = { pc, tile, video };
    this.inPeers.set(from, peer);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.net.signal(from, { kind: "ss-ice", role: "viewer", candidate: e.candidate });
    };
    pc.ontrack = (e) => { video.srcObject = e.streams[0]; };
    pc.onconnectionstatechange = () => {
      // 'disconnected' is transient and usually self-recovers (brief blip / ICE
      // restart), so only tear down on terminal states — matching the outgoing
      // path and voice.js.
      if (["failed", "closed"].includes(pc.connectionState)) this._dropIn(from);
    };
    try {
      await pc.setRemoteDescription(sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.net.signal(from, { kind: "ss-answer", sdp: pc.localDescription });
    } catch {
      this._dropIn(from);
    }
  }

  _dropIn(id) {
    const peer = this.inPeers.get(id);
    if (!peer) return;
    try { peer.pc.close(); } catch { /* ignore */ }
    peer.video.srcObject = null;
    peer.tile.remove();
    this.inPeers.delete(id);
  }

  // --- Viewer UI ----------------------------------------------------------
  _makeTile(id) {
    const tile = document.createElement("div");
    tile.className = "screenshare-tile";
    tile.innerHTML = `
      <div class="ss-bar"><span class="ss-name"></span><button class="ss-close" type="button" title="Hide">✕</button></div>
      <video class="ss-video" autoplay playsinline muted></video>`;
    tile.querySelector(".ss-name").textContent = `🖥️ ${this.getName(id)}'s screen`;
    const video = tile.querySelector(".ss-video");
    tile.querySelector(".ss-close").addEventListener("click", () => this._dropIn(id));
    this._tiles.appendChild(tile);
    return { tile, video };
  }
}

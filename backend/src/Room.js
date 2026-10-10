const { Participant, ROLES } = require('./Participant');
const { ActionError, generateId, extractVideoId } = require('./utils');

const MAX_PARTICIPANTS = 100;
const MAX_PENDING_REQUESTS = 20;
const MAX_MESSAGES = 100;

class Room {
  constructor(code) {
    this.code = code;
    this.participants = new Map(); // userId -> Participant (insertion order = join order)
    this.requests = new Map(); // requestId -> pending change request
    this.messages = []; // recent chat history
    this.state = {
      videoId: null,
      playState: 'paused', // 'playing' | 'paused'
      currentTime: 0, // seconds, as of `updatedAt`
      updatedAt: Date.now(),
    };
  }

  // ---------- participants ----------
  addParticipant(id, username) {
    if (this.participants.size >= MAX_PARTICIPANTS) throw new ActionError('Room is full');
    const role = this.participants.size === 0 ? ROLES.HOST : ROLES.PARTICIPANT;
    const p = new Participant({ id, username, role });
    this.participants.set(id, p);
    return p;
  }

  removeParticipant(id) {
    const p = this.participants.get(id);
    this.participants.delete(id);
    return p || null;
  }

  getParticipant(id) {
    return this.participants.get(id) || null;
  }

  requireParticipant(id) {
    const p = this.getParticipant(id);
    if (!p) throw new ActionError('You are not in this room');
    return p;
  }

  listParticipants() {
    return [...this.participants.values()].map((p) => p.toJSON());
  }

  isEmpty() {
    return this.participants.size === 0;
  }

  // When the host leaves: first moderator, else the longest-present participant.
  promoteNewHost() {
    const all = [...this.participants.values()];
    const next = all.find((p) => p.role === ROLES.MODERATOR) || all[0];
    if (next) next.role = ROLES.HOST;
    return next || null;
  }

  // ---------- permissions ----------
  assertCanControl(userId) {
    const p = this.requireParticipant(userId);
    if (!p.canControl()) throw new ActionError('Only the host or a moderator can do that');
    return p;
  }

  assertHost(userId) {
    const p = this.requireParticipant(userId);
    if (!p.isHost()) throw new ActionError('Only the host can do that');
    return p;
  }

  controllers() {
    return [...this.participants.values()].filter((p) => p.canControl());
  }

  // ---------- video state ----------
  // Live position: if playing, add the time elapsed since the last update.
  currentTime() {
    const { playState, currentTime, updatedAt } = this.state;
    return playState === 'playing' ? currentTime + (Date.now() - updatedAt) / 1000 : currentTime;
  }

  getState() {
    return {
      videoId: this.state.videoId,
      playState: this.state.playState,
      currentTime: this.currentTime(),
      serverTime: Date.now(),
    };
  }

  static normalizeAction(type, payload = {}) {
    switch (type) {
      case 'play':
      case 'pause':
        return {};
      case 'seek': {
        const t = Number(payload.time);
        if (!Number.isFinite(t) || t < 0) throw new ActionError('Invalid seek time');
        return { time: t };
      }
      case 'change_video': {
        const id = extractVideoId(payload.videoId);
        if (!id) throw new ActionError('Invalid YouTube URL or video ID');
        return { videoId: id };
      }
      default:
        throw new ActionError('Unknown action');
    }
  }

  // Assumes permission was already checked and payload normalized.
  applyAction(type, payload) {
    const now = Date.now();
    switch (type) {
      case 'play':
        if (!this.state.videoId) throw new ActionError('No video loaded yet');
        this.state.currentTime = this.currentTime();
        this.state.playState = 'playing';
        break;
      case 'pause':
        this.state.currentTime = this.currentTime();
        this.state.playState = 'paused';
        break;
      case 'seek':
        if (!this.state.videoId) throw new ActionError('No video loaded yet');
        this.state.currentTime = payload.time;
        break;
      case 'change_video':
        this.state.videoId = payload.videoId;
        this.state.currentTime = 0;
        this.state.playState = 'playing';
        break;
    }
    this.state.updatedAt = now;
  }

  // ---------- participant change requests ----------
  createRequest(userId, type, rawPayload) {
    const p = this.requireParticipant(userId);
    if (p.canControl()) throw new ActionError('You can do this directly');
    const payload = Room.normalizeAction(type, rawPayload);
    if (this.requests.size >= MAX_PENDING_REQUESTS) {
      throw new ActionError('Too many pending requests, try again shortly');
    }
    const req = {
      id: generateId(),
      userId,
      username: p.username,
      type,
      payload,
      createdAt: Date.now(),
    };
    this.requests.set(req.id, req);
    return req;
  }

  takeRequest(requestId) {
    const req = this.requests.get(requestId);
    if (!req) throw new ActionError('Request not found or already handled');
    this.requests.delete(requestId);
    return req;
  }

  listRequests() {
    return [...this.requests.values()];
  }

  dropRequestsFrom(userId) {
    const dropped = [];
    for (const req of this.requests.values()) {
      if (req.userId === userId) {
        this.requests.delete(req.id);
        dropped.push(req);
      }
    }
    return dropped;
  }

  // ---------- chat ----------
  addMessage(userId, text) {
    const p = this.requireParticipant(userId);
    const clean = typeof text === 'string' ? text.trim().slice(0, 500) : '';
    if (!clean) throw new ActionError('Message is empty');
    const msg = {
      id: generateId(),
      userId,
      username: p.username,
      role: p.role,
      text: clean,
      time: Date.now(),
    };
    this.messages.push(msg);
    if (this.messages.length > MAX_MESSAGES) this.messages.shift();
    return msg;
  }
}

module.exports = { Room };
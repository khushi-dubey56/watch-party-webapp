/*
 * Socket.IO event contract
 * ------------------------
 * Client -> Server (all accept an optional ack callback: ({ ok, error, ...data }) => void)
 *   create_room        { username }                -> { roomId, userId, role, state, participants, messages, requests }
 *   join_room          { roomId, username }        -> same as above
 *   leave_room         {}
 *   get_state          {}                          -> { state }   (use to re-sync after drift)
 *   play / pause       {}                          Host/Moderator only
 *   seek               { time }                    Host/Moderator only
 *   change_video       { videoId }  (URL or id)    Host/Moderator only
 *   request_action     { type, payload }           Participant asks for play|pause|seek|change_video
 *   approve_request    { requestId }               Host/Moderator
 *   reject_request     { requestId }               Host/Moderator
 *   assign_role        { userId, role }            Host only; role = 'moderator' | 'participant'
 *   remove_participant { userId }                  Host only
 *   transfer_host      { userId }                  Host only
 *   chat_message       { text }
 *
 * Server -> Client (broadcast to the room unless noted)
 *   sync_state          { videoId, playState, currentTime, serverTime, action, by }
 *   user_joined         { userId, username, role, participants }
 *   user_left           { userId, username, participants }
 *   role_assigned       { userId, username, role, participants }
 *   participant_removed { userId, username, participants }
 *   host_transferred    { userId, username, participants }
 *   chat_message        { id, userId, username, role, text, time }
 *   request_created     { request }                 (only to Host/Moderators)
 *   request_resolved    { requestId, status: 'approved'|'rejected'|'cancelled', by }
 *   pending_requests    { requests }                (only to a user who just became moderator)
 *   removed             { roomId }                  (only to the removed user)
 *   error_message       { message }                 (only to the sender, when no ack was given)
 */
const { ActionError } = require('./utils');
const { ROLES } = require('./Participant');
const { Room } = require('./Room');

const ASSIGNABLE_ROLES = new Set([ROLES.MODERATOR, ROLES.PARTICIPANT]);

class MessageHandler {
  constructor(io, roomManager) {
    this.io = io;
    this.rooms = roomManager;
  }

  register(socket) {
    // Wrap every handler: normalise args, catch errors, reply via ack or error_message.
    const on = (event, fn) => {
      socket.on(event, (payload, ack) => {
        if (typeof payload === 'function') {
          ack = payload;
          payload = {};
        }
        try {
          const result = fn(socket, payload && typeof payload === 'object' ? payload : {}) || {};
          if (typeof ack === 'function') ack({ ok: true, ...result });
        } catch (err) {
          const isExpected = err instanceof ActionError;
          if (!isExpected) console.error(`[${event}]`, err);
          const message = isExpected ? err.message : 'Something went wrong';
          if (typeof ack === 'function') ack({ ok: false, error: message });
          else socket.emit('error_message', { message });
        }
      });
    };

    on('create_room', (s, d) => this.createRoom(s, d));
    on('join_room', (s, d) => this.joinRoom(s, d));
    on('leave_room', (s) => this.leaveRoom(s));
    on('get_state', (s) => ({ state: this.ctx(s).room.getState() }));

    on('play', (s) => this.control(s, 'play', {}));
    on('pause', (s) => this.control(s, 'pause', {}));
    on('seek', (s, d) => this.control(s, 'seek', d));
    on('change_video', (s, d) => this.control(s, 'change_video', d));

    on('request_action', (s, d) => this.requestAction(s, d));
    on('approve_request', (s, d) => this.resolveRequest(s, d, true));
    on('reject_request', (s, d) => this.resolveRequest(s, d, false));

    on('assign_role', (s, d) => this.assignRole(s, d));
    on('remove_participant', (s, d) => this.removeParticipant(s, d));
    on('transfer_host', (s, d) => this.transferHost(s, d));
    on('chat_message', (s, d) => this.chat(s, d));

    socket.on('disconnect', () => this.leaveRoom(socket));
  }

  // ---------- helpers ----------
  ctx(socket) {
    const room = this.rooms.get(socket.data.roomId);
    if (!room) throw new ActionError('You are not in a room');
    room.requireParticipant(socket.id);
    return { room };
  }

  cleanUsername(name) {
    const u = typeof name === 'string' ? name.trim().slice(0, 24) : '';
    if (!u) throw new ActionError('Username is required');
    return u;
  }

  snapshot(room, userId) {
    const me = room.getParticipant(userId);
    return {
      roomId: room.code,
      userId,
      role: me.role,
      state: room.getState(),
      participants: room.listParticipants(),
      messages: room.messages,
      requests: me.canControl() ? room.listRequests() : [],
    };
  }

  broadcastState(room, action, by) {
    this.io.to(room.code).emit('sync_state', { ...room.getState(), action, by });
  }

  emitToControllers(room, event, payload) {
    for (const p of room.controllers()) this.io.to(p.id).emit(event, payload);
  }

  // ---------- room lifecycle ----------
  enter(socket, room, username) {
    // Make sure the socket is only in one room at a time.
    if (socket.data.roomId) this.leaveRoom(socket);
    const p = room.addParticipant(socket.id, username);
    socket.join(room.code);
    socket.data.roomId = room.code;
    return p;
  }

  createRoom(socket, { username }) {
    const name = this.cleanUsername(username);
    const room = this.rooms.create();
    this.enter(socket, room, name);
    return this.snapshot(room, socket.id);
  }

  joinRoom(socket, { roomId, username }) {
    const name = this.cleanUsername(username);
    const room = this.rooms.get(roomId);
    if (!room) throw new ActionError('Room not found');
    const p = this.enter(socket, room, name);
    socket.to(room.code).emit('user_joined', {
      userId: p.id,
      username: p.username,
      role: p.role,
      participants: room.listParticipants(),
    });
    return this.snapshot(room, socket.id);
  }

  leaveRoom(socket) {
    const roomId = socket.data.roomId;
    if (!roomId) return {};
    socket.leave(roomId);
    socket.data.roomId = null;

    const room = this.rooms.get(roomId);
    if (!room) return {};
    const p = room.removeParticipant(socket.id);
    if (!p) return {};

    if (room.isEmpty()) {
      this.rooms.delete(roomId);
      return {};
    }

    const dropped = room.dropRequestsFrom(p.id);
    const newHost = p.isHost() ? room.promoteNewHost() : null;

    this.io.to(roomId).emit('user_left', {
      userId: p.id,
      username: p.username,
      participants: room.listParticipants(),
    });
    for (const r of dropped) {
      this.emitToControllers(room, 'request_resolved', { requestId: r.id, status: 'cancelled' });
    }
    if (newHost) {
      this.io.to(roomId).emit('host_transferred', {
        userId: newHost.id,
        username: newHost.username,
        participants: room.listParticipants(),
      });
    }
    return {};
  }

  // ---------- playback ----------
  control(socket, type, rawPayload) {
    const { room } = this.ctx(socket);
    const me = room.assertCanControl(socket.id); // <-- role enforcement
    const payload = Room.normalizeAction(type, rawPayload);
    room.applyAction(type, payload);
    this.broadcastState(room, type, me.username);
    return {};
  }

  // ---------- participant requests (approval flow) ----------
  requestAction(socket, { type, payload }) {
    const { room } = this.ctx(socket);
    const req = room.createRequest(socket.id, type, payload);
    this.emitToControllers(room, 'request_created', { request: req });
    return { request: req };
  }

  resolveRequest(socket, { requestId }, approve) {
    const { room } = this.ctx(socket);
    const me = room.assertCanControl(socket.id);
    const req = room.takeRequest(requestId);

    if (approve) {
      try {
        room.applyAction(req.type, req.payload);
      } catch (err) {
        // e.g. "No video loaded yet": put the request back so it isn't lost.
        room.requests.set(req.id, req);
        throw err;
      }
      this.broadcastState(room, req.type, `${req.username} (approved by ${me.username})`);
    }

    this.io.to(room.code).emit('request_resolved', {
      requestId: req.id,
      userId: req.userId,
      type: req.type,
      status: approve ? 'approved' : 'rejected',
      by: me.username,
    });
    return {};
  }

  // ---------- roles ----------
  assignRole(socket, { userId, role }) {
    const { room } = this.ctx(socket);
    room.assertHost(socket.id);
    if (!ASSIGNABLE_ROLES.has(role)) throw new ActionError('Invalid role');
    const target = room.getParticipant(userId);
    if (!target) throw new ActionError('User not found in this room');
    if (target.isHost()) throw new ActionError('Cannot change the host role');

    target.role = role;
    this.io.to(room.code).emit('role_assigned', {
      userId: target.id,
      username: target.username,
      role: target.role,
      participants: room.listParticipants(),
    });
    // A new moderator needs to see requests that were already pending.
    if (target.canControl()) {
      this.io.to(target.id).emit('pending_requests', { requests: room.listRequests() });
    }
    return {};
  }

  removeParticipant(socket, { userId }) {
    const { room } = this.ctx(socket);
    room.assertHost(socket.id);
    if (userId === socket.id) throw new ActionError('You cannot remove yourself');
    const target = room.getParticipant(userId);
    if (!target) throw new ActionError('User not found in this room');

    const dropped = room.dropRequestsFrom(userId);
    room.removeParticipant(userId);

    this.io.to(userId).emit('removed', { roomId: room.code });
    const targetSocket = this.io.sockets.sockets.get(userId);
    if (targetSocket) {
      targetSocket.leave(room.code);
      targetSocket.data.roomId = null;
    }

    this.io.to(room.code).emit('participant_removed', {
      userId,
      username: target.username,
      participants: room.listParticipants(),
    });
    for (const r of dropped) {
      this.emitToControllers(room, 'request_resolved', { requestId: r.id, status: 'cancelled' });
    }
    return {};
  }

  transferHost(socket, { userId }) {
    const { room } = this.ctx(socket);
    const me = room.assertHost(socket.id);
    if (userId === socket.id) throw new ActionError('You are already the host');
    const target = room.getParticipant(userId);
    if (!target) throw new ActionError('User not found in this room');

    me.role = ROLES.MODERATOR; // old host stays useful as a moderator
    target.role = ROLES.HOST;
    this.io.to(room.code).emit('host_transferred', {
      userId: target.id,
      username: target.username,
      participants: room.listParticipants(),
    });
    this.io.to(target.id).emit('pending_requests', { requests: room.listRequests() });
    return {};
  }

  // ---------- chat ----------
  chat(socket, { text }) {
    const { room } = this.ctx(socket);
    const msg = room.addMessage(socket.id, text);
    this.io.to(room.code).emit('chat_message', msg);
    return {};
  }
}

module.exports = { MessageHandler };
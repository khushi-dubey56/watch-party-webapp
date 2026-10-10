const { Room } = require('./Room');
const { generateCode } = require('./utils');

// Owns every room. In-memory (fine for a single server instance).
class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  create() {
    let code;
    do {
      code = generateCode();
    } while (this.rooms.has(code));
    const room = new Room(code);
    this.rooms.set(code, room);
    return room;
  }

  get(code) {
    if (typeof code !== 'string') return null;
    return this.rooms.get(code.trim().toUpperCase()) || null;
  }

  delete(code) {
    this.rooms.delete(code);
  }

  get size() {
    return this.rooms.size;
  }
}

module.exports = { RoomManager };
const ROLES = Object.freeze({
  HOST: 'host',
  MODERATOR: 'moderator',
  PARTICIPANT: 'participant',
});

const CONTROL_ROLES = new Set([ROLES.HOST, ROLES.MODERATOR]);

class Participant {
  constructor({ id, username, role }) {
    this.id = id;
    this.username = username;
    this.role = role;
    this.joinedAt = Date.now();
  }

  canControl() {
    return CONTROL_ROLES.has(this.role);
  }

  isHost() {
    return this.role === ROLES.HOST;
  }

  toJSON() {
    return { userId: this.id, username: this.username, role: this.role };
  }
}

module.exports = { Participant, ROLES, CONTROL_ROLES };
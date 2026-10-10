// Small helpers shared across the server.

class ActionError extends Error {
  // Errors we WANT to show to the user (validation / permission problems).
  constructor(message) {
    super(message);
    this.name = 'ActionError';
  }
}

// No 0/O/1/I so codes are easy to read and type.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(length = 6) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

function generateId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const ID_RE = /^[\w-]{11}$/;

// Accepts a full YouTube URL (watch, youtu.be, embed, shorts, live) or a raw 11-char id.
function extractVideoId(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (ID_RE.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
    let id = null;
    if (host === 'youtu.be') {
      id = u.pathname.slice(1).split('/')[0];
    } else if (host === 'youtube.com' || host === 'music.youtube.com') {
      if (u.pathname === '/watch') {
        id = u.searchParams.get('v');
      } else {
        const m = u.pathname.match(/^\/(embed|shorts|live|v)\/([\w-]{11})/);
        id = m && m[2];
      }
    }
    return id && ID_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}

module.exports = { ActionError, generateCode, generateId, extractVideoId };
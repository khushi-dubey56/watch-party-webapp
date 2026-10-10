import { io } from 'socket.io-client';

// Dev: Vite runs on :5173 and the backend on :3001.
// Production: the backend serves this app, so we connect to the same origin.
const URL = import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? 'http://localhost:3001' : undefined);

export const socket = io(URL, { transports: ['websocket'] });

// Promise wrapper around socket.emit with an acknowledgement callback.
// Always resolves to { ok, error?, ...data } so callers never need try/catch.
export function emit(event, payload = {}) {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, payload, (err, res) => {
      if (err || !res) resolve({ ok: false, error: 'Server did not respond. Check your connection.' });
      else resolve(res);
    });
  });
}
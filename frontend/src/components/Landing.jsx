import { useState } from 'react';
import { emit } from '../socket';

export default function Landing({ onEntered, notice, connected }) {
  const params = new URLSearchParams(window.location.search);
  const [username, setUsername] = useState(() => {
    try {
      return localStorage.getItem('wp_username') || '';
    } catch {
      return '';
    }
  });
  const [code, setCode] = useState((params.get('room') || '').toUpperCase());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (event, payload) => {
    const name = username.trim();
    if (!name) return setError('Please enter your name first.');
    setBusy(true);
    setError('');
    const res = await emit(event, { ...payload, username: name });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    try {
      localStorage.setItem('wp_username', name);
    } catch {
      /* ignore */
    }
    onEntered(res, name);
  };

  const create = () => run('create_room', {});
  const join = () => {
    if (!code.trim()) return setError('Enter a room code.');
    run('join_room', { roomId: code.trim() });
  };

  return (
    <div className="landing">
      <div className="card">
        <h1>🎬 Watch Party</h1>
        <p className="muted">Watch YouTube together, perfectly in sync.</p>

        {notice && <div className="alert">{notice}</div>}
        {!connected && <div className="alert">Connecting to server…</div>}

        <label>Your name</label>
        <input
          value={username}
          maxLength={24}
          placeholder="e.g. Amish"
          onChange={(e) => setUsername(e.target.value)}
        />

        <button className="big" onClick={create} disabled={busy || !connected}>
          Create a new room
        </button>

        <div className="or">or join an existing room</div>

        <div className="row">
          <input
            value={code}
            maxLength={6}
            placeholder="ROOM CODE"
            style={{ textTransform: 'uppercase', letterSpacing: 2 }}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && join()}
          />
          <button onClick={join} disabled={busy || !connected}>
            Join
          </button>
        </div>

        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}
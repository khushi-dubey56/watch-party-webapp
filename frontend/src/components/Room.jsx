import { useCallback, useEffect, useRef, useState } from 'react';
import { socket, emit } from '../socket';
import { fmt } from '../utils';
import YouTubePlayer from './YouTubePlayer';
import Participants from './Participants';
import Chat from './Chat';

function describeRequest(r) {
  switch (r.type) {
    case 'play':
      return 'play the video';
    case 'pause':
      return 'pause the video';
    case 'seek':
      return `seek to ${fmt(r.payload.time)}`;
    case 'change_video':
      return `change the video (${r.payload.videoId})`;
    default:
      return r.type;
  }
}

function describeAction(d) {
  switch (d.action) {
    case 'play':
      return `${d.by} pressed play`;
    case 'pause':
      return `${d.by} paused the video`;
    case 'seek':
      return `${d.by} jumped to ${fmt(d.currentTime)}`;
    case 'change_video':
      return `${d.by} changed the video`;
    default:
      return '';
  }
}

export default function Room({ session, onLeave, onKicked }) {
  const myId = session.userId;
  const [participants, setParticipants] = useState(session.participants);
  const [sync, setSync] = useState(() => ({ ...session.state, receivedAt: Date.now(), seq: 0 }));
  const [messages, setMessages] = useState(session.messages || []);
  const [requests, setRequests] = useState(session.requests || []);
  const [lastAction, setLastAction] = useState('');
  const [toast, setToast] = useState('');
  const [videoInput, setVideoInput] = useState('');
  const toastTimer = useRef(null);
  const seq = useRef(0);
  const onKickedRef = useRef(onKicked);
  onKickedRef.current = onKicked;

  const me = participants.find((p) => p.userId === myId);
  const myRole = me ? me.role : 'participant';
  const canControl = myRole === 'host' || myRole === 'moderator';
  const isHost = myRole === 'host';

  const showToast = useCallback((m) => {
    setToast(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4500);
  }, []);

  const sys = useCallback((text) => {
    setMessages((prev) => [...prev.slice(-199), { id: `s${Date.now()}${Math.random()}`, system: true, text }]);
  }, []);

  // ---- server -> client events ----
  useEffect(() => {
    const handlers = {
      sync_state: (d) => {
        seq.current += 1;
        setSync({
          videoId: d.videoId,
          playState: d.playState,
          currentTime: d.currentTime,
          receivedAt: Date.now(),
          seq: seq.current,
        });
        if (d.action) setLastAction(describeAction(d));
      },
      user_joined: (d) => {
        setParticipants(d.participants);
        sys(`${d.username} joined`);
      },
      user_left: (d) => {
        setParticipants(d.participants);
        sys(`${d.username} left`);
      },
      role_assigned: (d) => {
        setParticipants(d.participants);
        sys(`${d.username} is now ${d.role}`);
        if (d.userId === myId) showToast(`Your role is now: ${d.role}`);
      },
      participant_removed: (d) => {
        setParticipants(d.participants);
        sys(`${d.username} was removed by the host`);
      },
      host_transferred: (d) => {
        setParticipants(d.participants);
        sys(`${d.username} is now the host`);
        if (d.userId === myId) showToast('You are now the host');
      },
      chat_message: (m) => setMessages((prev) => [...prev.slice(-199), m]),
      request_created: (d) => setRequests((prev) => [...prev.filter((r) => r.id !== d.request.id), d.request]),
      request_resolved: (d) => {
        setRequests((prev) => prev.filter((r) => r.id !== d.requestId));
        if (d.userId === myId && d.status !== 'cancelled') {
          showToast(`Your request was ${d.status} by ${d.by}`);
        }
      },
      pending_requests: (d) => setRequests(d.requests),
      removed: () => onKickedRef.current(),
      error_message: (d) => showToast(d.message),
    };
    Object.entries(handlers).forEach(([ev, fn]) => socket.on(ev, fn));
    return () => Object.entries(handlers).forEach(([ev, fn]) => socket.off(ev, fn));
  }, [myId, showToast, sys]);

  // Participants re-sync with the server every 10s to correct any drift.
  useEffect(() => {
    if (canControl) return undefined;
    const t = setInterval(async () => {
      const r = await emit('get_state');
      if (r.ok) {
        seq.current += 1;
        setSync({ ...r.state, receivedAt: Date.now(), seq: seq.current });
      }
    }, 10000);
    return () => clearInterval(t);
  }, [canControl]);

  // ---- client -> server actions ----
  const send = async (event, payload = {}) => {
    const r = await emit(event, payload);
    if (!r.ok) showToast(r.error);
    return r;
  };

  // Host/moderator act directly. Participants send a request that must be approved.
  const control = async (type, payload = {}) => {
    if (canControl) return send(type, payload);
    const r = await send('request_action', { type, payload });
    if (r.ok) showToast('Request sent. Waiting for the host/moderator to approve.');
    return r;
  };

  const submitVideo = async (e) => {
    e.preventDefault();
    if (!videoInput.trim()) return;
    const r = await control('change_video', { videoId: videoInput.trim() });
    if (r.ok) setVideoInput('');
  };

  const copy = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${label} copied`);
    } catch {
      showToast(text);
    }
  };

  const assign = (userId, role) => send('assign_role', { userId, role });
  const remove = (p) => {
    if (window.confirm(`Remove ${p.username} from the room?`)) send('remove_participant', { userId: p.userId });
  };
  const transfer = (p) => {
    if (window.confirm(`Make ${p.username} the host? You will become a moderator.`)) {
      send('transfer_host', { userId: p.userId });
    }
  };

  return (
    <div className="room">
      <header className="topbar">
        <div className="brand">🎬 Watch Party</div>
        <div className="roomcode">
          Room <strong>{session.roomId}</strong>
          <button className="ghost small" onClick={() => copy(session.roomId, 'Room code')}>
            Copy code
          </button>
          <button
            className="ghost small"
            onClick={() => copy(`${window.location.origin}/?room=${session.roomId}`, 'Invite link')}
          >
            Copy invite link
          </button>
        </div>
        <div className="me">
          <span className={`badge ${myRole}`}>{myRole}</span>
          <span>{session.username}</span>
          <button className="ghost small" onClick={onLeave}>
            Leave
          </button>
        </div>
      </header>

      <div className="layout">
        <main className="main">
          <YouTubePlayer
            sync={sync}
            canControl={canControl}
            onPlay={() => control('play')}
            onPause={() => control('pause')}
            onSeek={(time) => control('seek', { time })}
          />

          <div className="lastAction">{lastAction || 'Waiting for the first action…'}</div>

          {!canControl && (
            <div className="hint">
              You are a <strong>{myRole}</strong>. You can request changes, and the host or a moderator must approve
              them before they happen.
            </div>
          )}

          <form className="videoForm" onSubmit={submitVideo}>
            <input
              value={videoInput}
              placeholder="Paste a YouTube link or video ID"
              onChange={(e) => setVideoInput(e.target.value)}
            />
            <button type="submit">{canControl ? 'Change video' : 'Request change'}</button>
          </form>

          {canControl && (
            <section className="panel">
              <h3>Pending requests ({requests.length})</h3>
              {requests.length === 0 && <p className="muted">No pending requests.</p>}
              <ul className="requests">
                {requests.map((r) => (
                  <li key={r.id}>
                    <span>
                      <strong>{r.username}</strong> wants to {describeRequest(r)}
                    </span>
                    <span className="actions">
                      <button className="small" onClick={() => send('approve_request', { requestId: r.id })}>
                        Approve
                      </button>
                      <button className="danger small" onClick={() => send('reject_request', { requestId: r.id })}>
                        Reject
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </main>

        <aside className="side">
          <Participants
            participants={participants}
            myId={myId}
            isHost={isHost}
            onAssign={assign}
            onRemove={remove}
            onTransfer={transfer}
          />
          <Chat messages={messages} myId={myId} onSend={(text) => send('chat_message', { text })} />
        </aside>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
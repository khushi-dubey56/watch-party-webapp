import { useEffect, useRef, useState } from 'react';
import { socket, emit } from './socket';
import Landing from './components/Landing';
import Room from './components/Room';

export default function App() {
  const [session, setSession] = useState(null); // set after create/join succeeds
  const [notice, setNotice] = useState('');
  const [connected, setConnected] = useState(socket.connected);
  const sessionRef = useRef(null);
  const hasConnectedBefore = useRef(socket.connected);
  sessionRef.current = session;

  useEffect(() => {
    const onConnect = async () => {
      setConnected(true);
      // Reconnected after a drop: our old socket id is gone on the server, so re-join.
      if (hasConnectedBefore.current && sessionRef.current) {
        const s = sessionRef.current;
        const res = await emit('join_room', { roomId: s.roomId, username: s.username });
        if (res.ok) {
          setSession({ ...res, username: s.username });
        } else {
          setSession(null);
          setNotice('Connection was lost and the room no longer exists.');
        }
      }
      hasConnectedBefore.current = true;
    };
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  const handleEntered = (res, username) => {
    setNotice('');
    setSession({ ...res, username });
    window.history.replaceState(null, '', `/?room=${res.roomId}`);
  };

  const resetToLanding = (message = '') => {
    setSession(null);
    setNotice(message);
    window.history.replaceState(null, '', '/');
  };

  const handleLeave = async () => {
    await emit('leave_room');
    resetToLanding();
  };

  if (!session) {
    return <Landing onEntered={handleEntered} notice={notice} connected={connected} />;
  }

  return (
    <>
      {!connected && <div className="banner">Connection lost. Reconnecting…</div>}
      <Room
        key={session.userId}
        session={session}
        onLeave={handleLeave}
        onKicked={() => resetToLanding('You were removed from the room by the host.')}
      />
    </>
  );
}
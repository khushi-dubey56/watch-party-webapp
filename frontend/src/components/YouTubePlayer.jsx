import { useCallback, useEffect, useRef, useState } from 'react';
import { fmt } from '../utils';

// Load the YouTube IFrame API script once for the whole app.
let apiPromise = null;
function loadYouTubeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (previous) previous();
        resolve(window.YT);
      };
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    });
  }
  return apiPromise;
}

/*
 * The native YouTube controls are hidden and a transparent "shield" covers the video,
 * so NOBODY can change playback by clicking the video. All actions go through our own
 * control bar -> server -> broadcast. That keeps every client in sync and lets us
 * enforce roles: controllers act directly, participants send a request.
 */
export default function YouTubePlayer({ sync, canControl, onPlay, onPause, onSeek }) {
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const readyRef = useRef(false);
  const loadedVideoRef = useRef(null);
  const syncRef = useRef(sync);
  syncRef.current = sync;

  const [clock, setClock] = useState({ time: 0, duration: 0 });
  const [dragValue, setDragValue] = useState(null);
  const [needsTap, setNeedsTap] = useState(false);

  // Make the local player match the server state.
  const applyState = useCallback((s) => {
    const p = playerRef.current;
    if (!readyRef.current || !p || !s || !s.videoId) return;
    const playing = s.playState === 'playing';
    // Position now = position when the server sent it + time since we received it.
    const target = s.currentTime + (playing ? (Date.now() - s.receivedAt) / 1000 : 0);

    if (loadedVideoRef.current !== s.videoId) {
      loadedVideoRef.current = s.videoId;
      if (playing) p.loadVideoById({ videoId: s.videoId, startSeconds: target });
      else p.cueVideoById({ videoId: s.videoId, startSeconds: target });
    } else {
      const current = typeof p.getCurrentTime === 'function' ? p.getCurrentTime() : 0;
      if (Math.abs(current - target) > 1) p.seekTo(target, true); // fix drift > 1s
      if (playing) p.playVideo();
      else p.pauseVideo();
    }

    if (playing) {
      // Browsers can block autoplay. If playback did not start, ask for one click.
      setTimeout(() => {
        try {
          const st = p.getPlayerState();
          if (st !== 1 && st !== 3) setNeedsTap(true);
        } catch {
          /* ignore */
        }
      }, 2000);
    } else {
      setNeedsTap(false);
    }
  }, []);

  // Create the YouTube player once.
  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi().then((YT) => {
      if (cancelled || !containerRef.current) return;
      const el = document.createElement('div');
      containerRef.current.appendChild(el);
      playerRef.current = new YT.Player(el, {
        width: '100%',
        height: '100%',
        playerVars: { controls: 0, disablekb: 1, rel: 0, modestbranding: 1, playsinline: 1, fs: 0 },
        events: {
          onReady: () => {
            readyRef.current = true;
            applyState(syncRef.current);
          },
        },
      });
    });
    return () => {
      cancelled = true;
      readyRef.current = false;
      try {
        playerRef.current?.destroy();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
    };
  }, [applyState]);

  // Every time the server sends new state, apply it.
  useEffect(() => {
    applyState(sync);
  }, [sync, applyState]);

  // Poll the player for the progress bar.
  useEffect(() => {
    const t = setInterval(() => {
      const p = playerRef.current;
      if (!readyRef.current || !p || typeof p.getCurrentTime !== 'function') return;
      setClock({ time: p.getCurrentTime() || 0, duration: p.getDuration() || 0 });
    }, 500);
    return () => clearInterval(t);
  }, []);

  const commitSeek = () => {
    if (dragValue === null) return;
    onSeek(dragValue);
    setTimeout(() => setDragValue(null), 700); // hold the slider briefly so it doesn't jump back
  };

  const tapToPlay = () => {
    setNeedsTap(false);
    applyState({ ...syncRef.current });
    try {
      playerRef.current?.playVideo();
    } catch {
      /* ignore */
    }
  };

  const playing = sync.playState === 'playing';
  const shown = dragValue ?? clock.time;
  const duration = Math.max(1, Math.floor(clock.duration));

  return (
    <div className="playerWrap">
      <div className="player">
        <div className="yt" ref={containerRef} />
        <div className="shield" />
        {!sync.videoId && (
          <div className="overlay">
            <p>No video yet.</p>
            <p className="muted">{canControl ? 'Paste a YouTube link below.' : 'Ask the host or a moderator to pick a video.'}</p>
          </div>
        )}
        {needsTap && (
          <div className="overlay">
            <button className="big" onClick={tapToPlay}>
              ▶ Click to join playback
            </button>
          </div>
        )}
      </div>

      <div className="controls">
        <button onClick={playing ? onPause : onPlay} disabled={!sync.videoId}>
          {playing ? (canControl ? '⏸ Pause' : '⏸ Request pause') : canControl ? '▶ Play' : '▶ Request play'}
        </button>
        <span className="time">{fmt(shown)}</span>
        <input
          type="range"
          min={0}
          max={duration}
          step={1}
          value={Math.min(Math.floor(shown), duration)}
          disabled={!sync.videoId || !clock.duration}
          onChange={(e) => setDragValue(Number(e.target.value))}
          onPointerUp={commitSeek}
          onKeyUp={commitSeek}
        />
        <span className="time">{fmt(clock.duration)}</span>
      </div>
    </div>
  );
}
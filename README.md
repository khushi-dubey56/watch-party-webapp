# 🎬 YouTube Watch Party

Watch YouTube videos together in real time. Everyone in a room sees the same video, the same play/pause state and the same position. Rooms have roles, and the server enforces what each role may do.

**Live demo:** `https://YOUR-APP-NAME.onrender.com` (replace after deploying)

## Features

- Create a room (you become **Host**) or join with a **room code** or **invite link**
- Real-time sync of play, pause, seek and change video using **WebSockets (Socket.IO)**
- Late joiners start at the correct video and position
- **Role-based access control**, enforced on the backend
- Host can **assign roles**, **remove participants** and **transfer host**
- Participants can **request** an action; a Host/Moderator **approves or rejects** it
- Live participant list showing roles
- Text chat (bonus)
- OOP backend: `Room`, `Participant`, `RoomManager`, `MessageHandler` classes

## Roles

| Role | Play / Pause / Seek / Change video | Assign roles | Remove users | Transfer host |
|---|---|---|---|---|
| Host (room creator) | Yes | Yes | Yes | Yes |
| Moderator (assigned by Host) | Yes | No | No | No |
| Participant (default for joiners) | No, must **request** approval | No | No | No |

If the Host leaves, the first Moderator (otherwise the longest-present participant) becomes Host automatically.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite, YouTube IFrame API, socket.io-client |
| Backend | Node.js, Express, Socket.IO |
| Storage | In-memory (rooms live as long as someone is in them) |
| Hosting | Render (one web service serves both frontend and WebSocket server) |

## Project structure

```
watch-party/
├── package.json            # root scripts used by Render
├── backend/
│   ├── server.js           # Express + Socket.IO bootstrap, serves frontend/dist
│   └── src/
│       ├── Participant.js  # roles + permission helpers
│       ├── Room.js         # room state, validation, permission checks, requests
│       ├── RoomManager.js  # creates/finds/deletes rooms
│       ├── MessageHandler.js # every WebSocket event + role enforcement
│       └── utils.js        # room codes, YouTube URL parsing, ActionError
└── frontend/
    └── src/
        ├── App.jsx, socket.js
        └── components/ Landing, Room, YouTubePlayer, Participants, Chat
```

## Run locally

Requires Node.js 18+.

**Option A: development (two terminals)**

```bash
# Terminal 1
cd backend
npm install
npm start            # http://localhost:3001

# Terminal 2
cd frontend
npm install
npm run dev          # http://localhost:5173
```

Open http://localhost:5173 in two or three browser windows (use a normal window and an incognito window) to test with several users.

**Option B: production-style (one server)**

```bash
npm run build        # from the project root: builds the frontend, installs backend deps
npm start            # http://localhost:3001 serves everything
```

### Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `PORT` | backend | Port to listen on (Render sets this automatically; default 3001) |
| `CORS_ORIGIN` | backend | Optional. Comma-separated allowed origins if the frontend is hosted separately. Not needed when one service serves both. |
| `VITE_SERVER_URL` | frontend (build time) | Optional. Backend URL if frontend and backend are on different hosts. |

## Deploy on Render

1. Push the project to GitHub.
2. On Render: **New → Web Service**, connect the repo.
3. Settings:
   - **Runtime:** Node
   - **Build Command:** `npm run build`
   - **Start Command:** `npm start`
4. Deploy. Render gives you a public `https://...onrender.com` URL. Put it at the top of this README.

Notes: the free tier sleeps after inactivity, so the first load can take about 30-60 seconds. Rooms are in memory, so a server restart clears them.

## Architecture overview

```
 Browser A (Host)         Browser B (Participant)        Browser C (Moderator)
 React + YouTube          React + YouTube                React + YouTube
        │  ▲                    │  ▲                            │  ▲
        │  │ WebSocket          │  │                            │  │
        ▼  │ (Socket.IO)        ▼  │                            ▼  │
   ┌───────────────────────────────────────────────────────────────────┐
   │ Node.js server                                                    │
   │  MessageHandler  →  validates role  →  Room (state)  →  broadcast │
   └───────────────────────────────────────────────────────────────────┘
```

**Core idea: the server is the single source of truth.** Clients never change each other's players directly.

1. A user clicks Play, Seek or Change video. The client emits a WebSocket event (`play`, `seek`, `change_video`).
2. `MessageHandler` checks the sender's role with `room.assertCanControl()`. A Participant is rejected.
3. `Room` updates its state: `videoId`, `playState`, `currentTime` and a timestamp.
4. The server broadcasts `sync_state` to everyone in the room (Socket.IO room channel).
5. Every client applies the state to its YouTube player.

**Position tracking:** the server stores the position at the last update. While playing it computes the live position as `currentTime + (now - updatedAt)`. This is how late joiners and periodic re-syncs land at the right second.

**Drift correction:** clients seek only if their player is more than 1 second off. Participants also re-sync with the server every 10 seconds.

**Approval flow (Participant requests):**
`request_action` → server stores a pending request → `request_created` goes only to Host/Moderators → they send `approve_request` or `reject_request` → on approve, the server applies the action and broadcasts `sync_state` → `request_resolved` tells everyone.

**Role enforcement:** all permission checks run on the server (`assertCanControl`, `assertHost`). The UI also hides or relabels controls, but that is only for usability; the server never trusts the client.

**YouTube player:** native controls are hidden and a transparent shield covers the video, so nobody can change playback by clicking the video. All actions go through our own control bar and the server.

### WebSocket events

Client → Server: `create_room`, `join_room`, `leave_room`, `get_state`, `play`, `pause`, `seek`, `change_video`, `request_action`, `approve_request`, `reject_request`, `assign_role`, `remove_participant`, `transfer_host`, `chat_message`

Server → Client: `sync_state`, `user_joined`, `user_left`, `role_assigned`, `participant_removed`, `host_transferred`, `request_created`, `request_resolved`, `pending_requests`, `chat_message`, `removed`, `error_message`

Full payload documentation is in the header comment of `backend/src/MessageHandler.js`.

## Design decisions and trade-offs

- **Socket.IO instead of raw `ws`:** gives rooms, acknowledgements and auto-reconnect out of the box.
- **In-memory rooms:** simple and fast for an MVP. To scale horizontally, add the Socket.IO Redis adapter and store room state in Redis.
- **Server-authoritative state:** avoids two clients fighting over the video; costs one network round trip per action.
- **Own control bar instead of YouTube's:** the only reliable way to enforce roles and avoid feedback loops between clients.
- **Browser autoplay rules:** some browsers block autoplay. If so, a "Click to join playback" button appears.
- **Reconnect:** if a connection drops, the client re-joins the same room automatically (as a Participant, since the old session ended).

## Known limitations

- Rooms are not persisted; they disappear when everyone leaves or the server restarts.
- No login. Users are identified by the name they type.
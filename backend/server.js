const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const { RoomManager } = require('./src/RoomManager');
const { MessageHandler } = require('./src/MessageHandler');

const PORT = process.env.PORT || 3001;
// Comma-separated list of allowed frontend origins. Unset = allow all (fine when the
// backend also serves the frontend, since that is same-origin).
const CORS_ORIGIN = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CORS_ORIGIN } });

const roomManager = new RoomManager();
const handler = new MessageHandler(io, roomManager);

io.on('connection', (socket) => handler.register(socket));

app.get('/health', (req, res) => res.json({ ok: true, rooms: roomManager.size }));

// Serve the built React app (frontend/dist) so one Render service hosts everything.
const dist = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

server.listen(PORT, () => console.log(`Watch Party server listening on :${PORT}`));
const express = require('express');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const http = require('http');

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => res.json({ status: 'ok', app: 'BridgeVoice Server', sessions: sessions.size }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Sessions store: code -> { host, guest }
const sessions = new Map();

function genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const code = url.searchParams.get('code');
  const role = url.searchParams.get('role'); // host or guest
  const lang = url.searchParams.get('lang') || 'hi-IN';

  if (!code || !role) { ws.close(); return; }

  ws.role = role;
  ws.lang = lang;
  ws.code = code;
  ws.alive = true;

  // Create or join session
  if (role === 'host') {
    sessions.set(code, { host: ws, guest: null });
    ws.send(JSON.stringify({ t: 'waiting', code }));
  } else if (role === 'guest') {
    const session = sessions.get(code);
    if (!session) { ws.send(JSON.stringify({ t: 'error', msg: 'Session not found' })); ws.close(); return; }
    session.guest = ws;
    // Notify both
    ws.send(JSON.stringify({ t: 'connected', peerLang: session.host.lang }));
    if (session.host.readyState === 1) {
      session.host.send(JSON.stringify({ t: 'connected', peerLang: lang }));
    }
  }

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      const session = sessions.get(ws.code);
      if (!session) return;
      const peer = ws.role === 'host' ? session.guest : session.host;
      if (peer && peer.readyState === 1) {
        peer.send(JSON.stringify(msg));
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    const session = sessions.get(ws.code);
    if (!session) return;
    const peer = ws.role === 'host' ? session.guest : session.host;
    if (peer && peer.readyState === 1) {
      peer.send(JSON.stringify({ t: 'peer_left' }));
    }
    if (ws.role === 'host') sessions.delete(ws.code);
    else if (session) session.guest = null;
  });

  ws.on('pong', () => { ws.alive = true; });
});

// Ping to keep connections alive
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.alive) { ws.terminate(); return; }
    ws.alive = false;
    ws.ping();
  });
}, 30000);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`BridgeVoice Server running on port ${PORT}`));

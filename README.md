# Arcadia PvP

A lightweight, server-authoritative, turn-based multiplayer strategy game built with Node.js, Express, and Socket.IO. Supports 2–8 players, PvP and co-op room modes, country selection, synchronized turns, territory claiming, gathering, upgrades, attacks, and a shared event chronicle.

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000 in multiple browser tabs/devices. The first player creates a room and shares the displayed room code. Each player picks a different country; the host starts after at least two players have joined and selected countries.

## Deploy to Render

1. Create a **Web Service** connected to this project/repository.
2. Runtime: **Node**; Build command: `npm install`; Start command: `npm start` (or `node server.js`).
3. No environment variables are required. Render provides `PORT`, which the server reads automatically.
4. Open the service URL. Socket.IO uses the same origin; no sticky-session configuration is needed for a single service instance.

`GET /health` returns a basic health check. Room state is held in memory, so a restart or deploying multiple independent instances will not preserve/share active rooms. Use one instance for the included deployment setup.

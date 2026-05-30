# Dark Chess Online

A browser-based Taiwanese Dark Chess game with local play and online room-based multiplayer.

## Features

- Local two-player mode
- Online room creation
- Join room by room code
- Red / black player assignment
- Server-managed turn order
- Synchronized board state
- Surrender and restart
- Optional rule toggles:
  - Hidden capture
  - Combo capture
  - Rook rush
  - Cannon jump
  - Horse diagonal attack
  - Draw limit

## Run Locally

Install Node.js first:

https://nodejs.org

Then run:

```bash
npm start
```

Open:

```txt
http://localhost:3000
```

On Windows, you can also double-click:

```txt
START_WEBSITE.cmd
```

## How To Test Multiplayer

1. Open the website in one browser window.
2. Click Online Battle.
3. Create a room and copy the room code.
4. Open the website in another browser window.
5. Join with the same room code.
6. The first player is red. The second player is black.

## Deploy

This project needs a Node.js web service because online rooms are handled by `server.js`.

Static hosts such as GitHub Pages are not enough for the online version.

Recommended first deployment option:

https://render.com

Render settings:

```txt
Runtime: Node
Build Command: npm install
Start Command: npm start
```

After deployment, Render will provide a public URL that can be shared with friends.

## Notes

Rooms are currently stored in server memory. If the server restarts, active rooms will disappear.

This is fine for early testing. For a production version, room persistence and reconnect support should be added later.

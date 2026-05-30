[README.md](https://github.com/user-attachments/files/28423254/README.md)
# Dark Chess Online

A browser-based Taiwanese Dark Chess game with online room-based multiplayer.

## Overview

Dark Chess Online supports both local play and online matches. Players can create a room, share a room code, and play from separate browsers.

The game server manages room state, turn order, player sides, board synchronization, surrender, and restart.

## Features

- Local two-player mode
- Online room creation
- Join by room code
- Red / black player assignment
- Server-managed turns
- Synchronized board state
- Surrender and restart
- Configurable rule toggles

## Tech Stack

- HTML
- CSS
- JavaScript
- Node.js

## Local Development

```bash
npm start
```

Then open:

```txt
http://localhost:3000
```

## Deployment

This project must be deployed as a Node.js web service because online rooms are handled by `server.js`.

Example Render settings:

```txt
Runtime: Node
Build Command: npm install
Start Command: npm start
```

Static-only hosts such as GitHub Pages are not enough for the online multiplayer version.

## Status

This project is in active development. Rooms are currently stored in server memory, so active rooms reset when the server restarts.

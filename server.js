const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");

const piecesTemplate = [
  ["帥", "red"], ["仕", "red"], ["仕", "red"], ["相", "red"], ["相", "red"],
  ["俥", "red"], ["俥", "red"], ["傌", "red"], ["傌", "red"],
  ["炮", "red"], ["炮", "red"],
  ["兵", "red"], ["兵", "red"], ["兵", "red"], ["兵", "red"], ["兵", "red"],
  ["將", "black"], ["士", "black"], ["士", "black"], ["象", "black"], ["象", "black"],
  ["車", "black"], ["車", "black"], ["馬", "black"], ["馬", "black"],
  ["包", "black"], ["包", "black"],
  ["卒", "black"], ["卒", "black"], ["卒", "black"], ["卒", "black"], ["卒", "black"]
];

const ranks = {
  "帥": 7, "將": 7,
  "仕": 6, "士": 6,
  "相": 5, "象": 5,
  "俥": 4, "車": 4,
  "傌": 3, "馬": 3,
  "炮": 2, "包": 2,
  "兵": 1, "卒": 1
};

const defaultRules = {
  darkEat: true,
  combo: true,
  rook: true,
  cannon: true,
  horse: true,
  drawLimit: 25
};

const rooms = new Map();

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 100_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function makeId(size = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < size; i++) {
    id += alphabet[crypto.randomInt(alphabet.length)];
  }
  return id;
}

function shuffle(items) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function createGame(rules) {
  return {
    pieces: shuffle(piecesTemplate).map(([name, color]) => ({ name, color, flipped: false })),
    currentTurn: "red",
    selectedIndex: null,
    comboMode: false,
    logs: ["新局開始，等待紅方行動。"],
    ghostMarks: {},
    turnCount: 1,
    noCaptureTurns: 0,
    gameOver: false,
    winner: null,
    rules: normalizeRules(rules),
    version: 1
  };
}

function normalizeRules(rules = {}) {
  return {
    darkEat: rules.darkEat !== false,
    combo: rules.combo !== false,
    rook: rules.rook !== false,
    cannon: rules.cannon !== false,
    horse: rules.horse !== false,
    drawLimit: Math.max(5, Math.min(100, Number(rules.drawLimit) || 25))
  };
}

function publicRoom(room, playerId = null) {
  const side = playerId ? room.players[playerId] || null : null;
  return {
    roomCode: room.code,
    playerId,
    side,
    players: Object.values(room.players),
    ready: Object.keys(room.players).length === 2,
    game: room.game
  };
}

function colorName(color) {
  return color === "red" ? "紅方" : "黑方";
}

function turnName(game) {
  return colorName(game.currentTurn);
}

function addLog(game, text) {
  game.logs.unshift(text);
  if (game.logs.length > 18) game.logs.pop();
}

function switchTurn(game) {
  game.currentTurn = game.currentTurn === "red" ? "black" : "red";
  game.selectedIndex = null;
  game.comboMode = false;
  game.turnCount += 1;
}

function endGame(game, message, winner = null) {
  game.gameOver = true;
  game.winner = winner;
  game.selectedIndex = null;
  game.comboMode = false;
  addLog(game, message);
}

function addNoCaptureTurn(game) {
  game.noCaptureTurns += 1;
  if (game.noCaptureTurns >= game.rules.drawLimit) {
    endGame(game, `${game.rules.drawLimit} 回合沒有吃子，平局。`);
  }
}

function checkWinByElimination(game) {
  const redAlive = game.pieces.some(piece => piece && piece.color === "red");
  const blackAlive = game.pieces.some(piece => piece && piece.color === "black");
  if (!redAlive) endGame(game, "紅方沒有棋子了，黑方獲勝。", "black");
  if (!blackAlive) endGame(game, "黑方沒有棋子了，紅方獲勝。", "red");
}

function getXY(index) {
  return { x: index % 8, y: Math.floor(index / 8) };
}

function isNextTo(a, b) {
  const A = getXY(a);
  const B = getXY(b);
  return Math.abs(A.x - B.x) + Math.abs(A.y - B.y) === 1;
}

function isDiagonalOneStep(a, b) {
  const A = getXY(a);
  const B = getXY(b);
  return Math.abs(A.x - B.x) === 1 && Math.abs(A.y - B.y) === 1;
}

function isSameLine(a, b) {
  const A = getXY(a);
  const B = getXY(b);
  return A.x === B.x || A.y === B.y;
}

function getBetweenIndexes(a, b) {
  const A = getXY(a);
  const B = getXY(b);
  const result = [];
  if (A.x === B.x) {
    for (let y = Math.min(A.y, B.y) + 1; y < Math.max(A.y, B.y); y++) result.push(y * 8 + A.x);
  }
  if (A.y === B.y) {
    for (let x = Math.min(A.x, B.x) + 1; x < Math.max(A.x, B.x); x++) result.push(A.y * 8 + x);
  }
  return result;
}

function isRook(piece) {
  return piece.name === "俥" || piece.name === "車";
}

function isCannon(piece) {
  return piece.name === "炮" || piece.name === "包";
}

function isHorse(piece) {
  return piece.name === "傌" || piece.name === "馬";
}

function canNormalEat(attacker, defender) {
  if (attacker.color === defender.color) return false;
  const attackerIsSoldier = attacker.name === "兵" || attacker.name === "卒";
  const defenderIsKing = defender.name === "帥" || defender.name === "將";
  const attackerIsKing = attacker.name === "帥" || attacker.name === "將";
  const defenderIsSoldier = defender.name === "兵" || defender.name === "卒";
  if (attackerIsSoldier && defenderIsKing) return true;
  if (attackerIsKing && defenderIsSoldier) return false;
  return ranks[attacker.name] >= ranks[defender.name];
}

function canRookEat(game, fromIndex, toIndex) {
  if (!game.rules.rook || !isSameLine(fromIndex, toIndex)) return false;
  const between = getBetweenIndexes(fromIndex, toIndex);
  return between.length >= 1 && between.every(index => game.pieces[index] === null);
}

function canCannonEat(game, fromIndex, toIndex) {
  if (!game.rules.cannon || !isSameLine(fromIndex, toIndex)) return false;
  const blockers = getBetweenIndexes(fromIndex, toIndex).filter(index => game.pieces[index] !== null);
  return blockers.length === 1;
}

function canHorseEat(game, fromIndex, toIndex) {
  return game.rules.horse && isDiagonalOneStep(fromIndex, toIndex);
}

function canEat(game, attacker, defender, fromIndex, toIndex) {
  if (!attacker || !defender || attacker.color === defender.color) return false;
  if (isRook(attacker) && game.rules.rook) return canRookEat(game, fromIndex, toIndex);
  if (isCannon(attacker) && game.rules.cannon) return canCannonEat(game, fromIndex, toIndex);
  if (isHorse(attacker) && game.rules.horse) return canHorseEat(game, fromIndex, toIndex);
  return isNextTo(fromIndex, toIndex) && canNormalEat(attacker, defender);
}

function canAttemptEat(game, attacker, defender, fromIndex, toIndex) {
  if (!attacker || !defender || attacker.color === defender.color) return false;
  if (isNextTo(fromIndex, toIndex)) return true;
  if (isRook(attacker) && game.rules.rook && canRookEat(game, fromIndex, toIndex)) return true;
  if (isCannon(attacker) && game.rules.cannon && canCannonEat(game, fromIndex, toIndex)) return true;
  if (isHorse(attacker) && game.rules.horse && canHorseEat(game, fromIndex, toIndex)) return true;
  return false;
}

function applyAction(room, playerId, action) {
  const game = room.game;
  const side = room.players[playerId];
  if (!side) return { ok: false, message: "你不在這個房間。" };
  if (Object.keys(room.players).length < 2) return { ok: false, message: "還在等待對手加入。" };
  if (game.gameOver && action.type !== "restart") return { ok: false, message: "這局已經結束。" };

  if (action.type === "select") {
    const index = Number(action.index);
    if (!Number.isInteger(index) || index < 0 || index > 31) return { ok: false, message: "位置錯誤。" };
    if (side !== game.currentTurn) return { ok: false, message: "還沒輪到你。" };
    handleClick(game, index);
    game.version += 1;
    return { ok: true };
  }

  if (action.type === "surrender") {
    if (side !== game.currentTurn) return { ok: false, message: "輪到你時才能投降。" };
    const winner = side === "red" ? "black" : "red";
    endGame(game, `${colorName(side)}投降，${colorName(winner)}獲勝。`, winner);
    game.version += 1;
    return { ok: true };
  }

  if (action.type === "restart") {
    room.game = createGame(room.game.rules);
    room.game.version += 1;
    return { ok: true };
  }

  return { ok: false, message: "未知動作。" };
}

function handleClick(game, index) {
  const target = game.pieces[index];
  if (game.selectedIndex === null) {
    if (target && !target.flipped) {
      target.flipped = true;
      addLog(game, `${turnName(game)}翻開 ${target.name}`);
      addNoCaptureTurn(game);
      if (!game.gameOver) switchTurn(game);
      return;
    }
    if (target && target.flipped && target.color === game.currentTurn) {
      game.selectedIndex = index;
    }
    return;
  }

  if (index === game.selectedIndex) {
    if (game.comboMode) {
      addNoCaptureTurn(game);
      if (!game.gameOver) switchTurn(game);
    } else {
      game.selectedIndex = null;
    }
    return;
  }

  const attacker = game.pieces[game.selectedIndex];
  if (!attacker || attacker.color !== game.currentTurn) {
    game.selectedIndex = null;
    return;
  }

  if (!target) {
    if (!game.comboMode && isNextTo(game.selectedIndex, index)) {
      game.pieces[index] = attacker;
      game.pieces[game.selectedIndex] = null;
      addLog(game, `${turnName(game)}移動 ${attacker.name}`);
      addNoCaptureTurn(game);
      if (!game.gameOver) switchTurn(game);
    } else {
      addLog(game, "這一步不能移動。");
    }
    return;
  }

  if (game.comboMode && !canAttemptEat(game, attacker, target, game.selectedIndex, index)) {
    addLog(game, "連吃中只能點選這顆棋可攻擊的位置。");
    return;
  }

  if (!target.flipped && !game.rules.darkEat) {
    target.flipped = true;
    addLog(game, `${turnName(game)}翻開 ${target.name}`);
    addNoCaptureTurn(game);
    if (!game.gameOver) switchTurn(game);
    return;
  }

  tryEat(game, game.selectedIndex, index);
}

function tryEat(game, fromIndex, toIndex) {
  const attacker = game.pieces[fromIndex];
  const defender = game.pieces[toIndex];
  if (!attacker || !defender) return;

  const wasHidden = !defender.flipped;
  const success = canEat(game, attacker, defender, fromIndex, toIndex);
  if (success) {
    game.noCaptureTurns = 0;
    if (wasHidden) {
      game.ghostMarks[toIndex] = {
        name: defender.name,
        color: defender.color,
        eatenBy: attacker.name
      };
    }
    game.pieces[toIndex] = attacker;
    game.pieces[fromIndex] = null;
    addLog(game, wasHidden
      ? `${turnName(game)}暗吃成功：${attacker.name} 吃掉 ${colorName(defender.color)}${defender.name}`
      : `${turnName(game)}吃掉 ${colorName(defender.color)}${defender.name}`);
    checkWinByElimination(game);
    if (!game.gameOver) {
      if (game.rules.combo) {
        game.selectedIndex = toIndex;
        game.comboMode = true;
      } else {
        switchTurn(game);
      }
    }
    return;
  }

  if (wasHidden) {
    defender.flipped = true;
    addLog(game, `${turnName(game)}暗吃失敗，翻出 ${colorName(defender.color)}${defender.name}`);
    addNoCaptureTurn(game);
    if (!game.gameOver) switchTurn(game);
  } else {
    addLog(game, `不能吃：${attacker.name} 吃不了 ${defender.name}`);
    game.selectedIndex = fromIndex;
  }
}

function serveStatic(req, res) {
  const requested = req.url === "/" ? "/index.html" : decodeURIComponent(req.url.split("?")[0]);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    const type = ext === ".html" ? "text/html; charset=utf-8"
      : ext === ".css" ? "text/css; charset=utf-8"
      : ext === ".js" ? "text/javascript; charset=utf-8"
      : "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/create-room") {
      const body = await readBody(req);
      let code = makeId();
      while (rooms.has(code)) code = makeId();
      const playerId = crypto.randomUUID();
      const room = {
        code,
        players: { [playerId]: "red" },
        game: createGame(body.rules),
        updatedAt: Date.now()
      };
      rooms.set(code, room);
      return json(res, 200, publicRoom(room, playerId));
    }

    if (req.method === "POST" && req.url === "/api/join-room") {
      const body = await readBody(req);
      const code = String(body.roomCode || "").trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) return json(res, 404, { ok: false, message: "找不到這個房間。" });
      const existing = body.playerId && room.players[body.playerId];
      const playerId = existing ? body.playerId : crypto.randomUUID();
      if (!existing && Object.keys(room.players).length >= 2) {
        return json(res, 409, { ok: false, message: "房間已滿。" });
      }
      if (!existing) room.players[playerId] = "black";
      room.updatedAt = Date.now();
      return json(res, 200, publicRoom(room, playerId));
    }

    if (req.method === "GET" && req.url.startsWith("/api/state")) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const code = String(url.searchParams.get("roomCode") || "").toUpperCase();
      const playerId = url.searchParams.get("playerId");
      const room = rooms.get(code);
      if (!room) return json(res, 404, { ok: false, message: "找不到這個房間。" });
      room.updatedAt = Date.now();
      return json(res, 200, publicRoom(room, playerId));
    }

    if (req.method === "POST" && req.url === "/api/action") {
      const body = await readBody(req);
      const code = String(body.roomCode || "").trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) return json(res, 404, { ok: false, message: "找不到這個房間。" });
      const result = applyAction(room, body.playerId, body.action || {});
      room.updatedAt = Date.now();
      return json(res, result.ok ? 200 : 400, { ...result, state: publicRoom(room, body.playerId) });
    }

    serveStatic(req, res);
  } catch (error) {
    json(res, 500, { ok: false, message: error.message });
  }
});

setInterval(() => {
  const cutoff = Date.now() - 1000 * 60 * 60 * 6;
  for (const [code, room] of rooms) {
    if (room.updatedAt < cutoff) rooms.delete(code);
  }
}, 1000 * 60 * 10).unref();

server.listen(PORT, () => {
  console.log(`Dark Chess Online running at http://localhost:${PORT}`);
});

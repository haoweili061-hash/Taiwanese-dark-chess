const menuScreen = document.getElementById("menuScreen");
const onlineScreen = document.getElementById("onlineScreen");
const gameScreen = document.getElementById("gameScreen");

const startLocalBtn = document.getElementById("startLocalBtn");
const onlineGameBtn = document.getElementById("onlineGameBtn");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const backFromOnlineBtn = document.getElementById("backFromOnlineBtn");
const roomCodeInput = document.getElementById("roomCodeInput");
const onlineStatus = document.getElementById("onlineStatus");

const drawLimitInput = document.getElementById("drawLimitInput");
const board = document.getElementById("board");
const statusText = document.getElementById("status");
const redInfo = document.getElementById("redInfo");
const blackInfo = document.getElementById("blackInfo");
const redCount = document.getElementById("redCount");
const blackCount = document.getElementById("blackCount");
const battleLog = document.getElementById("battleLog");
const roomBar = document.getElementById("roomBar");
const roomLabel = document.getElementById("roomLabel");
const copyRoomBtn = document.getElementById("copyRoomBtn");

const darkEatRule = document.getElementById("darkEatRule");
const comboRule = document.getElementById("comboRule");
const rookRule = document.getElementById("rookRule");
const cannonRule = document.getElementById("cannonRule");
const horseRule = document.getElementById("horseRule");

const surrenderBtn = document.getElementById("surrenderBtn");
const restartBtn = document.getElementById("restartBtn");
const backMenuBtn = document.getElementById("backMenuBtn");

const inventory = {
  red: { "帥": 1, "仕": 2, "相": 2, "俥": 2, "傌": 2, "炮": 2, "兵": 5 },
  black: { "將": 1, "士": 2, "象": 2, "車": 2, "馬": 2, "包": 2, "卒": 5 }
};

let mode = "offline";
let roomCode = "";
let playerId = "";
let playerSide = "";
let game = null;
let pollTimer = null;

function getRules() {
  return {
    darkEat: darkEatRule.checked,
    combo: comboRule.checked,
    rook: rookRule.checked,
    cannon: cannonRule.checked,
    horse: horseRule.checked,
    drawLimit: Number(drawLimitInput.value) || 25
  };
}

function show(screen) {
  menuScreen.classList.add("hidden");
  onlineScreen.classList.add("hidden");
  gameScreen.classList.add("hidden");
  screen.classList.remove("hidden");
}

function colorName(color) {
  return color === "red" ? "紅方" : "黑方";
}

function turnName() {
  return colorName(game.currentTurn);
}

function setOnlineStatus(text) {
  onlineStatus.textContent = text || "";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "連線失敗");
  return data;
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(refreshOnlineState, 700);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function refreshOnlineState() {
  if (mode !== "online" || !roomCode || !playerId) return;
  try {
    const state = await api(`/api/state?roomCode=${encodeURIComponent(roomCode)}&playerId=${encodeURIComponent(playerId)}`);
    applyServerState(state);
  } catch (error) {
    statusText.textContent = error.message;
  }
}

function applyServerState(state) {
  roomCode = state.roomCode;
  playerId = state.playerId;
  playerSide = state.side;
  game = state.game;
  renderBoard(state.ready);
}

async function sendAction(action) {
  if (mode === "offline") {
    applyLocalAction(action);
    return;
  }

  try {
    const result = await api("/api/action", {
      method: "POST",
      body: { roomCode, playerId, action }
    });
    applyServerState(result.state);
  } catch (error) {
    statusText.textContent = error.message;
  }
}

function createLocalGame() {
  const pieces = [
    ["帥", "red"], ["仕", "red"], ["仕", "red"], ["相", "red"], ["相", "red"],
    ["俥", "red"], ["俥", "red"], ["傌", "red"], ["傌", "red"], ["炮", "red"], ["炮", "red"],
    ["兵", "red"], ["兵", "red"], ["兵", "red"], ["兵", "red"], ["兵", "red"],
    ["將", "black"], ["士", "black"], ["士", "black"], ["象", "black"], ["象", "black"],
    ["車", "black"], ["車", "black"], ["馬", "black"], ["馬", "black"], ["包", "black"], ["包", "black"],
    ["卒", "black"], ["卒", "black"], ["卒", "black"], ["卒", "black"], ["卒", "black"]
  ];
  return {
    pieces: pieces.sort(() => Math.random() - 0.5).map(([name, color]) => ({ name, color, flipped: false })),
    currentTurn: "red",
    selectedIndex: null,
    comboMode: false,
    logs: ["新局開始。"],
    ghostMarks: {},
    turnCount: 1,
    noCaptureTurns: 0,
    gameOver: false,
    winner: null,
    rules: getRules()
  };
}

function addLog(text) {
  game.logs.unshift(text);
  if (game.logs.length > 18) game.logs.pop();
}

function switchTurn() {
  game.currentTurn = game.currentTurn === "red" ? "black" : "red";
  game.selectedIndex = null;
  game.comboMode = false;
  game.turnCount += 1;
}

function endGame(message, winner = null) {
  game.gameOver = true;
  game.winner = winner;
  game.selectedIndex = null;
  game.comboMode = false;
  addLog(message);
}

function addNoCaptureTurn() {
  game.noCaptureTurns += 1;
  if (game.noCaptureTurns >= game.rules.drawLimit) {
    endGame(`${game.rules.drawLimit} 回合沒有吃子，平局。`);
  }
}

function checkWinByElimination() {
  const redAlive = game.pieces.some(piece => piece && piece.color === "red");
  const blackAlive = game.pieces.some(piece => piece && piece.color === "black");
  if (!redAlive) endGame("紅方沒有棋子了，黑方獲勝。", "black");
  if (!blackAlive) endGame("黑方沒有棋子了，紅方獲勝。", "red");
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
  const ranks = { "帥": 7, "將": 7, "仕": 6, "士": 6, "相": 5, "象": 5, "俥": 4, "車": 4, "傌": 3, "馬": 3, "炮": 2, "包": 2, "兵": 1, "卒": 1 };
  const attackerIsSoldier = attacker.name === "兵" || attacker.name === "卒";
  const defenderIsKing = defender.name === "帥" || defender.name === "將";
  const attackerIsKing = attacker.name === "帥" || attacker.name === "將";
  const defenderIsSoldier = defender.name === "兵" || defender.name === "卒";
  if (attackerIsSoldier && defenderIsKing) return true;
  if (attackerIsKing && defenderIsSoldier) return false;
  return ranks[attacker.name] >= ranks[defender.name];
}

function canEat(attacker, defender, fromIndex, toIndex) {
  if (!attacker || !defender || attacker.color === defender.color) return false;
  if (isRook(attacker) && game.rules.rook && isSameLine(fromIndex, toIndex)) {
    const between = getBetweenIndexes(fromIndex, toIndex);
    return between.length >= 1 && between.every(index => game.pieces[index] === null);
  }
  if (isCannon(attacker) && game.rules.cannon && isSameLine(fromIndex, toIndex)) {
    const blockers = getBetweenIndexes(fromIndex, toIndex).filter(index => game.pieces[index] !== null);
    return blockers.length === 1;
  }
  if (isHorse(attacker) && game.rules.horse) return isDiagonalOneStep(fromIndex, toIndex);
  return isNextTo(fromIndex, toIndex) && canNormalEat(attacker, defender);
}

function canAttemptEat(attacker, defender, fromIndex, toIndex) {
  if (!attacker || !defender) return false;
  if (defender.flipped && attacker.color === defender.color) return false;
  if (isNextTo(fromIndex, toIndex)) return true;
  if (isRook(attacker) && game.rules.rook && isSameLine(fromIndex, toIndex)) {
    const between = getBetweenIndexes(fromIndex, toIndex);
    return between.length >= 1 && between.every(index => game.pieces[index] === null);
  }
  if (isCannon(attacker) && game.rules.cannon && isSameLine(fromIndex, toIndex)) {
    const blockers = getBetweenIndexes(fromIndex, toIndex).filter(index => game.pieces[index] !== null);
    return blockers.length === 1;
  }
  if (isHorse(attacker) && game.rules.horse) return isDiagonalOneStep(fromIndex, toIndex);
  return isNextTo(fromIndex, toIndex);
}

function applyLocalAction(action) {
  if (action.type === "restart") {
    game = createLocalGame();
    renderBoard(true);
    return;
  }

  if (game.gameOver) return;

  if (action.type === "surrender") {
    const loser = game.currentTurn;
    const winner = loser === "red" ? "black" : "red";
    endGame(`${colorName(loser)}投降，${colorName(winner)}獲勝。`, winner);
    renderBoard(true);
    return;
  }

  if (action.type === "select") {
    handleLocalClick(Number(action.index));
    renderBoard(true);
  }
}

function handleLocalClick(index) {
  const target = game.pieces[index];
  if (game.selectedIndex === null) {
    if (target && !target.flipped) {
      target.flipped = true;
      addLog(`${turnName()}翻開 ${target.name}`);
      addNoCaptureTurn();
      if (!game.gameOver) switchTurn();
      return;
    }
    if (target && target.flipped && target.color === game.currentTurn) game.selectedIndex = index;
    return;
  }

  if (index === game.selectedIndex) {
    if (game.comboMode) {
      addNoCaptureTurn();
      if (!game.gameOver) switchTurn();
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
      addLog(`${turnName()}移動 ${attacker.name}`);
      addNoCaptureTurn();
      if (!game.gameOver) switchTurn();
    } else {
      addLog("這一步不能移動。");
    }
    return;
  }

  if (game.comboMode && !canAttemptEat(attacker, target, game.selectedIndex, index)) {
    addLog("連吃中只能點選這顆棋可攻擊的位置。");
    return;
  }

  if (!target.flipped && !game.rules.darkEat) {
    target.flipped = true;
    addLog(`${turnName()}翻開 ${target.name}`);
    addNoCaptureTurn();
    if (!game.gameOver) switchTurn();
    return;
  }

  tryLocalEat(game.selectedIndex, index);
}

function tryLocalEat(fromIndex, toIndex) {
  const attacker = game.pieces[fromIndex];
  const defender = game.pieces[toIndex];
  if (!attacker || !defender) return;

  const wasHidden = !defender.flipped;
  if (canEat(attacker, defender, fromIndex, toIndex)) {
    game.noCaptureTurns = 0;
    if (wasHidden) game.ghostMarks[toIndex] = { name: defender.name, color: defender.color, eatenBy: attacker.name };
    game.pieces[toIndex] = attacker;
    game.pieces[fromIndex] = null;
    addLog(wasHidden
      ? `${turnName()}暗吃成功：${attacker.name} 吃掉 ${colorName(defender.color)}${defender.name}`
      : `${turnName()}吃掉 ${colorName(defender.color)}${defender.name}`);
    checkWinByElimination();
    if (!game.gameOver) {
      if (game.rules.combo) {
        game.selectedIndex = toIndex;
        game.comboMode = true;
      } else {
        switchTurn();
      }
    }
    return;
  }

  if (wasHidden) {
    defender.flipped = true;
    addLog(`${turnName()}暗吃失敗，翻出 ${colorName(defender.color)}${defender.name}`);
    addNoCaptureTurn();
    if (!game.gameOver) switchTurn();
  } else {
    addLog(`不能吃：${attacker.name} 吃不了 ${defender.name}`);
    game.selectedIndex = fromIndex;
  }
}

function canCurrentUserAct(ready) {
  if (!ready || !game || game.gameOver) return false;
  if (mode === "offline") return true;
  return playerSide === game.currentTurn;
}

function renderBoard(ready = true) {
  if (!game) return;
  board.innerHTML = "";

  roomBar.classList.toggle("hidden", mode !== "online");
  if (mode === "online") {
    roomLabel.textContent = `房號 ${roomCode}｜你是${colorName(playerSide)}${ready ? "" : "｜等待對手"}`;
  }

  if (!ready) {
    statusText.textContent = "等待第二位玩家加入。";
  } else if (game.gameOver) {
    statusText.textContent = game.winner ? `遊戲結束：${colorName(game.winner)}獲勝` : "遊戲結束：平局";
  } else if (mode === "online") {
    statusText.textContent = game.comboMode
      ? `第 ${game.turnCount} 回合，${turnName()}連吃中${playerSide === game.currentTurn ? "，輪到你" : "，等待對手"}`
      : `第 ${game.turnCount} 回合，輪到${turnName()}${playerSide === game.currentTurn ? "，輪到你" : "，等待對手"}`;
  } else {
    statusText.textContent = game.comboMode
      ? `第 ${game.turnCount} 回合，${turnName()}連吃中`
      : `第 ${game.turnCount} 回合，輪到${turnName()}`;
  }

  if (!game.gameOver && game.noCaptureTurns >= 5) {
    statusText.textContent += `｜無吃子 ${game.noCaptureTurns}/${game.rules.drawLimit}`;
  }

  const disabled = !canCurrentUserAct(ready);
  game.pieces.forEach((piece, index) => {
    const cell = document.createElement("div");
    cell.className = "cell";
    if (disabled) cell.classList.add("disabled");
    if (game.selectedIndex === index) cell.classList.add("selected");

    const ghostMark = game.ghostMarks[index];
    if (ghostMark) {
      const ghost = document.createElement("div");
      ghost.className = `ghost-mark ghost-${ghostMark.color}`;
      ghost.textContent = ghostMark.name;
      cell.appendChild(ghost);

      const stomp = document.createElement("div");
      stomp.className = "stomp-label";
      stomp.textContent = `by ${ghostMark.eatenBy}`;
      cell.appendChild(stomp);
    }

    if (piece) {
      const pieceDiv = document.createElement("div");
      pieceDiv.className = "piece";
      if (piece.flipped) {
        pieceDiv.textContent = piece.name;
        pieceDiv.classList.add(piece.color);
      } else {
        pieceDiv.textContent = "?";
      }
      cell.appendChild(pieceDiv);
    }

    cell.addEventListener("click", () => {
      if (!disabled) sendAction({ type: "select", index });
    });
    board.appendChild(cell);
  });

  renderPieceInfo();
  renderLog();
}

function renderPieceInfo() {
  redInfo.innerHTML = "";
  blackInfo.innerHTML = "";

  const redAlive = game.pieces.filter(piece => piece && piece.color === "red").length;
  const blackAlive = game.pieces.filter(piece => piece && piece.color === "black").length;

  redCount.className = "count-box";
  blackCount.className = "count-box";
  redCount.textContent = `剩餘：${redAlive}`;
  blackCount.textContent = `剩餘：${blackAlive}`;

  renderSideInfo("red", redInfo);
  renderSideInfo("black", blackInfo);
}

function renderSideInfo(color, container) {
  Object.entries(inventory[color]).forEach(([pieceName, total]) => {
    const row = document.createElement("div");
    row.className = "piece-row";

    const title = document.createElement("strong");
    title.textContent = pieceName;
    row.appendChild(title);
    row.append(" ");

    let hidden = 0;
    let alive = 0;
    let dead = total;

    game.pieces.forEach(piece => {
      if (piece && piece.name === pieceName && piece.color === color) {
        dead -= 1;
        if (piece.flipped) alive += 1;
        else hidden += 1;
      }
    });

    appendStates(row, hidden, "?", "hidden-state");
    appendStates(row, alive, "●", "alive-state");
    appendStates(row, dead, "×", "dead-state");
    container.appendChild(row);
  });
}

function appendStates(row, count, text, className) {
  for (let i = 0; i < count; i++) {
    const span = document.createElement("span");
    span.className = `state ${className}`;
    span.textContent = text;
    row.appendChild(span);
  }
}

function renderLog() {
  battleLog.innerHTML = "";
  game.logs.forEach(log => {
    const div = document.createElement("div");
    div.className = "log-item";
    div.textContent = log;
    battleLog.appendChild(div);
  });
}

startLocalBtn.addEventListener("click", () => {
  mode = "offline";
  stopPolling();
  game = createLocalGame();
  show(gameScreen);
  renderBoard(true);
});

onlineGameBtn.addEventListener("click", () => {
  show(onlineScreen);
  setOnlineStatus("");
});

createRoomBtn.addEventListener("click", async () => {
  try {
    setOnlineStatus("建立房間中...");
    const state = await api("/api/create-room", { method: "POST", body: { rules: getRules() } });
    mode = "online";
    applyServerState(state);
    show(gameScreen);
    startPolling();
  } catch (error) {
    setOnlineStatus(error.message);
  }
});

joinRoomBtn.addEventListener("click", async () => {
  try {
    setOnlineStatus("加入房間中...");
    const state = await api("/api/join-room", {
      method: "POST",
      body: { roomCode: roomCodeInput.value.trim().toUpperCase(), playerId }
    });
    mode = "online";
    applyServerState(state);
    show(gameScreen);
    startPolling();
  } catch (error) {
    setOnlineStatus(error.message);
  }
});

backFromOnlineBtn.addEventListener("click", () => show(menuScreen));

surrenderBtn.addEventListener("click", () => sendAction({ type: "surrender" }));
restartBtn.addEventListener("click", () => sendAction({ type: "restart" }));
backMenuBtn.addEventListener("click", () => {
  stopPolling();
  mode = "offline";
  roomCode = "";
  playerId = "";
  playerSide = "";
  show(menuScreen);
});

copyRoomBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(roomCode);
    roomLabel.textContent = `房號 ${roomCode} 已複製｜你是${colorName(playerSide)}`;
  } catch {
    roomLabel.textContent = `房號 ${roomCode}｜請手動複製`;
  }
});

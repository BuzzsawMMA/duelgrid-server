const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

const gridSize = 8;
const baseCharacters = [
  { name: 'Knight', hp: 100, atk: 30, moveRange: 2, sprite: '/sprites/knight - Copy.PNG' },
  { name: 'Archer', hp: 80, atk: 25, moveRange: 3, sprite: '/sprites/archer (2).PNG' },
  { name: 'Mage', hp: 70, atk: 40, moveRange: 2, sprite: '/sprites/Mage - Copy.PNG' },
  { name: 'Healer', hp: 90, atk: 10, moveRange: 2, sprite: '/sprites/healer - COpy.PNG' },
  { name: 'Warrior', hp: 110, atk: 35, moveRange: 1, sprite: '/sprites/warrior - Copy.PNG' },
  { name: 'Rogue', hp: 75, atk: 30, moveRange: 4, sprite: '/sprites/rogue - Copy.PNG' },
  { name: 'Summoner', hp: 65, atk: 45, moveRange: 2, sprite: '/sprites/summoner - Copy.PNG' },
  { name: 'Paladin', hp: 95, atk: 20, moveRange: 1, sprite: '/sprites/paladin - Copy.PNG' },
];

let idCounter = 1;
const generateTeam = (team, row) =>
  baseCharacters.map((c, i) => ({
    ...c,
    id: idCounter++,
    x: i,
    y: row,
    team,
    movesLeft: c.moveRange,
    hasAttacked: false,
  }));

// All active rooms: roomId -> { gameState, players (socketId->team), waitingTeam }
const rooms = {};
let roomCounter = 1;

// Helper to find a room waiting for 2nd player or create a new one
function findOrCreateRoom() {
  for (const roomId in rooms) {
    if (Object.keys(rooms[roomId].players).length === 1) {
      return roomId;
    }
  }
  // Create new room
  const newRoomId = `room-${roomCounter++}`;
  rooms[newRoomId] = {
    gameState: {
      characters: [...generateTeam('A', 0), ...generateTeam('B', gridSize - 1)],
      turn: 'A',
      winner: null,
    },
    players: {},
    waitingTeam: 'A',
  };
  return newRoomId;
}

// Helper: check if two positions are adjacent (manhattan distance = 1)
const areAdjacent = (a, b) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

// Validation and update function scoped per room
function validateAndUpdateGameRoom(room, newState, playerTeam) {
  if (!newState || !newState.characters || !newState.turn) return false;

  if (playerTeam !== room.gameState.turn) return false;

  const oldChars = room.gameState.characters;
  const newChars = newState.characters;

  for (let newChar of newChars) {
    const oldChar = oldChars.find((c) => c.id === newChar.id);
    if (!oldChar) return false;

    if (newChar.team !== oldChar.team) return false;

    if (newChar.hp > oldChar.hp) return false;

    if (newChar.movesLeft > oldChar.movesLeft) return false;

    const distMoved = Math.abs(newChar.x - oldChar.x) + Math.abs(newChar.y - oldChar.y);
    if (distMoved > oldChar.movesLeft) return false;

    if (newChar.movesLeft !== oldChar.movesLeft - distMoved) return false;

    if (oldChar.hasAttacked && !newChar.hasAttacked) return false;
  }

  const positions = newChars.filter(c => c.hp > 0).map(c => `${c.x},${c.y}`);
  if (new Set(positions).size !== positions.length) return false;

  const attackers = newChars.filter((nc) => {
    const oc = oldChars.find(c => c.id === nc.id);
    return !oc.hasAttacked && nc.hasAttacked && nc.hp > 0;
  });

  for (const attacker of attackers) {
    const oldAttacker = oldChars.find(c => c.id === attacker.id);
    const adjacentEnemiesOld = oldChars.filter(c => c.team !== attacker.team && areAdjacent(c, oldAttacker) && c.hp > 0);
    const adjacentEnemiesNew = newChars.filter(c => c.team !== attacker.team && areAdjacent(c, attacker) && c.hp > 0);

    let attackedEnemyFound = false;
    for (const oldEnemy of adjacentEnemiesOld) {
      const newEnemy = newChars.find(c => c.id === oldEnemy.id);
      const hpDiff = oldEnemy.hp - newEnemy.hp;
      if (hpDiff === attacker.atk) {
        attackedEnemyFound = true;
        break;
      }
    }
    if (!attackedEnemyFound) return false;
  }

  const turnChanged = newState.turn !== room.gameState.turn;
  if (turnChanged) {
    if (newState.turn !== (room.gameState.turn === 'A' ? 'B' : 'A')) return false;

    for (const c of newState.characters) {
      if (c.team === newState.turn) {
        const baseChar = baseCharacters.find(bc => bc.name === c.name);
        if (!baseChar) return false;
        if (c.movesLeft !== baseChar.moveRange || c.hasAttacked !== false) return false;
      }
    }
  } else {
    for (const c of newState.characters) {
      const oldC = oldChars.find(oc => oc.id === c.id);
      if (!oldC) return false;
      if (c.team === room.gameState.turn) {
        if (c.movesLeft > oldC.movesLeft) return false;
        if (oldC.hasAttacked && !c.hasAttacked) return false;
      }
    }
  }

  const aliveA = newState.characters.some(c => c.team === 'A' && c.hp > 0);
  const aliveB = newState.characters.some(c => c.team === 'B' && c.hp > 0);
  let winner = null;
  if (!aliveA) winner = 'B';
  if (!aliveB) winner = 'A';

  room.gameState = {
    characters: newState.characters,
    turn: newState.turn,
    winner,
  };

  return true;
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  const roomId = findOrCreateRoom();
  socket.join(roomId);

  const room = rooms[roomId];

  // Assign team to player in this room
  const assignedTeam = room.waitingTeam;
  room.players[socket.id] = assignedTeam;
  room.waitingTeam = assignedTeam === 'A' ? 'B' : 'A';

  // Send assigned team and initial game state to player
  socket.emit('assignTeam', assignedTeam);
  socket.emit('gameState', room.gameState);

  // Notify others in room that player joined
  io.to(roomId).emit('playerJoined', { playerId: socket.id, team: assignedTeam });

  socket.on('updateGame', (newState) => {
    const playerTeam = room.players[socket.id];
    if (!playerTeam) return;

    const valid = validateAndUpdateGameRoom(room, newState, playerTeam);
    if (valid) {
      // Broadcast updated game state only to room
      io.to(roomId).emit('gameState', room.gameState);
    } else {
      socket.emit('errorMessage', 'Invalid game update.');
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    const playerTeam = room.players[socket.id];
    if (playerTeam) {
      // Opponent wins by surrender
      const opponentTeam = playerTeam === 'A' ? 'B' : 'A';

      room.gameState.winner = opponentTeam;

      // Broadcast game state with winner
      io.to(roomId).emit('gameState', room.gameState);
    }

    // Remove player from room
    delete room.players[socket.id];

    // Notify others in room player left
    io.to(roomId).emit('playerLeft', socket.id);

    // If room empty, delete it
    if (Object.keys(room.players).length === 0) {
      delete rooms[roomId];
      console.log(`Room ${roomId} deleted because empty`);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Socket.IO server running on port ${PORT}`);
});

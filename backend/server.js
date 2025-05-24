const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ['http://localhost:3000', 'https://duelgrid-frontend.onrender.com'],
  },
});

const GRID_SIZE = 8;

const BASE_CHARACTERS = [
  { name: 'Knight', hp: 100, atk: 30, moveRange: 2, sprite: '/sprites/knight.png' },
  { name: 'Archer', hp: 80, atk: 25, moveRange: 3, sprite: '/sprites/archer.png' },
  { name: 'Mage', hp: 70, atk: 40, moveRange: 2, sprite: '/sprites/mage.png' },
  { name: 'Healer', hp: 90, atk: 10, moveRange: 2, sprite: '/sprites/healer.png' },
  { name: 'Warrior', hp: 110, atk: 35, moveRange: 1, sprite: '/sprites/warrior.png' },
  { name: 'Rogue', hp: 75, atk: 30, moveRange: 4, sprite: '/sprites/rogue.png' },
  { name: 'Summoner', hp: 65, atk: 45, moveRange: 2, sprite: '/sprites/summoner.png' },
  { name: 'Paladin', hp: 95, atk: 20, moveRange: 1, sprite: '/sprites/paladin.png' },
];

let idCounter = 1;

const generateTeam = (team, row) =>
  BASE_CHARACTERS.map((char, index) => ({
    ...char,
    id: idCounter++,
    x: index,
    y: row,
    team,
    movesLeft: char.moveRange,
    hasAttacked: false,
    maxHp: char.hp,
  }));

const rooms = {};
let roomCounter = 1;

const waitingQueue = new Set();

const areAdjacent = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

function validateAndUpdateGameRoom(room, newState, playerTeam) {
  const prevState = room.gameState;

  if (!newState || !newState.characters) return false;

  // Ensure characters array length unchanged
  if (newState.characters.length !== prevState.characters.length) return false;

  // Check winner state is unchanged (only set by server)
  if (newState.winner !== prevState.winner) return false;

  // Validate all characters
  for (let i = 0; i < newState.characters.length; i++) {
    const prevChar = prevState.characters[i];
    const newChar = newState.characters[i];

    if (prevChar.id !== newChar.id) return false;
    if (prevChar.team !== newChar.team) return false;

    // HP can't increase beyond maxHp or go below 0
    if (newChar.hp > newChar.maxHp || newChar.hp < 0) return false;

    // x and y must be within grid bounds
    if (newChar.x < 0 || newChar.x >= GRID_SIZE || newChar.y < 0 || newChar.y >= GRID_SIZE) return false;

    // movesLeft cannot exceed moveRange
    if (newChar.movesLeft > newChar.moveRange) return false;

    // Validate no illegal move: no teleporting more than movesLeft
    const dist = Math.abs(newChar.x - prevChar.x) + Math.abs(newChar.y - prevChar.y);
    if (dist > prevChar.movesLeft) return false;

    // Prevent changing hp of other team characters directly
    if (newChar.team !== playerTeam) {
      if (newChar.hp !== prevChar.hp) return false;
    }

    // Validate hasAttacked flag logic (cannot reset from true to false mid-turn)
    if (prevChar.hasAttacked && !newChar.hasAttacked) return false;
  }

  // Ensure only current player's characters moved or attacked
  for (let i = 0; i < newState.characters.length; i++) {
    const prevChar = prevState.characters[i];
    const newChar = newState.characters[i];
    if (prevChar.team !== playerTeam) {
      // No movement or attack state change allowed for opponent chars
      if (prevChar.x !== newChar.x || prevChar.y !== newChar.y) return false;
      if (prevChar.hasAttacked !== newChar.hasAttacked) return false;
      if (prevChar.movesLeft !== newChar.movesLeft) return false;
    }
  }

  // Validate attacks: at most one opponent's HP reduced by atk value of player's character adjacent to it
  let attackCount = 0;
  for (let i = 0; i < newState.characters.length; i++) {
    const prevChar = prevState.characters[i];
    const newChar = newState.characters[i];
    if (prevChar.hp > newChar.hp) {
      // HP decreased - check it matches an attack from player's character adjacent to this one
      const damage = prevChar.hp - newChar.hp;

      // Damage must be positive
      if (damage <= 0) return false;

      // Find player's character that attacked and verify adjacency and hasAttacked flag
      const attacker = newState.characters.find((c) =>
        c.team === playerTeam &&
        c.hasAttacked &&
        areAdjacent(c, newChar) &&
        c.movesLeft === prevState.characters.find(pc => pc.id === c.id).movesLeft &&
        c.hp === prevState.characters.find(pc => pc.id === c.id).hp &&
        damage === c.atk
      );
      if (!attacker) return false;

      attackCount++;
    }
  }
  if (attackCount > 1) return false; // only one attack allowed per turn

  // Validate turn toggle
  if (newState.turn !== prevState.turn) {
    // Only allow turn to switch if all player's characters have 0 movesLeft and hasAttacked true/false states respected
    if (newState.turn === playerTeam) return false; // player can't switch to their own turn again

    const playerChars = newState.characters.filter(c => c.team === playerTeam);
    if (!playerChars.every(c => c.movesLeft === 0)) return false;
  } else {
    // Turn must not change during player's turn
    if (newState.turn !== prevState.turn) return false;
  }

  // All validations passed, update the room state
  room.gameState = newState;
  return true;
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('joinGame', () => {
    console.log(`joinGame received from ${socket.id}`);

    if (waitingQueue.has(socket.id)) {
      console.log(`Socket ${socket.id} already in waiting queue`);
      socket.emit('waitingForOpponent');
      return;
    }

    if (waitingQueue.size > 0) {
      const waitingPlayerId = waitingQueue.values().next().value;
      waitingQueue.delete(waitingPlayerId);

      const waitingSocket = io.sockets.sockets.get(waitingPlayerId);
      if (!waitingSocket) {
        console.log(`Waiting socket ${waitingPlayerId} not found in sockets map`);
        // Add current socket to waitingQueue instead and inform them
        waitingQueue.add(socket.id);
        socket.emit('waitingForOpponent');
        return;
      }

      const roomId = `room${roomCounter++}`;
      rooms[roomId] = {
        players: {
          [waitingPlayerId]: 'A',
          [socket.id]: 'B',
        },
        gameState: {
          characters: [...generateTeam('A', 0), ...generateTeam('B', GRID_SIZE - 1)],
          turn: 'A',
          winner: null,
        },
      };

      waitingSocket.join(roomId);
      socket.join(roomId);

      // Assign teams explicitly
      waitingSocket.emit('assignTeam', 'A');
      socket.emit('assignTeam', 'B');

      io.to(roomId).emit('gameStart', { roomId, gameState: rooms[roomId].gameState });

      console.log(`Game started in room ${roomId} between ${waitingPlayerId}(A) and ${socket.id}(B)`);

    } else {
      waitingQueue.add(socket.id);
      socket.emit('waitingForOpponent');
      console.log(`Socket ${socket.id} added to waiting queue`);
    }
  });

  socket.on('endTurn', () => {
    const playerRoomId = Object.keys(rooms).find(roomId => rooms[roomId].players[socket.id]);
    if (!playerRoomId) {
      console.log(`endTurn: no room found for socket ${socket.id}`);
      return;
    }

    const room = rooms[playerRoomId];
    const playerTeam = room.players[socket.id];

    if (room.gameState.turn !== playerTeam) {
      console.log(`endTurn: it's not player ${playerTeam}'s turn`);
      return;
    }

    room.gameState.turn = playerTeam === 'A' ? 'B' : 'A';
    room.gameState.characters = room.gameState.characters.map((char) =>
      char.team === room.gameState.turn
        ? { ...char, movesLeft: char.moveRange, hasAttacked: false }
        : char
    );

    io.to(playerRoomId).emit('turnEnded', { gameState: room.gameState });
    console.log(`Turn ended in room ${playerRoomId}, now it's team ${room.gameState.turn}'s turn`);
  });

  socket.on('updateGameState', (newState) => {
    const playerRoomId = Object.keys(rooms).find(roomId => rooms[roomId].players[socket.id]);
    if (!playerRoomId) {
      console.log(`updateGameState: no room found for socket ${socket.id}`);
      return;
    }

    const room = rooms[playerRoomId];
    const playerTeam = room.players[socket.id];

    if (room.gameState.turn !== playerTeam) {
      console.log(`updateGameState: not player ${playerTeam}'s turn`);
      return;
    }

    const valid = validateAndUpdateGameRoom(room, newState, playerTeam);
    if (!valid) {
      console.log('Invalid game state update attempt');
      return;
    }

    io.to(playerRoomId).emit('gameStateUpdated', { gameState: room.gameState });
    console.log(`Game state updated in room ${playerRoomId} by player ${playerTeam}`);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    if (waitingQueue.has(socket.id)) {
      waitingQueue.delete(socket.id);
      console.log(`Socket ${socket.id} removed from waiting queue on disconnect`);
    }

    const playerRoomId = Object.keys(rooms).find(roomId => rooms[roomId].players[socket.id]);
    if (playerRoomId) {
      const room = rooms[playerRoomId];
      delete room.players[socket.id];
      io.to(playerRoomId).emit('playerLeft', { playerId: socket.id });

      if (Object.keys(room.players).length === 0) {
        delete rooms[playerRoomId];
        console.log(`Room ${playerRoomId} deleted as empty`);
      }
    }
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});

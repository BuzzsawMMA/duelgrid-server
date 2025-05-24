const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: ['http://localhost:3000', 'https://duelgrid-frontend.onrender.com'] },
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
  }));

const rooms = {};
let roomCounter = 1;
const waitingQueue = [];

// Helper function to check adjacency
const areAdjacent = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

// Function: validateAndUpdateGameRoom
function validateAndUpdateGameRoom(room, newState, playerTeam) {
  if (!newState || !newState.characters || !newState.turn) {
    console.log('Validation failed: newState or required fields missing');
    return false;
  }
  if (playerTeam !== room.gameState.turn) {
    console.log(`Validation failed: Not player ${playerTeam}'s turn, current turn is ${room.gameState.turn}`);
    return false;
  }

  const oldChars = room.gameState.characters;
  const newChars = newState.characters;

  // Check characters one by one
  for (const newChar of newChars) {
    const oldChar = oldChars.find(c => c.id === newChar.id);
    if (!oldChar) {
      console.log(`Validation failed: Character ID ${newChar.id} not found`);
      return false;
    }
    if (newChar.team !== oldChar.team) {
      console.log('Validation failed: Character team mismatch');
      return false;
    }
    if (newChar.hp > oldChar.hp) {
      if (newChar.hp > oldChar.maxHp) {
        console.log('Validation failed: hp exceeds maxHp');
        return false;
      }
    }
    if (newChar.movesLeft > oldChar.movesLeft) {
      console.log('Validation failed: movesLeft increased');
      return false;
    }

    const distMoved = Math.abs(newChar.x - oldChar.x) + Math.abs(newChar.y - oldChar.y);
    if (distMoved > oldChar.movesLeft) {
      console.log('Validation failed: Character moved too far');
      return false;
    }
    if (newChar.movesLeft !== oldChar.movesLeft - distMoved) {
      console.log('Validation failed: movesLeft not decreased correctly');
      return false;
    }
    if (oldChar.hasAttacked && !newChar.hasAttacked) {
      console.log('Validation failed: Attack status reverted');
      return false;
    }
  }

  // Check positions are unique (no overlap)
  const alivePositions = newChars.filter(c => c.hp > 0).map(c => `${c.x},${c.y}`);
  if (new Set(alivePositions).size !== alivePositions.length) {
    console.log('Validation failed: Two characters occupy the same position');
    return false;
  }

  // Validate attacks
  const attackers = newChars.filter(nc => {
    const oc = oldChars.find(c => c.id === nc.id);
    return !oc.hasAttacked && nc.hasAttacked && nc.hp > 0;
  });

  for (const attacker of attackers) {
    const oldAttacker = oldChars.find(c => c.id === attacker.id);
    const adjacentEnemiesOld = oldChars.filter(c => c.team !== attacker.team && areAdjacent(c, oldAttacker) && c.hp > 0);
    const adjacentEnemiesNew = newChars.filter(c => c.team !== attacker.team && areAdjacent(c, attacker) && c.hp > 0);

    let validAttackFound = false;
    for (const oldEnemy of adjacentEnemiesOld) {
      const newEnemy = newChars.find(c => c.id === oldEnemy.id);

      // If the enemy was removed from newChars (i.e., killed)
      if (!newEnemy) {
        if (oldEnemy.hp <= attacker.atk) {
          validAttackFound = true;
          break;
        } else {
          continue;
        }
      }

      const hpDiff = oldEnemy.hp - newEnemy.hp;
      if (hpDiff === attacker.atk || (oldEnemy.hp > 0 && newEnemy.hp <= 0 && oldEnemy.hp <= attacker.atk)) {
        validAttackFound = true;
        break;
      }
    }

    if (!validAttackFound) {
      console.log('Validation failed: No valid enemy attacked');
      return false;
    }
  }

  // Validate turn changes
  const turnChanged = newState.turn !== room.gameState.turn;
  if (turnChanged) {
    if (newState.turn !== (room.gameState.turn === 'A' ? 'B' : 'A')) {
      console.log('Validation failed: Turn changed incorrectly');
      return false;
    }

    for (const c of newState.characters) {
      const oldC = oldChars.find(oc => oc.id === c.id);
      if (!oldC) {
        console.log('Validation failed: Character missing during turn change');
        return false;
      }

      if (c.team === newState.turn) {
        const baseChar = BASE_CHARACTERS.find(bc => bc.name === c.name);
        if (!baseChar) {
          console.log('Validation failed: Base character not found');
          return false;
        }
        if (c.movesLeft !== baseChar.moveRange || c.hasAttacked !== false) {
          console.log('Validation failed: New turn characters not reset properly');
          return false;
        }
      } else {
        if (c.movesLeft > oldC.movesLeft) {
          console.log('Validation failed: Old team movesLeft increased');
          return false;
        }
        if (oldC.hasAttacked && !c.hasAttacked) {
          console.log('Validation failed: Old team attack status reverted');
          return false;
        }
      }
    }
  } else {
    // No turn change: ensure no state regression mid-turn
    for (const c of newState.characters) {
      const oldC = oldChars.find(oc => oc.id === c.id);
      if (!oldC) {
        console.log('Validation failed: Character missing');
        return false;
      }
      if (c.team === room.gameState.turn) {
        if (c.movesLeft > oldC.movesLeft) {
          console.log('Validation failed: movesLeft increased mid-turn');
          return false;
        }
        if (oldC.hasAttacked && !c.hasAttacked) {
          console.log('Validation failed: Attack status reverted mid-turn');
          return false;
        }
      }
    }
  }

  // Determine if there's a winner
  const aliveA = newState.characters.some(c => c.team === 'A' && c.hp > 0);
  const aliveB = newState.characters.some(c => c.team === 'B' && c.hp > 0);
  let winner = null;
  if (!aliveA) winner = 'B';
  if (!aliveB) winner = 'A';

  // Update gameState preserving winner if already set
  const currentWinner = room.gameState.winner || winner;

  room.gameState = {
    characters: newState.characters.map(c => ({ ...c })),
    turn: newState.turn,
    winner: currentWinner,
  };

  console.log(`Validation succeeded for player ${playerTeam}`);
  return true;
}  // <-- validateAndUpdateGameRoom ends here


// SOCKET.IO CONNECTION HANDLER

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('endTurn', () => {
    const playerRoomId = Object.keys(rooms).find(roomId => rooms[roomId].players[socket.id]);
    if (!playerRoomId) {
      console.log(`endTurn: No room found for socket ${socket.id}`);
      return;
    }

    const room = rooms[playerRoomId];
    const playerTeam = room.players[socket.id];

    if (room.gameState.turn !== playerTeam) {
      console.log('endTurn: Not your turn');
      return;
    }

    const newTurn = playerTeam === 'A' ? 'B' : 'A';

    for (const c of room.gameState.characters) {
      if (c.team === newTurn) {
        const baseChar = BASE_CHARACTERS.find(bc => bc.name === c.name);
        c.movesLeft = baseChar.moveRange;
        c.hasAttacked = false;
      }
    }

    room.gameState.turn = newTurn;
    io.to(playerRoomId).emit('updateGameState', room.gameState);
    console.log(`Turn ended by player ${playerTeam} in room ${playerRoomId}`);
  });

  socket.on('joinGame', () => {
    if (waitingQueue.length > 0) {
      const waitingSocket = waitingQueue.shift();
      const roomId = `room${roomCounter++}`;

      rooms[roomId] = {
        players: {
          [waitingSocket]: 'A',
          [socket.id]: 'B',
        },
        gameState: {
          characters: [...generateTeam('A', 0), ...generateTeam('B', GRID_SIZE - 1)],
          turn: 'A',
          winner: null,
        },
      };

      [waitingSocket, socket.id].forEach(sockId => {
        io.sockets.sockets.get(sockId).join(roomId);
      });

      io.to(roomId).emit('gameStart', { roomId, gameState: rooms[roomId].gameState });
      console.log(`Game started between ${waitingSocket} (A) and ${socket.id} (B) in ${roomId}`);
    } else {
      waitingQueue.push(socket.id);
      socket.emit('waitingForOpponent');
      console.log(`Socket ${socket.id} added to waiting queue`);
    }
  });

  socket.on('updateGameState', (newState) => {
    const playerRoomId = Object.keys(rooms).find(roomId => rooms[roomId].players[socket.id]);
    if (!playerRoomId) {
      console.log(`updateGameState: No room found for socket ${socket.id}`);
      return;
    }

    const room = rooms[playerRoomId];
    const playerTeam = room.players[socket.id];

    const isValid = validateAndUpdateGameRoom(room, newState, playerTeam);
    if (isValid) {
      io.to(playerRoomId).emit('updateGameState', room.gameState);
    } else {
      socket.emit('invalidUpdate', 'Your game update was invalid.');
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    const playerRoomId = Object.keys(rooms).find(roomId => rooms[roomId].players[socket.id]);
    if (playerRoomId) {
      const room = rooms[playerRoomId];
      delete room.players[socket.id];

      if (Object.keys(room.players).length === 0) {
        delete rooms[playerRoomId];
        console.log(`Room ${playerRoomId} deleted because no players remain`);
      } else {
        io.to(playerRoomId).emit('playerLeft', socket.id);
        console.log(`Player ${socket.id} left room ${playerRoomId}`);
      }
    } else {
      // Remove from waiting queue if waiting
      const idx = waitingQueue.indexOf(socket.id);
      if (idx !== -1) waitingQueue.splice(idx, 1);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

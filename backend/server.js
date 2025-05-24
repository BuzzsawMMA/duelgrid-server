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

// validateAndUpdateGameRoom function as you provided (unchanged)...

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

  const alivePositions = newChars.filter(c => c.hp > 0).map(c => `${c.x},${c.y}`);
  if (new Set(alivePositions).size !== alivePositions.length) {
    console.log('Validation failed: Two characters occupy the same position');
    return false;
  }

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

  const aliveA = newState.characters.some(c => c.team === 'A' && c.hp > 0);
  const aliveB = newState.characters.some(c => c.team === 'B' && c.hp > 0);
  let winner = null;
  if (!aliveA) winner = 'B';
  if (!aliveB) winner = 'A';

  const currentWinner = room.gameState.winner || winner;

  room.gameState = {
    characters: newState.characters.map(c => ({ ...c })),
    turn: newState.turn,
    winner: currentWinner,
  };

  console.log(`Validation succeeded for player ${playerTeam}`);
  return true;
}

// --- SOCKET.IO CONNECTION HANDLER ---

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('joinGame', () => {
    console.log('Join game requested by', socket.id);

    if (waitingQueue.size > 0) {
      // Pair with waiting player
      const waitingPlayerId = [...waitingQueue][0];
      waitingQueue.delete(waitingPlayerId);

      const roomId = `room-${roomCounter++}`;
      const teamA = generateTeam('A', 0);
      const teamB = generateTeam('B', GRID_SIZE - 1);

      const initialGameState = {
        characters: [...teamA, ...teamB],
        turn: 'A',
        winner: null,
      };

      rooms[roomId] = {
        players: [waitingPlayerId, socket.id],
        gameState: initialGameState,
      };

      // Join both sockets to the room
      io.sockets.sockets.get(waitingPlayerId)?.join(roomId);
      socket.join(roomId);

      io.to(waitingPlayerId).emit('gameStart', { roomId, team: 'A', gameState: initialGameState });
      socket.emit('gameStart', { roomId, team: 'B', gameState: initialGameState });

      console.log(`Game started in ${roomId} between ${waitingPlayerId} (A) and ${socket.id} (B)`);
    } else {
      waitingQueue.add(socket.id);
      socket.emit('waitingForPlayer');
      console.log(`${socket.id} added to waiting queue`);
    }
  });

  socket.on('moveCharacter', ({ roomId, newState, playerTeam }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (!room.players.includes(socket.id)) return;

    if (validateAndUpdateGameRoom(room, newState, playerTeam)) {
      io.to(roomId).emit('gameUpdate', room.gameState);
    } else {
      socket.emit('invalidMove');
    }
  });

  // --- ADDING THE 'endTurn' EVENT HANDLER ---
  socket.on('endTurn', ({ roomId, playerTeam }) => {
    const room = rooms[roomId];
    if (!room) {
      console.log('endTurn: invalid roomId');
      return;
    }

    if (!room.players.includes(socket.id)) {
      console.log('endTurn: player not in room');
      return;
    }

    if (playerTeam !== room.gameState.turn) {
      console.log(`endTurn: it's not player ${playerTeam}'s turn`);
      socket.emit('notYourTurn');
      return;
    }

    if (room.gameState.winner) {
      console.log('endTurn: game already finished');
      return;
    }

    // Switch turn
    room.gameState.turn = playerTeam === 'A' ? 'B' : 'A';

    // Reset movesLeft and hasAttacked for alive characters of the new turn's team
    for (const c of room.gameState.characters) {
      if (c.team === room.gameState.turn && c.hp > 0) {
        const baseChar = BASE_CHARACTERS.find(bc => bc.name === c.name);
        if (baseChar) {
          c.movesLeft = baseChar.moveRange;
          c.hasAttacked = false;
        }
      }
    }

    io.to(roomId).emit('gameUpdate', room.gameState);
    console.log(`Turn ended in room ${roomId}, now it's team ${room.gameState.turn}'s turn`);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    // Remove from waiting queue if present
    waitingQueue.delete(socket.id);

    // Remove from any rooms
    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (room.players.includes(socket.id)) {
        io.to(roomId).emit('playerDisconnected');
        delete rooms[roomId];
        console.log(`Room ${roomId} deleted due to player disconnect`);
        break;
      }
    }
  });
});

server.listen(3001, () => {
  console.log('Server is running on port 3001');
});

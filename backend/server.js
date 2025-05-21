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

const gridSize = 8;
const baseCharacters = [
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
  baseCharacters.map((c, i) => ({
    ...c,
    id: idCounter++,
    x: i,
    y: row,
    team,
    movesLeft: c.moveRange,
    hasAttacked: false,
  }));

const rooms = {};
let roomCounter = 1;

const waitingQueue = [];

const areAdjacent = (a, b) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

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

  for (let newChar of newChars) {
    const oldChar = oldChars.find((c) => c.id === newChar.id);
    if (!oldChar) {
      console.log(`Validation failed: Character ID ${newChar.id} not found`);
      return false;
    }

    if (newChar.team !== oldChar.team) {
      console.log('Validation failed: Character team mismatch');
      return false;
    }
    if (newChar.hp > oldChar.hp) {
      console.log('Validation failed: HP increased');
      return false;
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

  // Check overlapping positions for alive characters
  const positions = newChars.filter(c => c.hp > 0).map(c => `${c.x},${c.y}`);
  if (new Set(positions).size !== positions.length) {
    console.log('Validation failed: Two characters occupy the same position');
    return false;
  }

  // Validate attacks
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
    if (!attackedEnemyFound) {
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
        const baseChar = baseCharacters.find(bc => bc.name === c.name);
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

  // Check for winner
  const aliveA = newState.characters.some(c => c.team === 'A' && c.hp > 0);
  const aliveB = newState.characters.some(c => c.team === 'B' && c.hp > 0);
  let winner = null;
  if (!aliveA) winner = 'B';
  if (!aliveB) winner = 'A';

  // Preserve existing winner if already set
  const currentWinner = room.gameState.winner;

  room.gameState = {
    ...newState,
    winner: currentWinner || winner,
  };

  console.log('Validation succeeded for player', playerTeam);
  return true;
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Add player to waiting queue
  waitingQueue.push(socket.id);
  console.log('Waiting queue:', waitingQueue);

  if (waitingQueue.length >= 2) {
    const playerA = waitingQueue.shift();
    const playerB = waitingQueue.shift();

    const newRoomId = `room-${roomCounter++}`;
    rooms[newRoomId] = {
      gameState: {
        characters: [...generateTeam('A', 0), ...generateTeam('B', gridSize - 1)],
        turn: 'A',
        winner: null,
      },
      players: {},
      waitingTeam: null,
    };

    const room = rooms[newRoomId];

    room.players[playerA] = 'A';
    room.players[playerB] = 'B';

    io.sockets.sockets.get(playerA)?.join(newRoomId);
    io.sockets.sockets.get(playerB)?.join(newRoomId);

    io.to(playerA).emit('assignTeam', 'A');
    io.to(playerB).emit('assignTeam', 'B');

    io.to(newRoomId).emit('gameState', room.gameState);
    io.to(newRoomId).emit('playerJoined', { playerId: playerA, team: 'A' });
    io.to(newRoomId).emit('playerJoined', { playerId: playerB, team: 'B' });

    console.log(`Room ${newRoomId} created with players ${playerA} (A) and ${playerB} (B)`);
  } else {
    socket.emit('waitingForOpponent');
  }

  socket.on('updateGame', (newState) => {
    const playerRoomId = Object.keys(rooms).find(roomId => rooms[roomId].players[socket.id]);
    if (!playerRoomId) {
      console.log(`updateGame: No room found for socket ${socket.id}`);
      return;
    }

    const room = rooms[playerRoomId];
    const playerTeam = room.players[socket.id];
    if (!playerTeam) {
      console.log(`updateGame: Player team not found for socket ${socket.id}`);
      return;
    }

    const valid = validateAndUpdateGameRoom(room, newState, playerTeam);

    console.log(`Player ${playerTeam} (${socket.id}) sent updateGame. Valid: ${valid}. New turn: ${newState.turn}`);

    if (valid) {
      io.to(playerRoomId).emit('gameState', room.gameState);
    } else {
      socket.emit('gameState', room.gameState); // revert to current valid state
    }
  });

  socket.on('endTurn', () => {
    const playerRoomId = Object.keys(rooms).find(roomId => rooms[roomId].players[socket.id]);
    if (!playerRoomId) {
      console.log(`endTurn: No room found for socket ${socket.id}`);
      return;
    }
    const room = rooms[playerRoomId];
    const playerTeam = room.players[socket.id];
    if (!playerTeam) {
      console.log(`endTurn: Player team not found for socket ${socket.id}`);
      return;
    }

    if (room.gameState.turn !== playerTeam) {
      console.log(`endTurn: Not player ${playerTeam}'s turn, ignoring`);
      return;
    }

    // Switch turn only if no winner
    if (!room.gameState.winner) {
      const nextTurn = playerTeam === 'A' ? 'B' : 'A';
      room.gameState.turn = nextTurn;

      // Reset movesLeft and hasAttacked for new turn characters
      room.gameState.characters = room.gameState.characters.map((c) => {
        if (c.team === nextTurn && c.hp > 0) {
          const baseChar = baseCharacters.find(bc => bc.name === c.name);
          return {
            ...c,
            movesLeft: baseChar.moveRange,
            hasAttacked: false,
          };
        }
        return c;
      });

      io.to(playerRoomId).emit('gameState', room.gameState);
      console.log(`Turn ended by player ${playerTeam}. Now turn: ${nextTurn}`);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    waitingQueue.splice(waitingQueue.indexOf(socket.id), 1);

    // Remove player from any room and notify other player
    const playerRoomId = Object.keys(rooms).find(roomId => rooms[roomId].players[socket.id]);
    if (playerRoomId) {
      const room = rooms[playerRoomId];
      delete room.players[socket.id];

      io.to(playerRoomId).emit('playerDisconnected', socket.id);

      // Optionally clean up room if no players left
      if (Object.keys(room.players).length === 0) {
        delete rooms[playerRoomId];
        console.log(`Room ${playerRoomId} deleted as no players remain`);
      }
    }
  });
});

const PORT = 4000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

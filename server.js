const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const players = {}; // socket.id => roomId
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

app.use(cors());

const io = new Server(server, {
  cors: { origin: '*',
          methods: ["GET", "POST"]
   },
  transports: ['websocket'],
});

const GRID_SIZE = 8;
const BASE_CHARACTERS = [
  { name: 'Knight', hp: 100, atk: 30, moveRange: 2 },
  { name: 'Archer', hp: 80, atk: 25, moveRange: 3 },
  { name: 'Mage', hp: 70, atk: 40, moveRange: 2 },
  { name: 'Healer', hp: 90, atk: 10, moveRange: 2 },
  { name: 'Warrior', hp: 110, atk: 35, moveRange: 1 },
  { name: 'Rogue', hp: 75, atk: 30, moveRange: 4, },
  { name: 'Summoner', hp: 65, atk: 45, moveRange: 2, },
  { name: 'Paladin', hp: 95, atk: 20, moveRange: 1, },
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
function tryToMatchPlayers() {
  console.log("👥 Queue Length:", waitingQueue.length);
  console.log("📋 Queue:", waitingQueue);

  while (waitingQueue.length >= 2) {
    const playerAId = waitingQueue.shift();
    const playerBId = waitingQueue.shift();

    const socketA = io.sockets.sockets.get(playerAId);
    const socketB = io.sockets.sockets.get(playerBId);

    if (!socketA || !socketB) {
      // Requeue whoever is still valid
      if (socketA) waitingQueue.unshift(playerAId);
      if (socketB) waitingQueue.unshift(playerBId);
      continue;
    }

    const roomId = `room-${crypto.randomUUID()}`;
    rooms[roomId] = {
      players: {
        [playerAId]: { team: 'A' },
        [playerBId]: { team: 'B' },
      },
      gameState: {
        characters: [...generateTeam('A', 0), ...generateTeam('B', GRID_SIZE - 1)],
        turn: 'A',
        winner: null,
      },
    };
    players[playerAId] = roomId;
    players[playerBId] = roomId;

    socketA.join(roomId);
    socketB.join(roomId);

    socketA.emit('assignTeam', 'A');
    socketB.emit('assignTeam', 'B');

    io.to(roomId).emit('startGame', {
      roomId,
      players: [playerAId, playerBId],
    });

    io.to(roomId).emit('gameState', rooms[roomId].gameState);

    console.log(`✅ Match started in ${roomId} between ${playerAId} and ${playerBId}`);
  }
}

// Helper to check adjacency
const areAdjacent = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

// Validation function
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
    const baseChar = BASE_CHARACTERS.find(bc => bc.name === oldChar.name);
if (!baseChar) {
  console.log('Validation failed: Base character not found for healing check');
  return false;
}

// Allow HP to increase, but not beyond base max HP
if (newChar.hp > oldChar.hp) {
  if (newChar.hp > baseChar.hp) {
    console.log(`HP clamped from ${newChar.hp} to max ${baseChar.hp} for char ${newChar.name}`);
    newChar.hp = baseChar.hp; // Clamp HP to max allowed
  }
  // Allow healing within max HP limits
}
oldChar.hp = newChar.hp;

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
}


function fullyRemovePlayer(socket) {
  const socketId = socket.id;

  // Leave all rooms except the default personal room
  for (const roomId of socket.rooms) {
    if (roomId !== socketId) {
      socket.leave(roomId);
      console.log(`👋 Socket ${socketId} left room ${roomId}`);
    }
  }

  // Remove from server-side rooms object
  let removedFromRoom = false;
  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (room.players[socketId]) {
      delete room.players[socketId];
      removedFromRoom = true;
      console.log(`🧹 Removed ${socketId} from room ${roomId}`);

      // If room empty, delete it
      if (Object.keys(room.players).length === 0) {
        delete rooms[roomId];
        console.log(`🧹 Deleted empty room ${roomId}`);
      }
    }
  }
  
  if (!removedFromRoom) {
    console.log(`⚠️ Player ${socketId} was not in any room`);
  }

  // Remove from players map
  if (players[socketId]) {
    delete players[socketId];
    console.log(`🗑️ Removed ${socketId} from players mapping`);
  }

  // Remove from waitingQueue if present
  const index = waitingQueue.indexOf(socketId);
  if (index !== -1) {
    waitingQueue.splice(index, 1);
    console.log(`🧹 Removed ${socketId} from waitingQueue`);
  }
}



io.on('connection', (socket) => {
  console.log(`✅ New connection: ${socket.id}`);

  // Always listen for playAgain on every socket
  socket.on('playAgain', () => {
  console.log(`🔁 ${socket.id} clicked Play Again`);

  const roomId = players[socket.id];
  if (roomId && rooms[roomId]) {
    const room = rooms[roomId];
    const allPlayerIds = Object.keys(room.players);

    // Remove both players from players map and rooms
    allPlayerIds.forEach(id => {
      const playerSocket = io.sockets.sockets.get(id);
      if (playerSocket) {
        for (const r of playerSocket.rooms) {
          if (r !== id) playerSocket.leave(r);
        }
      }
      delete players[id];
      removeFromWaitingQueue(id);
    });

    delete rooms[roomId];
    console.log(`🧹 Room ${roomId} cleaned up`);
  }

  // Requeue just this socket
  if (!waitingQueue.includes(socket.id)) {
    waitingQueue.push(socket.id);
    console.log(`⏳ ${socket.id} re-added to queue`);
  }

  tryToMatchPlayers();
});





});

app.get('/', (req, res) => {
  res.send('Socket.IO server running');

});

socket.onAny((event, ...args) => {
  console.log(`Received ${event} from ${socket.id}`, args ); 
});

  socket.on('endTurn', () => {
  const playerRoomId = Object.keys(rooms).find(roomId => rooms[roomId].players[socket.id]);
  if (!playerRoomId) {
    console.log(`endTurn: No room found for socket ${socket.id}`);
    return;
  }

  const room = rooms[playerRoomId];
  const playerTeam = room.players[socket.id]?.team;


  if (room.gameState.turn !== playerTeam) {
    console.log(`endTurn: Not player ${playerTeam}'s turn`);
    socket.emit('invalidUpdate', 'It is not your turn.');
    return;
  }

  // Switch turn
  const newTurn = playerTeam === 'A' ? 'B' : 'A';

  // Reset movesLeft and hasAttacked for new turn characters
  const updatedCharacters = room.gameState.characters.map((char) => {
    if (char.team === newTurn && char.hp > 0) {
  const baseChar = BASE_CHARACTERS.find(bc => bc.name === char.name);
  return {
    ...char,
    movesLeft: baseChar.moveRange,
    hasAttacked: false,
  };
}

    // Keep old team characters as-is
    return char;
  });

  room.gameState = {
    characters: updatedCharacters,
    turn: newTurn,
    winner: room.gameState.winner,
  };

  console.log(`Player ${playerTeam} ended turn. Now it's ${newTurn}'s turn.`);

  io.to(playerRoomId).emit('gameState', room.gameState);

});

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

    console.log(`Player ${playerTeam} (${socket.id}) sent updateGame. Valid: ${valid}`);

    if (valid) {
      io.to(playerRoomId).emit('gameState', room.gameState);
    } else {
      socket.emit('invalidUpdate', 'Your game state update was invalid.');
    }
  });



  // Leave all rooms
  socket.on('disconnect', () => {
  console.log('🔌 Player disconnected:', socket.id);

  const roomId = players[socket.id];
  const room = rooms[roomId];

  if (!roomId || !room) {
    console.log('⚠️ No room found for disconnected player.');
    return;
  }

  const opponentId = Object.keys(room.players).find(id => id !== socket.id);

  if (opponentId) {
    // Emit to opponent that they won by disconnect
    io.to(opponentId).emit('gameOver', { winnerId: opponentId, reason: 'opponentDisconnected' });
    console.log(`🏆 ${opponentId} wins by disconnect of ${socket.id}`);

    // Keep opponent's player entry, only remove the disconnecting player
    delete players[socket.id];
  } else {
    console.log('⚠️ No opponent found for disconnected player.');
    delete players[socket.id];
  }

  // Remove player from room
  delete room.players[socket.id];

  // If no players left, delete room
  if (Object.keys(room.players).length === 0) {
    delete rooms[roomId];
  }

  fullyRemovePlayer(socket);
});







  socket.on('surrender', () => {
  console.log(`🛑 Player surrendered: ${socket.id}`);

  const roomId = findRoomOfPlayer(socket.id);
  if (!roomId) {
    console.log('❌ No room found for player on surrender');
    return;
  }
  console.log(`🕵️ Room found: ${roomId}`);

  const room = rooms[roomId];
  const playersInRoom = Object.keys(room.players);
  const winner = playersInRoom.find((id) => id !== socket.id);

  if (winner) {
    console.log(`🏆 Winner determined: ${winner}`);
    io.to(roomId).emit('gameOver', { winnerId: winner });
  } else {
    console.log('⚠️ No winner found');
  }

  playersInRoom.forEach((playerId) => {
    console.log(`📤 Emitting gameEnded to ${playerId}`);
    io.to(playerId).emit('gameEnded');

    const socketRef = io.sockets.sockets.get(playerId);
    if (socketRef) {
      socketRef.leave(roomId);
      console.log(`👋 ${playerId} left room ${roomId}`);
    } else {
      console.log(`⚠️ No socket found for ${playerId}`);
    }

    removePlayerFromRooms(playerId);
    console.log(`🧹 Removed ${playerId} from rooms data`);

    delete players[playerId];
    console.log(`🗑️ Deleted ${playerId} from players map`);

    if (!waitingQueue.includes(playerId)) {
      waitingQueue.push(playerId);
      console.log(`⏳ Re-added ${playerId} to waitingQueue`);
    } else {
      console.log(`ℹ️ ${playerId} already in waitingQueue`);
    }
  });

  delete rooms[roomId];
  console.log(`🧼 Deleted room ${roomId} after surrender`);

  tryToMatchPlayers();
  console.log('▶️ Called tryToMatchPlayers');
});



const PORT = process.env.PORT || 5001;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
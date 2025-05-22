import { io } from 'socket.io-client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import knightSprite from './sprites/knight.png';
import archerSprite from './sprites/archer.png';
import mageSprite from './sprites/mage.png';
import healerSprite from './sprites/healer.png';
import warriorSprite from './sprites/warrior.png';
import rogueSprite from './sprites/rogue.png';
import summonerSprite from './sprites/summoner.png';
import paladinSprite from './sprites/paladin.png';
import './App.css';

const socket = io('https://duelgrid-server.onrender.com', {
  transports: ['websocket'],
});

const gridSize = 8;

const baseCharacters = [
  { name: 'Knight', hp: 100, atk: 30, moveRange: 2, sprite: knightSprite },
  { name: 'Archer', hp: 80, atk: 25, moveRange: 3, sprite: archerSprite },
  { name: 'Mage', hp: 70, atk: 40, moveRange: 2, sprite: mageSprite },
  { name: 'Healer', hp: 90, atk: 10, moveRange: 2, sprite: healerSprite },
  { name: 'Warrior', hp: 110, atk: 35, moveRange: 1, sprite: warriorSprite },
  { name: 'Rogue', hp: 75, atk: 30, moveRange: 4, sprite: rogueSprite },
  { name: 'Summoner', hp: 65, atk: 45, moveRange: 2, sprite: summonerSprite },
  { name: 'Paladin', hp: 95, atk: 20, moveRange: 1, sprite: paladinSprite },
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

const initialCharacters = [...generateTeam('A', 0), ...generateTeam('B', gridSize - 1)];

function App() {
  const [myTeam, setMyTeam] = useState(null);
  const [characters, setCharacters] = useState(initialCharacters);
  const [selectedId, setSelectedId] = useState(null);
  const [turn, setTurn] = useState('A');
  const [winner, setWinner] = useState(null);

  const turnRef = useRef(turn);
  useEffect(() => {
  turnRef.current = turn;
}, [turn]);


  // Update game state from server
  const onGameState = useCallback(({ characters: newChars, turn: newTurn, winner: newWinner }) => {
    setCharacters(newChars);
    setTurn(newTurn);
    setWinner(newWinner);
    setSelectedId(null);
  }, []);

  // Receive assigned team
  const onAssignTeam = useCallback((team) => {
    setMyTeam(team);
  }, []);

  useEffect(() => {
    socket.on('gameState', onGameState);
    socket.on('assignTeam', onAssignTeam);

    return () => {
      socket.off('gameState', onGameState);
      socket.off('assignTeam', onAssignTeam);
    };
  }, [onGameState, onAssignTeam]);

  // Emit updated characters, but DO NOT change turn on client
  const emitGameState = useCallback(
    (updatedChars) => {
      socket.emit('updateGame', {
        characters: updatedChars,
        turn: turnRef.current, // Send current turn, server decides if valid
        winner: winner,
      });
    },
    [winner]
  );

  const selectedChar = characters.find((c) => c.id === selectedId);

  // Clicking a tile selects your character only if it's your turn
  const handleTileClick = (char) => {
    if (!char) return;
    if (char.team === myTeam && turn === myTeam && char.hp > 0) {
      setSelectedId(char.id);
    }
  };

  // Move character ONLY if movesLeft > 0 and turn matches
  const moveCharacter = (id, dx, dy) => {
    if (!selectedChar || selectedChar.team !== myTeam || turn !== myTeam) return;
    if (selectedChar.movesLeft <= 0) return;

    const newX = Math.max(0, Math.min(gridSize - 1, selectedChar.x + dx));
    const newY = Math.max(0, Math.min(gridSize - 1, selectedChar.y + dy));

    // Check if target tile is occupied by a living character
    const isOccupied = characters.some(
      (c) => c.id !== id && c.x === newX && c.y === newY && c.hp > 0
    );
    if (isOccupied) return;

    const updatedChars = characters.map((c) =>
      c.id === id
        ? { ...c, x: newX, y: newY, movesLeft: c.movesLeft - 1 }
        : c
    );

    setCharacters(updatedChars);
    emitGameState(updatedChars);
  };

  // Attack only if has not attacked yet, it's your turn, and attacker belongs to your team
  const attack = (attackerId) => {
    if (!selectedChar || selectedChar.team !== myTeam || turn !== myTeam) return;
    if (selectedChar.hasAttacked) return;

    const attacker = characters.find((c) => c.id === attackerId);
    if (!attacker) return;

    // Find adjacent enemies
    const targets = characters.filter(
      (c) =>
        c.team !== attacker.team &&
        c.hp > 0 &&
        Math.abs(c.x - attacker.x) + Math.abs(c.y - attacker.y) === 1
    );

    if (targets.length === 0) return;

    const target = targets[0];

    const updatedChars = characters.map((c) => {
      if (c.id === target.id) {
        return { ...c, hp: Math.max(0, c.hp - attacker.atk) };
      }
      if (c.id === attacker.id) {
        return { ...c, hasAttacked: true };
      }
      return c;
    });

    setCharacters(updatedChars);
    emitGameState(updatedChars);
  };

  // End turn by telling server, which resets movesLeft, hasAttacked and switches turn
  const endTurn = () => {
  if (turn !== myTeam || winner !== null) return;

  const nextTurn = myTeam === 'A' ? 'B' : 'A';

  const newState = {
    turn: nextTurn,
    characters: characters.map(c => {
      if (c.team === nextTurn) {
        const base = BASE_CHARACTERS.find(b => b.name === c.name);
        return {
          ...c,
          movesLeft: base?.moveRange || 0,
          hasAttacked: false,
        };
      }
      return c;
    }),
  };

  socket.emit('updateGame', newState);
  setSelectedId(null);
};


  // Surrender immediately sets winner to opponent and informs server
  const surrender = () => {
    if (!myTeam) return;
    const opponent = myTeam === 'A' ? 'B' : 'A';
    setWinner(opponent);
    socket.emit('surrender', { winner: opponent });
  };

  return (
    <div className="App">
      <h1>DuelGrid</h1>
      <h2>You are Team {myTeam || '...'}</h2>
      <h2>Turn: Team {turn}</h2>

      <div className="grid" aria-label="Game grid">
        {Array.from({ length: gridSize }).map((_, y) => (
          <div key={y} className="row">
            {Array.from({ length: gridSize }).map((_, x) => {
              const char = characters.find((c) => c.x === x && c.y === y && c.hp > 0);
              return (
                <div
                  key={x}
                  className={`tile ${char ? 'occupied' : ''} ${selectedId === char?.id ? 'selected' : ''}`}
                  onClick={() => handleTileClick(char)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') handleTileClick(char);
                  }}
                >
                  {char && (
                    <div className="character" style={{ opacity: char.team === myTeam ? 1 : 0.5 }}>
                      <img src={char.sprite} alt={char.name} className="sprite" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {selectedChar && selectedChar.team === myTeam ? (
        <div className="character-stats" aria-live="polite">
          <h3>{selectedChar.name}</h3>
          <p>HP: {selectedChar.hp}</p>
          <p>ATK: {selectedChar.atk}</p>
          <p>Moves Left: {selectedChar.movesLeft}</p>
        </div>
      ) : (
        <p>{turn === myTeam ? 'Select a character to move or attack.' : "Waiting for opponent's turn..."}</p>
      )}

      <div className="controls">
        {selectedChar && selectedChar.team === myTeam && turn === myTeam && !winner && (
          <>
            <button
              onClick={() => moveCharacter(selectedId, -1, 0)}
              disabled={selectedChar.movesLeft <= 0}
              aria-label="Move left"
            >
              ←
            </button>
            <button
              onClick={() => moveCharacter(selectedId, 1, 0)}
              disabled={selectedChar.movesLeft <= 0}
              aria-label="Move right"
            >
              →
            </button>
            <button
              onClick={() => moveCharacter(selectedId, 0, -1)}
              disabled={selectedChar.movesLeft <= 0}
              aria-label="Move up"
            >
              ↑
            </button>
            <button
              onClick={() => moveCharacter(selectedId, 0, 1)}
              disabled={selectedChar.movesLeft <= 0}
              aria-label="Move down"
            >
              ↓
            </button>
            <button
              onClick={() => attack(selectedId)}
              disabled={selectedChar.hasAttacked}
              aria-label="Attack"
            >
              Attack
            </button>
          </>
        )}
      </div>

      <div className="turn-controls">
        {turn === myTeam && !winner && (
          <button onClick={endTurn} aria-label="End turn">
            End Turn
          </button>
        )}
        {!winner && myTeam && (
          <button onClick={surrender} aria-label="Surrender">
            Surrender
          </button>
        )}
      </div>

      {winner && <h2>Team {winner} wins!</h2>}
    </div>
  );
}

export default App;

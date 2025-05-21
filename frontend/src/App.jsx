import React, { useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';

import knightSprite from './sprites/knight.png';
import archerSprite from './sprites/archer.png';
import mageSprite from './sprites/mage.png';
import healerSprite from './sprites/healer.png';
import warriorSprite from './sprites/warrior.png';
import rogueSprite from './sprites/rogue.png';
import summonerSprite from './sprites/summoner.png';
import paladinSprite from './sprites/paladin.png';

import './App.css';

const gridSize = 8;

// Base characters template (sprites, stats, etc.)
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

// Initialize socket outside component to avoid reconnects
const socket = io('https://duelgrid-server.onrender.com', {
  transports: ['websocket'],
});

function App() {
  const [myTeam, setMyTeam] = useState(null);
  const [characters, setCharacters] = useState([]);
  const [turn, setTurn] = useState(null);
  const [winner, setWinner] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  // Handlers for incoming socket events
  const onAssignTeam = useCallback((team) => {
    setMyTeam(team);
  }, []);

  const onGameState = useCallback(({ characters, turn, winner }) => {
    setCharacters(characters);
    setTurn(turn);
    setWinner(winner);
    setSelectedId(null); // Clear selection on every update
  }, []);

  useEffect(() => {
    socket.on('assignTeam', onAssignTeam);
    socket.on('gameState', onGameState);

    return () => {
      socket.off('assignTeam', onAssignTeam);
      socket.off('gameState', onGameState);
    };
  }, [onAssignTeam, onGameState]);

  // Selected character from characters array
  const selectedChar = characters.find((c) => c.id === selectedId);

  // Move emits event only, no local state update here
  const moveCharacter = (id, dx, dy) => {
    if (!myTeam || turn !== myTeam) return;
    const char = characters.find((c) => c.id === id);
    if (!char || char.team !== myTeam || char.movesLeft <= 0) return;

    const newX = Math.min(gridSize - 1, Math.max(0, char.x + dx));
    const newY = Math.min(gridSize - 1, Math.max(0, char.y + dy));

    // Check tile occupied?
    if (characters.some((c) => c.id !== id && c.x === newX && c.y === newY && c.hp > 0)) return;

    socket.emit('moveCharacter', { id, newX, newY });
  };

  // Attack emits event only
  const attack = (attackerId) => {
    if (!myTeam || turn !== myTeam) return;
    const attacker = characters.find((c) => c.id === attackerId);
    if (!attacker || attacker.team !== myTeam || attacker.hasAttacked) return;

    // Find enemy adjacent (Manhattan distance 1)
    const targets = characters.filter(
      (c) =>
        c.team !== attacker.team &&
        c.hp > 0 &&
        Math.abs(c.x - attacker.x) + Math.abs(c.y - attacker.y) === 1
    );

    if (targets.length === 0) return;

    const target = targets[0];

    socket.emit('attackCharacter', { attackerId, targetId: target.id });
  };

  // End turn
  const endTurn = () => {
    if (turn === myTeam && !winner) {
      socket.emit('endTurn');
      setSelectedId(null);
    }
  };

  // Surrender
  const surrender = () => {
    if (!myTeam) return;
    const opponent = myTeam === 'A' ? 'B' : 'A';
    socket.emit('surrender', { winner: opponent });
    setWinner(opponent);
  };

  // Select character only if belongs to player and alive and is player's turn
  const handleTileClick = (char) => {
    if (!char) return;
    if (char.team === myTeam && turn === myTeam && char.hp > 0) {
      setSelectedId(char.id);
    }
  };

  return (
    <div className="App">
      <h1>DuelGrid</h1>
      <h2>You are Team {myTeam || '...'}</h2>
      <h2>Turn: Team {turn || '...'}</h2>

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

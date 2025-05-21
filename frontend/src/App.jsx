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

// ⚠️ Replace with your backend URL
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

  // Ref to keep latest turn value for use inside socket callbacks and emitters
  const turnRef = useRef(turn);
  useEffect(() => {
    turnRef.current = turn;
  }, [turn]);

  const selectedChar = characters.find((c) => c.id === selectedId);

  // onGameState uses setState hooks directly (no stale closure issues)
  const onGameState = useCallback(({ characters: newChars, turn: newTurn, winner: newWinner }) => {
    setCharacters(newChars);
    setTurn(newTurn);
    setWinner(newWinner);
    setSelectedId(null);
  }, []);

  const onAssignTeam = useCallback((team) => {
    setMyTeam(team);
    console.log('Assigned team:', team);
  }, []);

  useEffect(() => {
    socket.on('gameState', onGameState);
    socket.on('assignTeam', onAssignTeam);

    return () => {
      socket.off('gameState', onGameState);
      socket.off('assignTeam', onAssignTeam);
    };
  }, [onGameState, onAssignTeam]);

  // Emit game state with latest turnRef.current to avoid stale turn values
  const emitGameState = (updatedChars, nextTurn = turnRef.current, winnerCheck = null) => {
    socket.emit('updateGame', {
      characters: updatedChars,
      turn: nextTurn,
      winner: winnerCheck,
    });
  };

  const handleTileClick = (char) => {
    if (!char) return;
    if (char.team === myTeam && turn === myTeam && char.hp > 0) {
      setSelectedId(char.id);
    }
  };

  const moveCharacter = (id, dx, dy) => {
    if (!selectedChar || selectedChar.team !== myTeam || turn !== myTeam) return;

    const newCharacters = characters.map((c) => {
      if (c.id === id && c.team === myTeam && c.movesLeft > 0) {
        const newX = Math.max(0, Math.min(gridSize - 1, c.x + dx));
        const newY = Math.max(0, Math.min(gridSize - 1, c.y + dy));

        const isOccupied = characters.some(
          (other) => other.id !== c.id && other.x === newX && other.y === newY && other.hp > 0
        );

        if (!isOccupied) {
          return { ...c, x: newX, y: newY, movesLeft: c.movesLeft - 1 };
        }
      }
      return c;
    });

    setCharacters(newCharacters);
    emitGameState(newCharacters);
  };

  const attack = (attackerId) => {
    if (!selectedChar || selectedChar.team !== myTeam || turn !== myTeam) return;

    const attacker = characters.find((c) => c.id === attackerId);
    if (!attacker || attacker.hasAttacked) return;

    const targets = characters.filter(
      (c) =>
        c.team !== attacker.team &&
        Math.abs(c.x - attacker.x) + Math.abs(c.y - attacker.y) === 1 &&
        c.hp > 0
    );

    if (targets.length > 0) {
      const target = targets[0]; // attack first adjacent enemy found
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
    }
  };

  const endTurn = () => {
    if (turn !== myTeam || winner !== null) return;

    const nextTurn = turn === 'A' ? 'B' : 'A';

    const updatedChars = characters.map((c) => {
      if (c.team === nextTurn) {
        const baseChar = baseCharacters.find((bc) => bc.name === c.name);
        return {
          ...c,
          movesLeft: baseChar ? baseChar.moveRange : c.movesLeft,
          hasAttacked: false,
        };
      } else {
        return { ...c };
      }
    });

    const aliveA = updatedChars.some((c) => c.team === 'A' && c.hp > 0);
    const aliveB = updatedChars.some((c) => c.team === 'B' && c.hp > 0);
    const newWinner = !aliveA ? 'B' : !aliveB ? 'A' : null;

    setCharacters(updatedChars);
    setTurn(nextTurn);
    setWinner(newWinner);
    setSelectedId(null);

    emitGameState(updatedChars, nextTurn, newWinner);
  };

  const surrender = () => {
    if (!myTeam) return;
    const opponent = myTeam === 'A' ? 'B' : 'A';
    setWinner(opponent);
    emitGameState(characters, turnRef.current, opponent);
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

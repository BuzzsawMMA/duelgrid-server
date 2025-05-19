import React, { useState } from 'react';
import './App.css';

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
const generateTeam = (team, row) => baseCharacters.map((c, i) => ({
  ...c,
  id: idCounter++,
  x: i,
  y: row,
  team,
  movesLeft: c.moveRange,
  hasAttacked: false,
}));

const initialCharacters = [
  ...generateTeam('A', 0),
  ...generateTeam('B', gridSize - 1),
];

function App() {
  const [characters, setCharacters] = useState(initialCharacters);
  const [selectedId, setSelectedId] = useState(null);
  const [turn, setTurn] = useState('A');
  const [winner, setWinner] = useState(null);

  const selectedChar = characters.find(c => c.id === selectedId);

  const moveCharacter = (id, dx, dy) => {
    setCharacters(prev =>
      prev.map(c => {
        if (c.id === id && c.team === turn && c.movesLeft > 0) {
          const newX = Math.max(0, Math.min(gridSize - 1, c.x + dx));
          const newY = Math.max(0, Math.min(gridSize - 1, c.y + dy));
          const isOccupied = prev.some(
            other => other.id !== c.id && other.x === newX && other.y === newY && other.hp > 0
          );
          if (!isOccupied) {
            return { ...c, x: newX, y: newY, movesLeft: c.movesLeft - 1 };
          }
        }
        return c;
      })
    );
  };

  const attack = attackerId => {
    const attacker = characters.find(c => c.id === attackerId);
    if (attacker.hasAttacked) return;
    const targets = characters.filter(
      c => c.team !== attacker.team && Math.abs(c.x - attacker.x) + Math.abs(c.y - attacker.y) === 1 && c.hp > 0
    );
    if (targets.length > 0) {
      const target = targets[0];
      setCharacters(prev => prev.map(c => {
        if (c.id === target.id) {
          return { ...c, hp: Math.max(0, c.hp - attacker.atk) };
        }
        if (c.id === attacker.id) {
          return { ...c, hasAttacked: true };
        }
        return c;
      }));
    }
  };

  const endTurn = () => {
    const nextTurn = turn === 'A' ? 'B' : 'A';
    setTurn(nextTurn);
    setSelectedId(null);
    setCharacters(prev =>
      prev.map(c =>
        c.team === nextTurn
          ? { ...c, movesLeft: c.moveRange, hasAttacked: false }
          : c
      )
    );

    const aliveA = characters.some(c => c.team === 'A' && c.hp > 0);
    const aliveB = characters.some(c => c.team === 'B' && c.hp > 0);
    if (!aliveA) setWinner('B');
    else if (!aliveB) setWinner('A');
  };

  const resetGame = () => {
    idCounter = 1;
    setCharacters([
      ...generateTeam('A', 0),
      ...generateTeam('B', gridSize - 1),
    ]);
    setTurn('A');
    setSelectedId(null);
    setWinner(null);
  };

  return (
    <div className="App">
      <h1>DuelGrid</h1>
      <h2>Turn: Team {turn}</h2>

      <div className="grid">
        {Array.from({ length: gridSize }).map((_, y) => (
          <div key={y} className="row">
            {Array.from({ length: gridSize }).map((_, x) => {
              const char = characters.find(c => c.x === x && c.y === y && c.hp > 0);
              return (
                <div
                  key={x}
                  className={`tile ${char ? 'occupied' : ''}`}
                  onClick={() => {
                    if (char && char.team === turn) setSelectedId(char.id);
                  }}
                >
                  {char && (
                    <div className="character">
                      <img src={char.sprite} alt={char.name} className="sprite" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {selectedChar && selectedChar.team === turn && (
        <div className="character-stats">
          <h3>{selectedChar.name}</h3>
          <p>HP: {selectedChar.hp}</p>
          <p>ATK: {selectedChar.atk}</p>
          <p>Moves Left: {selectedChar.movesLeft}</p>
        </div>
      )}

      <div className="controls">
        {selectedChar && selectedChar.team === turn && (
          <>
            <button onClick={() => moveCharacter(selectedId, -1, 0)}>←</button>
            <button onClick={() => moveCharacter(selectedId, 1, 0)}>→</button>
            <button onClick={() => moveCharacter(selectedId, 0, -1)}>↑</button>
            <button onClick={() => moveCharacter(selectedId, 0, 1)}>↓</button>
            <button onClick={() => attack(selectedId)} disabled={selectedChar.hasAttacked}>Attack</button>
            <button onClick={endTurn}>End Turn</button>
            <button onClick={resetGame}>Restart Game</button>
          </>
        )}
      </div>

      {winner && <h2 className="winner">Winner: Team {winner}</h2>}
    </div>
  );
}

export default App;

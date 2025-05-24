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
import TutorialModal from './TutorialModal';

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
    hasHealed: false, // Track heal usage
  }));

const initialCharacters = [...generateTeam('A', 0), ...generateTeam('B', gridSize - 1)];

function App() {
  const [myTeam, setMyTeam] = useState(null);
  const [characters, setCharacters] = useState(initialCharacters);
  const [selectedId, setSelectedId] = useState(null);
  const [turn, setTurn] = useState('A');
  const [winner, setWinner] = useState(null);
  const [mode, setMode] = useState(null); // null | 'attack' | 'heal'

  const turnRef = useRef(turn);
  useEffect(() => {
    turnRef.current = turn;
  }, [turn]);

  const onGameState = useCallback(({ characters: newChars, turn: newTurn, winner: newWinner }) => {
    setCharacters(newChars);
    setTurn(newTurn);
    setWinner(newWinner);
    setSelectedId(null);
    setMode(null);
  }, []);

  const onAssignTeam = useCallback((team) => {
    setMyTeam(team);
  }, []);

  useEffect(() => {
    socket.on('gameState', onGameState);
    socket.on('assignTeam', onAssignTeam);
    socket.on('opponentSurrendered', ({ winner }) => {
      setWinner(winner);
      alert(`Team ${winner === 'A' ? 'B' : 'A'} has surrendered. You win!`);
    });

    return () => {
      socket.off('gameState', onGameState);
      socket.off('assignTeam', onAssignTeam);
    };
  }, [onGameState, onAssignTeam]);

  const emitGameState = useCallback(
    (updatedChars) => {
      socket.emit('updateGame', {
        characters: updatedChars,
        turn: turnRef.current,
        winner: winner,
      });
    },
    [winner]
  );

  const selectedChar = characters.find((c) => c.id === selectedId);

  const handleTileClick = (char) => {
    if (!char) return;

    if (mode === 'attack' && selectedChar && selectedChar.team === myTeam && turn === myTeam) {
      const isTargetInRange =
        Math.abs(char.x - selectedChar.x) + Math.abs(char.y - selectedChar.y) === 1 &&
        char.hp > 0 &&
        char.team !== myTeam;

      if (isTargetInRange && !selectedChar.hasAttacked) {
        const updatedChars = characters.map((c) => {
          if (c.id === char.id) {
            return { ...c, hp: Math.max(0, c.hp - selectedChar.atk) };
          }
          if (c.id === selectedChar.id) {
            return { ...c, hasAttacked: true };
          }
          return c;
        });
        setCharacters(updatedChars);
        emitGameState(updatedChars);
        setMode(null);
        return;
      }
    }

    if (mode === 'heal' && selectedChar && selectedChar.team === myTeam && turn === myTeam && selectedChar.name === 'Healer') {
      const isAllyInRange =
        Math.abs(char.x - selectedChar.x) + Math.abs(char.y - selectedChar.y) === 1 &&
        char.hp > 0 &&
        char.team === myTeam;

      if (isAllyInRange && !selectedChar.hasHealed) {
        const maxHp = baseCharacters.find((bc) => bc.name === char.name).hp;
        const healAmount = 25; // Fixed heal amount, can be adjusted
        const updatedChars = characters.map((c) => {
          if (c.id === char.id) {
            return { ...c, hp: Math.min(maxHp, c.hp + healAmount) };
          }
          if (c.id === selectedChar.id) {
            return { ...c, hasHealed: true };
          }
          return c;
        });
        setCharacters(updatedChars);
        emitGameState(updatedChars);
        setMode(null);
        return;
      }
    }

    if (char.team === myTeam && turn === myTeam && char.hp > 0) {
      setSelectedId(char.id);
      setMode(null); // Cancel attack/heal mode when selecting a new ally
    }
  };

  const moveCharacter = (id, dx, dy) => {
    if (!selectedChar || selectedChar.team !== myTeam || turn !== myTeam) return;
    if (selectedChar.movesLeft <= 0) return;

    const newX = Math.max(0, Math.min(gridSize - 1, selectedChar.x + dx));
    const newY = Math.max(0, Math.min(gridSize - 1, selectedChar.y + dy));

    const isOccupied = characters.some(
      (c) => c.id !== id && c.x === newX && c.y === newY && c.hp > 0
    );
    if (isOccupied) return;

    const updatedChars = characters.map((c) =>
      c.id === id ? { ...c, x: newX, y: newY, movesLeft: c.movesLeft - 1 } : c
    );

    setCharacters(updatedChars);
    emitGameState(updatedChars);
  };

  const initiateAttackMode = () => {
    if (!selectedChar || selectedChar.team !== myTeam || turn !== myTeam || selectedChar.hasAttacked) return;
    setMode('attack');
  };

  const initiateHealMode = () => {
    if (!selectedChar || selectedChar.team !== myTeam || turn !== myTeam) return;
    if (selectedChar.name !== 'Healer') return;
    if (selectedChar.hasHealed) return;
    setMode('heal');
  };

  const endTurn = () => {
    if (turn !== myTeam || winner !== null) return;
    socket.emit('endTurn');
    setSelectedId(null);
    setMode(null);
  };

  const surrender = () => {
    if (!myTeam) return;
    const opponent = myTeam === 'A' ? 'B' : 'A';
    setWinner(opponent);
    socket.emit('surrender', { winner: opponent });
  };

  return (
    <div className="App">
      <TutorialModal />
      <h1>DuelGrid</h1>
      <h2>You are Team {myTeam || '...'}</h2>
      <h2>Turn: Team {turn}</h2>

      <div className="grid">
        {Array.from({ length: gridSize }).map((_, y) => (
          <div key={y} className="row">
            {Array.from({ length: gridSize }).map((_, x) => {
              const char = characters.find((c) => c.x === x && c.y === y && c.hp > 0);
              const isAttackTargetable =
                mode === 'attack' &&
                selectedChar &&
                char &&
                char.team !== myTeam &&
                Math.abs(char.x - selectedChar.x) + Math.abs(char.y - selectedChar.y) === 1;

              const isHealTargetable =
                mode === 'heal' &&
                selectedChar &&
                char &&
                char.team === myTeam &&
                Math.abs(char.x - selectedChar.x) + Math.abs(char.y - selectedChar.y) === 1;

              return (
                <div
                  key={x}
                  className={`tile ${char ? 'occupied' : ''} ${selectedId === char?.id ? 'selected' : ''} ${
                    isAttackTargetable ? 'targetable-attack' : ''
                  } ${isHealTargetable ? 'targetable-heal' : ''}`}
                  onClick={() => handleTileClick(char)}
                >
                  {char && (
                    <div className="character" style={{ opacity: char.team === myTeam ? 1 : 0.5 }}>
                      <img src={char.sprite} alt={char.name} className="sprite" />
                      <div className="health-bar-wrapper">
                        <div
                          className="health-bar"
                          style={{
                            width: `${(char.hp / baseCharacters.find(c => c.name === char.name).hp) * 100}%`,
                            backgroundColor:
                              char.hp > 50 ? 'green' : char.hp > 20 ? 'orange' : 'red',
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {selectedChar && selectedChar.team === myTeam ? (
        <div className="character-stats">
          <h3>{selectedChar.name}</h3>
          <p>HP: {selectedChar.hp}</p>
          <p>ATK: {selectedChar.atk}</p>
          <p>Moves Left: {selectedChar.movesLeft}</p>
          {selectedChar.name === 'Healer' && <p>Heal Used: {selectedChar.hasHealed ? 'Yes' : 'No'}</p>}
          <p>Attack Used: {selectedChar.hasAttacked ? 'Yes' : 'No'}</p>
        </div>
      ) : (
        <p>{turn === myTeam ? 'Select a character to move or attack/heal.' : "Waiting for opponent's turn..."}</p>
      )}

      <div className="controls">
        {selectedChar && selectedChar.team === myTeam && turn === myTeam && !winner && (
          <>
            <button onClick={() => moveCharacter(selectedId, -1, 0)} disabled={selectedChar.movesLeft <= 0}>←</button>
            <button onClick={() => moveCharacter(selectedId, 1, 0)} disabled={selectedChar.movesLeft <= 0}>→</button>
            <button onClick={() => moveCharacter(selectedId, 0, -1)} disabled={selectedChar.movesLeft <= 0}>↑</button>
            <button onClick={() => moveCharacter(selectedId, 0, 1)} disabled={selectedChar.movesLeft <= 0}>↓</button>
            <button onClick={initiateAttackMode} disabled={selectedChar.hasAttacked}>Attack</button>
            {selectedChar.name === 'Healer' && (
              <button onClick={initiateHealMode} disabled={selectedChar.hasHealed}>Heal</button>
            )}
          </>
        )}
      </div>

      <div className="turn-controls">
        {turn === myTeam && !winner && (
          <button onClick={endTurn}>End Turn</button>
        )}
        {!winner && myTeam && (
          <button onClick={surrender}>Surrender</button>
        )}
      </div>

      {winner && (
        <div className="winner-message">
          Team {winner} wins!
        </div>
      )}
    </div>
  );
}

export default App;

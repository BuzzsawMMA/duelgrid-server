import React, { useState, useEffect } from 'react';
import './TutorialModal.css';

const TutorialModal = () => {
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    const seenTutorial = localStorage.getItem('seenTutorial');
    if (!seenTutorial) setShowModal(true);
  }, []);

  const closeModal = () => {
    localStorage.setItem('seenTutorial', 'true');
    setShowModal(false);
  };

  if (!showModal) return null;

  return (
    <div className="tutorial-modal-overlay">
      <div className="tutorial-modal">
        <h2>⚔️ Welcome to DuelGrid!</h2>
        <p><strong>Objective:</strong> Defeat all enemy units by outsmarting them on the grid.</p>
        <p><strong>How to Play:</strong></p>
        <ol style={{ textAlign: 'left' }}>
          <li>Each player starts with 8 unique units.</li>
          <li>Units have different stats (Attack, HP, Moves).</li>
          <li>Click a unit, then click the arrows to move or attack.</li>
        </ol>
        <p><strong>Tip:</strong> Hover over units to view stats and abilities.</p>
        <button onClick={closeModal}>Start Game</button>
      </div>
    </div>
  );
};

export default TutorialModal;

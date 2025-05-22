import React, { useState, useEffect } from 'react';
import './TutorialModal.css'; // Optional: create a CSS file for styling

const TutorialModal = () => {
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    const hasSeenTutorial = localStorage.getItem('hasSeenTutorial');
    if (!hasSeenTutorial) {
      setShowModal(true);
    }
  }, []);

  const handleClose = () => {
    setShowModal(false);
    localStorage.setItem('hasSeenTutorial', 'true');
  };

  if (!showModal) return null;

  return (
    <div className="tutorial-modal-backdrop">
      <div className="tutorial-modal">
        <h2>Welcome to DuelGrid!</h2>
        <p>Here’s a quick overview:</p>
        <ul>
          <li>Select a unit and click on the grid to move or attack.</li>
          <li>Each unit has unique abilities.</li>
          <li>Your goal is to defeat the opposing team!</li>
        </ul>
        <button onClick={handleClose}>Got it!</button>
      </div>
    </div>
  );
};

export default TutorialModal;

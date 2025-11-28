import React from 'react';
import GalaxyCanvas from './components/GalaxyCanvas';

const App: React.FC = () => {
  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden">
      <GalaxyCanvas />
    </div>
  );
};

export default App;
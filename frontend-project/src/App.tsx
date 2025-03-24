import React from "react";
import { HashRouter, Routes, Route } from 'react-router-dom';
import LoginPage from './Views/Login/index.tsx';
import HomePage from './Views/Home/index.tsx';

const App: React.FC = () => {

  return (
    <div>
      <HashRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </HashRouter>
    </div>
  );
};

export default App;
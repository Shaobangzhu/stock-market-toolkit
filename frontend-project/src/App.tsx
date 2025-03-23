import React from "react";
import { HashRouter, Routes, Route } from 'react-router-dom';
import LoginPage from './Views/Login';

const App: React.FC = () => {

  return (
    <div>
      <HashRouter>
        <Routes>
          <Route path="/" element={<LoginPage />} />
        </Routes>
      </HashRouter>
    </div>
  );
};

export default App;
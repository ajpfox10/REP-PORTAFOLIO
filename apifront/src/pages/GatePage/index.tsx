import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { GateContent } from './components/GateContent';

import './styles/GatePage.css';

export function GatePage() {
  const { session } = useAuth();
  
  if (session) {
    return <Navigate to="/app" replace />;
  }

  return (
    <div className="container">
      <GateContent />
    </div>
  );
}
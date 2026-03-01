// src/pages/LoginPage/components/LoginCard.tsx
import React from 'react';

interface LoginCardProps {
  children: React.ReactNode;
}

export function LoginCard({ children }: LoginCardProps) {
  return (
    <div className="container">
      <div className="card login-card">
        {children}
      </div>
    </div>
  );
}
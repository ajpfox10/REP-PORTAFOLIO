// src/pages/LoginPage/components/LoginHeader.tsx
import React from 'react';
import '../styles/LoginHeader.css';

interface LoginHeaderProps {
  title?: string;
  subtitle?: string;
}

export function LoginHeader({ 
  title = "Iniciar Sesión", 
  subtitle = "Ingresá tus credenciales para acceder al sistema" 
}: LoginHeaderProps) {
  return (
    <div className="login-header">
      <div className="logo-container">
        <div className="logo-placeholder">
          <span className="logo-text">Sistema de Gestión</span>
        </div>
      </div>
      <h1 className="login-title">{title}</h1>
      <p className="login-subtitle">{subtitle}</p>
    </div>
  );
}
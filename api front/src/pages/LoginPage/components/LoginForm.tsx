// src/pages/LoginPage/components/LoginForm.tsx
import React from 'react';

interface LoginFormProps {
  email: string;
  password: string;
  loading: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onGoBack: () => void;
}

export function LoginForm({
  email,
  password,
  loading,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onGoBack,
}: LoginFormProps) {
  return (
    <form onSubmit={onSubmit}>
      <div className="field">
        <label>Email</label>
        <input
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          placeholder="admin@local.com"
          autoComplete="username"
        />
      </div>

      <div className="field">
        <label>Contraseña</label>
        <input
          type="password"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          placeholder="••••••••"
          autoComplete="current-password"
        />
      </div>

      <div className="row login-actions">
        <button className="btn primary" type="submit" disabled={loading}>
          {loading ? 'Ingresando…' : 'Ingresar'}
        </button>
        <button className="btn" type="button" onClick={onGoBack}>
          Volver
        </button>
      </div>
    </form>
  );
}
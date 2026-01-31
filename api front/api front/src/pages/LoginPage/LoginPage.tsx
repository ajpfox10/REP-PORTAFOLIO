// src/pages/LoginPage/LoginPage.tsx (REFACTORIZADO CON COMPONENTES)
import React from 'react';
import { useLogin } from './hooks/useLogin';
import { 
  LoginCard, 
  LoginHeader, 
  LoginForm, 
  LoginFooter 
} from './components';
import './styles/LoginPage.css';

export default function LoginPage() {
  const {
    email,
    password,
    loading,
    handleEmailChange,
    handlePasswordChange,
    handleSubmit,
    handleGoBack,
  } = useLogin();

  return (
    <LoginCard>
      <LoginHeader />
      <LoginForm
        email={email}
        password={password}
        loading={loading}
        onEmailChange={handleEmailChange}
        onPasswordChange={handlePasswordChange}
        onSubmit={handleSubmit}
        onGoBack={handleGoBack}
      />
      <LoginFooter />
    </LoginCard>
  );
}
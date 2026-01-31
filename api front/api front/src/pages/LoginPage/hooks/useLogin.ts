// src/pages/LoginPage/hooks/useLogin.ts
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../auth/AuthProvider.tsx';
import { useToast } from '../../../ui/toast';

function normalizeErrMessage(err: any): string {
  if (!err) return 'Error';
  if (typeof err === 'string') return err;
  if (typeof err?.message === 'string') return err.message;
  
  try {
    return JSON.stringify(err);
  } catch {
    return 'Error';
  }
}

export function useLogin() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  
  const [email, setEmail] = useState('admin@local.com');
  const [password, setPassword] = useState('admin1234');
  const [loading, setLoading] = useState(false);

  const handleEmailChange = useCallback((value: string) => {
    setEmail(value);
  }, []);

  const handlePasswordChange = useCallback((value: string) => {
    setPassword(value);
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      await login(email.trim(), password);
      toast.ok('Sesión iniciada');
      navigate('/app');
    } catch (err: any) {
      toast.error('No se pudo iniciar sesión', normalizeErrMessage(err));
    } finally {
      setLoading(false);
    }
  }, [email, password, login, toast, navigate]);

  const handleGoBack = useCallback(() => {
    navigate('/gate');
  }, [navigate]);

  return {
    // Estado
    email,
    password,
    loading,
    
    // Handlers
    handleEmailChange,
    handlePasswordChange,
    handleSubmit,
    handleGoBack,
    
    // Valores estáticos
    defaultEmail: 'admin@local.com',
    defaultPassword: 'admin1234',
  };
}
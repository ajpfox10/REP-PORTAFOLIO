import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import AppRouter from './router/index';
import useAuthStore from './store/authStore';
import useThemeStore from './store/themeStore';

export default function App() {
  const initialize = useAuthStore(s => s.initialize);
  const theme = useThemeStore(s => s.theme);
  useEffect(() => { initialize(); }, [initialize]);

  return (
    <BrowserRouter>
      <AppRouter />
      <Toaster position="top-right" richColors closeButton theme={theme} toastOptions={{ duration: 4500 }} />
    </BrowserRouter>
  );
}

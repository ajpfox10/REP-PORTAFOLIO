import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import AppRouter from './router/index';
import useAuthStore from './store/authStore';

export default function App() {
  const initialize = useAuthStore(s => s.initialize);
  useEffect(() => { initialize(); }, [initialize]);

  return (
    <BrowserRouter>
      <AppRouter />
    </BrowserRouter>
  );
}

import { create } from 'zustand';

const KEY = 'dc-theme';

function read() {
  try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; }
}

function apply(theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

const useThemeStore = create(set => ({
  theme: read(),
  setTheme: theme => {
    try { localStorage.setItem(KEY, theme); } catch { /* preferencia solo por sesión */ }
    apply(theme);
    set({ theme });
  },
}));

apply(useThemeStore.getState().theme);

export default useThemeStore;

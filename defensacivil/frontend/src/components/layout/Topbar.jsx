import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, LogOut, KeyRound, Sun, Moon, Monitor, ChevronDown } from 'lucide-react';
import useAuthStore from '../../store/authStore';
import useThemeStore from '../../store/themeStore';
import { ROLE_LABELS } from '../../lib/constants';
import { initials } from '../../lib/format';
import ChangePasswordModal from './ChangePasswordModal';

const THEMES = [
  { value: 'light',  label: 'Claro',   icon: Sun },
  { value: 'dark',   label: 'Oscuro',  icon: Moon },
  { value: 'system', label: 'Sistema', icon: Monitor },
];

export default function Topbar({ onMenu }) {
  const { user, logout } = useAuthStore();
  const { theme, setTheme } = useThemeStore();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const date = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const today = date.charAt(0).toUpperCase() + date.slice(1);

  return (
    <header className="topbar">
      <button className="btn btn-ghost btn-icon menu-btn" onClick={onMenu} aria-label="Abrir menú">
        <Menu size={20} />
      </button>
      <div className="topbar-title">{today}</div>

      <div style={{ position: 'relative' }} ref={ref}>
        <button className="user-chip" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}>
          <span className="avatar">{initials(user?.full_name)}</span>
          <span className="who">
            <strong>{user?.full_name}</strong>
            <span>{ROLE_LABELS[user?.role]}</span>
          </span>
          <ChevronDown size={16} className="muted" />
        </button>

        {open && (
          <div className="menu" role="menu">
            <div style={{ padding: '6px 10px 8px', fontSize: 12, color: 'var(--text-3)' }}>
              Conectado como <strong style={{ color: 'var(--text)' }}>{user?.username}</strong>
            </div>
            <div style={{ padding: '2px 6px 6px' }}>
              <div className="segmented" role="group" aria-label="Tema">
                {THEMES.map(({ value, label, icon: Icon }) => (
                  <button key={value} aria-pressed={theme === value} onClick={() => setTheme(value)}>
                    <Icon size={14} /> {label}
                  </button>
                ))}
              </div>
            </div>
            <hr />
            <button role="menuitem" onClick={() => { setOpen(false); setPwOpen(true); }}>
              <KeyRound size={16} /> Cambiar contraseña
            </button>
            <button role="menuitem" onClick={handleLogout}>
              <LogOut size={16} /> Cerrar sesión
            </button>
          </div>
        )}
      </div>

      <ChangePasswordModal isOpen={pwOpen} onClose={() => setPwOpen(false)} />
    </header>
  );
}

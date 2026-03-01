// src/pages/GestionUsuarioPage/GestionUsuarioPage.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { Layout } from '../../components/Layout';
import { useAuth } from '../../auth/AuthProvider';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

type MeResponse = {
  ok: boolean;
  data?: {
    id: number;
    email: string;
    nombre: string;
    roleId: number;
    permissions: string[];
  };
  error?: any;
};

type TabKey = 'perfil' | 'seguridad' | 'permisos';

export default function GestionUsuarioPage() {
  const { session, logout } = useAuth();
  const toast = useToast();

  const [tab, setTab] = useState<TabKey>('perfil');
  const [loadingMe, setLoadingMe] = useState(false);
  const [me, setMe] = useState<MeResponse['data'] | null>(null);
  const [meErr, setMeErr] = useState<string | null>(null);

  // Cargar /auth/me (source of truth)
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingMe(true);
      setMeErr(null);
      try {
        const resp = await apiFetch<MeResponse>('/auth/me', { method: 'GET' });
        if (!alive) return;
        if (!resp?.ok || !resp?.data) {
          setMeErr('No se pudo cargar tu perfil.');
          setMe(null);
          return;
        }
        setMe(resp.data);
      } catch (e: any) {
        if (!alive) return;
        setMeErr(String(e?.message || 'Error cargando perfil'));
        setMe(null);
      } finally {
        if (alive) setLoadingMe(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const headerEmail = me?.email ?? session?.user?.email ?? '';

  return (
    <Layout title="Mi cuenta" showBack>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="h2" style={{ marginBottom: 4 }}>Gestión del usuario</div>
            <div className="muted" style={{ fontSize: '0.9rem' }}>
              Acá ves solo tus datos y tu seguridad.
            </div>
          </div>

          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className={`btn ${tab === 'perfil' ? 'active' : ''}`} onClick={() => setTab('perfil')}>
              👤 Perfil
            </button>
            <button className={`btn ${tab === 'seguridad' ? 'active' : ''}`} onClick={() => setTab('seguridad')}>
              🔒 Seguridad
            </button>
            <button className={`btn ${tab === 'permisos' ? 'active' : ''}`} onClick={() => setTab('permisos')}>
              🧾 Permisos
            </button>
          </div>
        </div>
      </div>

      {loadingMe ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="muted">Cargando tu información…</div>
        </div>
      ) : meErr ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="muted" style={{ color: '#fca5a5' }}>
            {meErr}
          </div>
        </div>
      ) : null}

      {!loadingMe && !meErr && tab === 'perfil' ? (
        <PerfilPanel me={me} fallbackEmail={headerEmail} />
      ) : null}

      {!loadingMe && !meErr && tab === 'seguridad' ? (
        <SeguridadPanel onLogout={() => logout()} toastOk={toast.ok} toastErr={toast.error} />
      ) : null}

      {!loadingMe && !meErr && tab === 'permisos' ? (
        <PermisosPanel permissions={me?.permissions ?? []} />
      ) : null}
    </Layout>
  );
}

/* ───────────────────────────────────────────────────────────────────────────── */

function PerfilPanel({ me, fallbackEmail }: { me: any; fallbackEmail: string }) {
  const email = me?.email ?? fallbackEmail ?? '';
  const nombre = me?.nombre ?? '';
  const roleId = me?.roleId ?? null;
  const id = me?.id ?? null;

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="h2" style={{ marginBottom: 10 }}>Tus datos</div>

      <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <InfoItem label="ID" value={id ? String(id) : '—'} />
        <InfoItem label="Email" value={email || '—'} />
        <InfoItem label="Nombre" value={nombre || '—'} />
        <InfoItem label="RoleId" value={roleId ? String(roleId) : '—'} />
      </div>

      <div className="muted" style={{ marginTop: 12, fontSize: '0.85rem' }}>
        Si necesitás cambiar algo de estos datos, pedíselo a un administrador.
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 220 }}>
      <div className="muted" style={{ fontSize: '0.72rem', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: '1rem', marginTop: 2 }}>{value}</div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────── */

function SeguridadPanel({
  onLogout,
  toastOk,
  toastErr,
}: {
  onLogout: () => void;
  toastOk: (t: string, m?: string) => void;
  toastErr: (t: string, m?: string) => void;
}) {
  const [passwordActual, setPasswordActual] = useState('');
  const [passwordNuevo, setPasswordNuevo] = useState('');
  const [passwordNuevo2, setPasswordNuevo2] = useState('');
  const [saving, setSaving] = useState(false);

  const strongPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;

  const canSave = useMemo(() => {
    if (!passwordActual || !passwordNuevo || !passwordNuevo2) return false;
    if (!strongPassword.test(passwordNuevo)) return false;
    if (passwordNuevo !== passwordNuevo2) return false;
    if (passwordActual === passwordNuevo) return false;
    return true;
  }, [passwordActual, passwordNuevo, passwordNuevo2]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave || saving) return;

    setSaving(true);
    try {
      const resp = await apiFetch<any>('/auth/me/password', {
        method: 'PATCH',
        body: JSON.stringify({ passwordActual, passwordNuevo }),
      });

      if (!resp?.ok) {
        const msg = resp?.error?.message ?? resp?.error ?? 'No se pudo cambiar la contraseña';
        toastErr('No se pudo cambiar', String(msg));
        return;
      }

      toastOk('Contraseña cambiada', 'Por seguridad vas a tener que volver a ingresar.');

      // El backend revoca refresh tokens. Para evitar sesiones “zombies”, cerramos sesión.
      onLogout();
    } catch (err: any) {
      toastErr('Error', String(err?.message || 'Error cambiando contraseña'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="h2" style={{ marginBottom: 10 }}>Seguridad</div>

      <form
        onSubmit={handleSubmit}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 16,
          alignItems: 'end',
        }}
      >
        <div>
          <div className="muted" style={{ marginBottom: 6 }}>Contraseña actual</div>
          <input
            className="input"
            type="password"
            value={passwordActual}
            onChange={(e) => setPasswordActual(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </div>

        <div>
          <div className="muted" style={{ marginBottom: 6 }}>Nueva contraseña</div>
          <input
            className="input"
            type="password"
            value={passwordNuevo}
            onChange={(e) => setPasswordNuevo(e.target.value)}
            placeholder="Mínimo 8 caracteres"
            autoComplete="new-password"
          />
        </div>

        <div>
          <div className="muted" style={{ marginBottom: 6, whiteSpace: 'nowrap' }}>Repetir nueva contraseña</div>
          <input
            className="input"
            type="password"
            value={passwordNuevo2}
            onChange={(e) => setPasswordNuevo2(e.target.value)}
            placeholder="Repetí la nueva contraseña"
            autoComplete="new-password"
          />
        </div>

        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn" type="submit" disabled={!canSave || saving}>
            {saving ? 'Guardando…' : '✅ Cambiar contraseña'}
          </button>

          {!canSave ? (
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              Requisitos:
              <ul style={{ marginTop: 6 }}>
                <li>Mínimo 8 caracteres</li>
                <li>Al menos 1 mayúscula</li>
                <li>Al menos 1 número</li>
                <li>Al menos 1 símbolo</li>
                <li>Distinta a la actual</li>
              </ul>
            </div>
          ) : null}
        </div>
      </form>

      <div style={{ marginTop: 12 }} className="muted">
        Tip: después de cambiarla, iniciá sesión de nuevo en tus dispositivos.
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────── */

function PermisosPanel({ permissions }: { permissions: string[] }) {
  const [q, setQ] = useState('');

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return permissions.slice().sort();
    return permissions.filter((p) => p.toLowerCase().includes(s)).sort();
  }, [permissions, q]);

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div className="h2" style={{ marginBottom: 4 }}>Tus permisos</div>
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            Solo lectura. Si falta alguno, pedilo a un admin.
          </div>
        </div>

        <input
          className="input"
          style={{ maxWidth: 320 }}
          placeholder="Filtrar permisos…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div style={{ marginTop: 12 }}>
        {list.length === 0 ? (
          <div className="muted">No hay permisos para mostrar.</div>
        ) : (
          <div className="grid" style={{ gap: 8 }}>
            {list.map((p) => (
              <div key={p} className="badge" style={{ display: 'inline-flex', alignItems: 'center' }}>
                {p}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
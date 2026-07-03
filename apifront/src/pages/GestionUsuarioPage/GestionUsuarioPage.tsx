// src/pages/GestionUsuarioPage/GestionUsuarioPage.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layout } from '../../components/Layout';
import { useAuth } from '../../auth/AuthProvider';
import { apiFetch, apiFetchBlob } from '../../api/http';
import { useToast } from '../../ui/toast';
import { TablesContent } from '../TablesPage';
import { InfoContent } from '../InfoPage/components/InfoContent';

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

type TabKey = 'perfil' | 'seguridad' | 'permisos' | 'preferencias' | 'tablas' | 'informacion';

// ── Helper para obtener un track de música como blob URL autenticado ──────────
import { getApiBaseUrl } from '../../api/env';

/** Devuelve la URL absoluta del track (solo para referencia). */
export function getScanMusicTrackUrl(filename: string): string {
  return `${getApiBaseUrl()}/user-scan-music/tracks/${encodeURIComponent(filename)}`;
}

/** Obtiene el audio con el token JWT y devuelve un blob URL reproducible. Liberar con URL.revokeObjectURL(). */
export async function fetchScanMusicBlobUrl(filename: string): Promise<string> {
  const blob = await apiFetchBlob(`/user-scan-music/tracks/${encodeURIComponent(filename)}`);
  return URL.createObjectURL(blob);
}

export default function GestionUsuarioPage({ initialTab = 'perfil' }: { initialTab?: TabKey } = {}) {
  const { session, logout, hasPerm } = useAuth();
  const toast = useToast();

  const [tab, setTab] = useState<TabKey>(initialTab);
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
  const canTables = hasPerm('crud:*:read') || hasPerm('crud:*:*');

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
            <button className={`btn ${tab === 'preferencias' ? 'active' : ''}`} onClick={() => setTab('preferencias')}>
              🎵 Preferencias
            </button>
            <button className={`btn ${tab === 'permisos' ? 'active' : ''}`} onClick={() => setTab('permisos')}>
              🧾 Permisos
            </button>
            {canTables && (
              <button className={`btn ${tab === 'tablas' ? 'active' : ''}`} onClick={() => setTab('tablas')}>
                Tablas
              </button>
            )}
            <button className={`btn ${tab === 'informacion' ? 'active' : ''}`} onClick={() => setTab('informacion')}>
              Informacion
            </button>
          </div>
        </div>
      </div>

      {tab === 'tablas' && canTables ? (
        <TablesContent />
      ) : tab === 'informacion' ? (
        <InfoContent />
      ) : loadingMe ? (
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

      {!loadingMe && !meErr && tab === 'preferencias' ? (
        <PreferenciasPanel toastOk={toast.ok} toastErr={toast.error} />
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
          <label htmlFor="gu-pwd-actual" className="muted" style={{ display: 'block', marginBottom: 6 }}>Contraseña actual</label>
          <input
            id="gu-pwd-actual"
            name="passwordActual"
            className="input"
            type="password"
            value={passwordActual}
            onChange={(e) => setPasswordActual(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </div>

        <div>
          <label htmlFor="gu-pwd-nuevo" className="muted" style={{ display: 'block', marginBottom: 6 }}>Nueva contraseña</label>
          <input
            id="gu-pwd-nuevo"
            name="passwordNuevo"
            className="input"
            type="password"
            value={passwordNuevo}
            onChange={(e) => setPasswordNuevo(e.target.value)}
            placeholder="Mínimo 8 caracteres"
            autoComplete="new-password"
          />
        </div>

        <div>
          <label htmlFor="gu-pwd-nuevo2" className="muted" style={{ display: 'block', marginBottom: 6, whiteSpace: 'nowrap' }}>Repetir nueva contraseña</label>
          <input
            id="gu-pwd-nuevo2"
            name="passwordNuevo2"
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

/* ───────────────────────────────────────────────────────────────────────────── */

function PreferenciasPanel({
  toastOk,
  toastErr,
}: {
  toastOk: (t: string, m?: string) => void;
  toastErr: (t: string, m?: string) => void;
}) {
  const [tracks,    setTracks]  = useState<{ filename: string; label: string }[]>([]);
  const [melodia,   setMelodia] = useState('');     // filename seleccionado
  const [volumen,   setVolumen] = useState(0.5);
  const [loading,   setLoading] = useState(true);
  const [saving,    setSaving]  = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Cargar tracks disponibles + preferencia actual
  useEffect(() => {
    Promise.all([
      apiFetch<any>('/user-scan-music/tracks'),
      apiFetch<any>('/user-scan-music/me'),
    ]).then(([tracksRes, meRes]) => {
      if (tracksRes?.ok) setTracks(tracksRes.data || []);
      if (meRes?.ok && meRes?.data) {
        setMelodia(meRes.data.melodia ?? '');
        setVolumen(Number(meRes.data.volumen) || 0.5);
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // Limpiar audio al desmontar
  useEffect(() => () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
  }, []);

  const stopPreview = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
    setPreviewing(false);
  }, []);

  const escuchar = useCallback(async (filename: string) => {
    stopPreview();
    let blobUrl: string | null = null;
    try {
      blobUrl = await fetchScanMusicBlobUrl(filename);
      const audio = new Audio(blobUrl);
      audio.volume = volumen;
      audio.loop   = false;
      audio.onended = () => { setPreviewing(false); URL.revokeObjectURL(blobUrl!); };
      audioRef.current = audio;
      await audio.play();
      setPreviewing(true);
    } catch {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    }
  }, [volumen, stopPreview]);

  const guardar = async () => {
    setSaving(true);
    try {
      const r = await apiFetch<any>('/user-scan-music/me', {
        method: 'PUT',
        body: JSON.stringify({ melodia, volumen }),
      });
      if (!r?.ok) throw new Error(r?.error || 'Error');
      const nombre = tracks.find(t => t.filename === melodia)?.label || melodia || 'Sin música';
      toastOk('✅ Preferencia guardada', `Música: ${nombre}`);
    } catch (e: any) {
      toastErr('No se pudo guardar', e?.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="card" style={{ marginTop: 12 }}>
        <div className="muted">Cargando preferencias…</div>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="h2" style={{ marginBottom: 4 }}>🎵 Música de espera (escaneo)</div>
      <div className="muted" style={{ fontSize: '0.85rem', marginBottom: 18 }}>
        Elegí la música que suena mientras el escáner procesa. Los archivos se toman de la carpeta <code>musicadeespera</code>.
      </div>

      {tracks.length === 0 ? (
        <div className="muted" style={{ marginBottom: 16 }}>
          No hay archivos de música disponibles en la carpeta configurada.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {/* Opción "Sin música" */}
          <label style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
            borderRadius: 10, cursor: 'pointer',
            border: `2px solid ${melodia === '' ? '#7c3aed' : 'rgba(255,255,255,0.1)'}`,
            background: melodia === '' ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.03)',
          }}>
            <input type="radio" name="melodia" value="" checked={melodia === ''} onChange={() => setMelodia('')} />
            <span style={{ fontSize: '1.3rem' }}>🔇</span>
            <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>Sin música</span>
          </label>

          {/* Un radio por cada track */}
          {tracks.map(t => (
            <label key={t.filename} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
              borderRadius: 10, cursor: 'pointer',
              border: `2px solid ${melodia === t.filename ? '#7c3aed' : 'rgba(255,255,255,0.1)'}`,
              background: melodia === t.filename ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.03)',
            }}>
              <input
                type="radio" name="melodia" value={t.filename}
                checked={melodia === t.filename}
                onChange={() => setMelodia(t.filename)}
              />
              <span style={{ fontSize: '1.2rem' }}>🎵</span>
              <span style={{ flex: 1, fontSize: '0.88rem', fontWeight: 500 }}>{t.label}</span>
              <button
                type="button"
                onClick={e => { e.preventDefault(); previewing ? stopPreview() : escuchar(t.filename); }}
                style={{
                  fontSize: '0.72rem', padding: '3px 10px', borderRadius: 6,
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'rgba(255,255,255,0.06)', color: '#94a3b8', cursor: 'pointer',
                }}
              >
                {previewing && melodia === t.filename ? '⏹ Parar' : '▶ Escuchar'}
              </button>
            </label>
          ))}
        </div>
      )}

      {/* Volumen */}
      <div style={{ marginBottom: 20 }}>
        <label className="muted" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 6 }}>
          Volumen: {Math.round(volumen * 100)}%
        </label>
        <input
          type="range" min={0} max={1} step={0.05}
          value={volumen}
          onChange={e => {
            const v = Number(e.target.value);
            setVolumen(v);
            if (audioRef.current) audioRef.current.volume = v;
          }}
          style={{ width: '100%', maxWidth: 340 }}
        />
      </div>

      <button className="btn" onClick={guardar} disabled={saving}>
        {saving ? '⏳ Guardando…' : '💾 Guardar preferencia'}
      </button>
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
          id="gu-filtro-permisos"
          name="filtroPermisos"
          className="input"
          style={{ maxWidth: 320 }}
          placeholder="Filtrar permisos…"
          aria-label="Filtrar permisos"
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

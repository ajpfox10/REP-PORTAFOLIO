// src/pages/AdminPage/components/SolicitudesTab.tsx
import React, { useState } from 'react';
import type { Role } from '../hooks/useAdminUsers';
import type { AccessRequest } from '../hooks/usePendingRequests';

// ─── Modal: Aprobar solicitud ─────────────────────────────────────────────────
function ApproveModal({
  request,
  roles,
  saving,
  onClose,
  onSubmit,
}: {
  request: AccessRequest;
  roles: Role[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (password: string, rolId: number | null) => void;
}) {
  const [password, setPassword] = useState(() => {
    // Genera contraseña automática: 3 palabras + número
    const adj = ['Solar','Luna','Río','Viento','Monte','Cielo','Bravo','Fino','Verde','Claro'];
    const noun = ['Gato','Pino','Roca','Mar','Flor','Arco','Toro','Vela','León','Nube'];
    const a = adj[Math.floor(Math.random() * adj.length)];
    const n = noun[Math.floor(Math.random() * noun.length)];
    const num = Math.floor(10 + Math.random() * 90);
    return `${a}${n}${num}`;
  });
  const [showPass, setShowPass] = useState(true);
  const [rolId, setRolId] = useState<number | null>(null);

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <p className="modal-title">✅ Aprobar solicitud</p>
        <p style={{ color: '#555', fontSize: '0.9rem', marginBottom: '1rem' }}>
          Se creará el usuario <strong>{request.email}</strong> y recibirá sus credenciales por email.
        </p>

        <div className="form-grid">
          <div className="form-field full">
            <label>Nombre</label>
            <input value={request.nombre} disabled style={{ background: '#f1f5f9' }} />
          </div>
          <div className="form-field full">
            <label>Email</label>
            <input value={request.email} disabled style={{ background: '#f1f5f9' }} />
          </div>
          {request.motivo && (
            <div className="form-field full">
              <label>Motivo</label>
              <textarea value={request.motivo} disabled rows={2}
                style={{ background: '#f1f5f9', resize: 'none' }} />
            </div>
          )}
          <div className="form-field full">
            <label>Contraseña inicial * (mín. 8 caracteres)</label>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input
                type={showPass ? 'text' : 'password'}
                value={password}
                placeholder="••••••••"
                style={{ flex: 1 }}
                onChange={e => setPassword(e.target.value)}
              />
              <button type="button" className="btn-icon" onClick={() => setShowPass(v => !v)}>
                {showPass ? '🙈' : '👁️'}
              </button>
            </div>
          </div>
          <div className="form-field full">
            <label>Rol inicial *</label>
            <select value={rolId ?? ''} onChange={e => setRolId(e.target.value ? Number(e.target.value) : null)}>
              <option value="" disabled>— Seleccioná un rol —</option>
              {roles.map(r => (
                <option key={r.id} value={r.id}>
                  {r.nombre}{r.descripcion ? ` · ${r.descripcion}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
          <button
            className="btn btn-primary"
            disabled={saving || password.length < 8 || !rolId}
            onClick={() => onSubmit(password, rolId)}
          >
            {saving ? '⏳ Aprobando…' : '✅ Aprobar y crear usuario'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Badge de estado ──────────────────────────────────────────────────────────
function StatusBadge({ request }: { request: AccessRequest }) {
  if (request.approved) {
    return (
      <span style={{
        padding: '2px 10px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 700,
        background: '#dcfce7', color: '#166534',
      }}>✓ Aprobado</span>
    );
  }
  if (request.confirmed) {
    return (
      <span style={{
        padding: '2px 10px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 700,
        background: '#fef9c3', color: '#854d0e',
      }}>⏳ Pendiente</span>
    );
  }
  // Verificar si expiró
  const expired = request.expira && new Date(request.expira) < new Date();
  return (
    <span style={{
      padding: '2px 10px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 700,
      background: expired ? '#fee2e2' : '#f1f5f9',
      color: expired ? '#991b1b' : '#475569',
    }}>
      {expired ? '✗ Expirado' : '📧 Sin confirmar'}
    </span>
  );
}

// ─── Tab principal ────────────────────────────────────────────────────────────
export function SolicitudesTab({
  requests,
  roles,
  loading,
  saving,
  onRefresh,
  onApprove,
}: {
  requests: AccessRequest[];
  roles: Role[];
  loading: boolean;
  saving: boolean;
  onRefresh: () => void;
  onApprove: (auditLogId: number, password: string, rolId: number | null) => void;
}) {
  const [selected, setSelected] = useState<AccessRequest | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved'>('pending');

  const filtered = requests.filter(r => {
    if (filter === 'pending') return r.confirmed && !r.approved;
    if (filter === 'approved') return r.approved;
    return true;
  });

  const pendingCount = requests.filter(r => r.confirmed && !r.approved).length;

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['pending', 'all', 'approved'] as const).map(f => (
            <button
              key={f}
              className={`btn${filter === f ? ' btn-primary' : ''}`}
              onClick={() => setFilter(f)}
              style={{ fontSize: '0.82rem' }}
            >
              {f === 'pending' ? `⏳ Pendientes${pendingCount ? ` (${pendingCount})` : ''}` :
               f === 'approved' ? '✓ Aprobadas' : '📋 Todas'}
            </button>
          ))}
        </div>
        <button className="btn" onClick={onRefresh} disabled={loading} style={{ marginLeft: 'auto' }}>
          {loading ? '⏳' : '🔄'} Actualizar
        </button>
      </div>

      {/* Tabla */}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Email</th>
              <th>Motivo</th>
              <th>Fecha solicitud</th>
              <th>Estado</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id}>
                <td style={{ fontWeight: 500 }}>{r.nombre || '—'}</td>
                <td style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{r.email}</td>
                <td style={{ maxWidth: 200, color: '#64748b', fontSize: '0.82rem' }}>
                  {r.motivo ? (
                    <span title={r.motivo}>
                      {r.motivo.length > 40 ? r.motivo.substring(0, 40) + '…' : r.motivo}
                    </span>
                  ) : '—'}
                </td>
                <td style={{ color: '#94a3b8', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                  {new Date(r.created_at).toLocaleDateString('es-AR')}{' '}
                  {new Date(r.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                </td>
                <td><StatusBadge request={r} /></td>
                <td>
                  {r.confirmed && !r.approved ? (
                    <button className="btn btn-primary btn-sm" onClick={() => setSelected(r)}>
                      ✅ Aprobar
                    </button>
                  ) : r.approved ? (
                    <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                      {r.approved_at ? new Date(r.approved_at).toLocaleDateString('es-AR') : '—'}
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>—</span>
                  )}
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', color: '#9ca3af', padding: '2rem' }}>
                  {loading ? '⏳ Cargando…' : filter === 'pending' ? 'No hay solicitudes pendientes' : 'Sin resultados'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal aprobar */}
      {selected && (
        <ApproveModal
          request={selected}
          roles={roles}
          saving={saving}
          onClose={() => setSelected(null)}
          onSubmit={(password, rolId) => {
            onApprove(selected.id, password, rolId);
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}

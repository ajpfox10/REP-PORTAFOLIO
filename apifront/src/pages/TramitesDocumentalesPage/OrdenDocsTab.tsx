// src/pages/TramitesDocumentalesPage/OrdenDocsTab.tsx
// Pestana "Orden de documentos": administra la orden de trabajo (tabla
// orden_documentos_expediente). Permite, por ley, editar el nombre/observacion,
// reordenar con flechas y activar/desactivar cada requisito. Los cambios son
// locales hasta "Guardar cambios" (reordenar + PATCH por fila modificada).
import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

interface OrdenRow {
  id: number;
  proceso: string;
  ley: string;
  orden: number;
  documento: string;
  observacion: string | null;
  activo: number; // 1 | 0
}

export function OrdenDocsTab() {
  const toast = useToast();
  const [proceso, setProceso] = useState('PASE A TRANSITORIA');
  const [leyes, setLeyes] = useState<string[]>([]);
  const [ley, setLey] = useState<string>('');
  const [orig, setOrig] = useState<OrdenRow[]>([]); // snapshot de la ley actual
  const [rows, setRows] = useState<OrdenRow[]>([]); // estado editable
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load(selLey?: string) {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ proceso });
      const l = selLey ?? ley;
      if (l) qs.set('ley', l);
      const res = await apiFetch<{ ok: boolean; data: { rows: OrdenRow[]; leyes: string[]; proceso: string } }>(
        `/tramites-documentales/orden-docs?${qs.toString()}`
      );
      const data = res.data;
      setLeyes(data.leyes);
      const effectiveLey = l || data.leyes[0] || '';
      if (!l && effectiveLey) setLey(effectiveLey);
      const filtered = data.rows.filter((r) => r.ley === effectiveLey).sort((a, b) => a.orden - b.orden);
      setOrig(filtered);
      setRows(filtered.map((r) => ({ ...r })));
    } catch (e: any) {
      toast.error('No se pudo cargar el orden de documentos', e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const dirty = useMemo(() => JSON.stringify(rows) !== JSON.stringify(orig), [rows, orig]);

  function selectLey(l: string) {
    if (dirty && !window.confirm('Hay cambios sin guardar. ¿Descartar y cambiar de ley?')) return;
    setLey(l);
    load(l);
  }

  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= rows.length) return;
    setRows((prev) => {
      const next = prev.slice();
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }

  function patchRow(id: number, patch: Partial<OrdenRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function save() {
    setSaving(true);
    try {
      // 1) Reordenar si cambio la secuencia de ids.
      const idsNow = rows.map((r) => r.id);
      const idsOrig = orig.map((r) => r.id);
      if (JSON.stringify(idsNow) !== JSON.stringify(idsOrig)) {
        await apiFetch('/tramites-documentales/orden-docs/reordenar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proceso, ley, ids: idsNow }),
        });
      }
      // 2) PATCH por fila con cambios de contenido.
      const origById = new Map(orig.map((r) => [r.id, r]));
      for (const r of rows) {
        const o = origById.get(r.id);
        if (!o) continue;
        const patch: Record<string, unknown> = {};
        if (r.documento.trim() !== o.documento) patch.documento = r.documento.trim();
        if ((r.observacion || '') !== (o.observacion || '')) patch.observacion = r.observacion || '';
        if (r.activo !== o.activo) patch.activo = !!r.activo;
        if (Object.keys(patch).length) {
          await apiFetch(`/tramites-documentales/orden-docs/${r.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          });
        }
      }
      toast.ok('Guardado', 'El orden de documentos se actualizó.');
      await load(ley);
    } catch (e: any) {
      toast.error('No se pudo guardar', e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  }

  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.12)', textTransform: 'uppercase', letterSpacing: '0.03em' };
  const td: React.CSSProperties = { padding: '6px 10px', fontSize: '0.82rem', borderBottom: '1px solid rgba(255,255,255,0.06)', verticalAlign: 'middle' };
  const inputStyle: React.CSSProperties = { width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: '#e2e8f0', padding: '5px 8px', fontSize: '0.82rem' };
  const iconBtn: React.CSSProperties = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: '#cbd5e1', cursor: 'pointer', width: 26, height: 24, lineHeight: '1', fontSize: '0.75rem' };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Proceso:</span>
        <strong style={{ fontSize: '0.85rem', color: '#e2e8f0' }}>{proceso}</strong>
        <span style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.12)' }} />
        <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Ley:</span>
        {leyes.map((l) => (
          <button key={l} type="button" onClick={() => selectLey(l)}
            style={{
              padding: '5px 14px', borderRadius: 999, fontSize: '0.78rem', cursor: 'pointer',
              border: '1px solid ' + (ley === l ? '#7c3aed' : 'rgba(255,255,255,0.15)'),
              background: ley === l ? 'rgba(124,58,237,0.25)' : 'transparent',
              color: ley === l ? '#fff' : '#94a3b8', fontWeight: ley === l ? 700 : 400,
            }}>
            {l}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button type="button" onClick={save} disabled={!dirty || saving}
          style={{
            padding: '7px 18px', borderRadius: 8, fontSize: '0.82rem', fontWeight: 700,
            border: 'none', cursor: dirty && !saving ? 'pointer' : 'not-allowed',
            background: dirty && !saving ? '#7c3aed' : 'rgba(255,255,255,0.08)',
            color: dirty && !saving ? '#fff' : '#64748b',
          }}>
          {saving ? 'Guardando…' : dirty ? '💾 Guardar cambios' : 'Sin cambios'}
        </button>
      </div>

      {loading ? (
        <div style={{ color: '#94a3b8', fontSize: '0.85rem', padding: 20 }}>Cargando…</div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 44 }}>#</th>
                <th style={{ ...th, width: 92 }}>Orden</th>
                <th style={th}>Documento</th>
                <th style={th}>Observación</th>
                <th style={{ ...th, width: 96, textAlign: 'center' }}>Activo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const off = !r.activo;
                return (
                  <tr key={r.id} style={{ opacity: off ? 0.45 : 1, background: off ? 'rgba(239,68,68,0.05)' : 'transparent' }}>
                    <td style={{ ...td, color: '#64748b', textAlign: 'center' }}>{idx + 1}</td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button type="button" style={{ ...iconBtn, opacity: idx === 0 ? 0.3 : 1 }} disabled={idx === 0} onClick={() => move(idx, -1)} title="Subir">↑</button>
                        <button type="button" style={{ ...iconBtn, opacity: idx === rows.length - 1 ? 0.3 : 1 }} disabled={idx === rows.length - 1} onClick={() => move(idx, 1)} title="Bajar">↓</button>
                      </div>
                    </td>
                    <td style={td}>
                      <input style={inputStyle} value={r.documento} onChange={(e) => patchRow(r.id, { documento: e.target.value })} />
                    </td>
                    <td style={td}>
                      <input style={inputStyle} value={r.observacion || ''} placeholder="—"
                        onChange={(e) => patchRow(r.id, { observacion: e.target.value })} />
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.72rem', color: off ? '#f87171' : '#34d399' }}>
                        <input type="checkbox" checked={!!r.activo} onChange={(e) => patchRow(r.id, { activo: e.target.checked ? 1 : 0 })} />
                        {off ? 'Inactivo' : 'Activo'}
                      </label>
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr><td colSpan={5} style={{ ...td, color: '#64748b', textAlign: 'center', padding: 20 }}>Sin documentos para esta ley.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ marginTop: 10, fontSize: '0.72rem', color: '#64748b' }}>
        Las flechas cambian el orden; desactivar un requisito lo apaga sin borrarlo. Los cambios se aplican al presionar «Guardar cambios».
      </p>
    </div>
  );
}

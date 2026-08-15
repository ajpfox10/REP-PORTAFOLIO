// src/pages/TramitesDocumentalesPage/FaltantesTab.tsx
// Pestaña "Documentación incompleta": por tanda, muestra qué agentes tienen
// subcarpetas de documento SIN archivo (pdf/tiff/jpg/png/bmp) y qué les falta.
// Solo lista los incompletos.
import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { exportToExcel } from '../../utils/export';

type Incompleto = { dni: number; nombre: string; ley: string; sinCarpeta: boolean; faltan: string[]; completos: number; total: number };
type Data = { tanda: string; totalAgentes: number; incompletos: Incompleto[]; sinLey: { dni: number; nombre: string }[]; completos: number };

export function FaltantesTab() {
  const toast = useToast();
  const [tandas, setTandas] = useState<string[]>([]);
  const [conteos, setConteos] = useState<Map<string, number>>(new Map());
  const [selectedTanda, setSelectedTanda] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch<{ ok: boolean; data: { rows: { tanda: string }[]; tandas: string[] } }>('/tramites-documentales/tandas');
        const m = new Map<string, number>();
        for (const r of res.data.rows) m.set(r.tanda, (m.get(r.tanda) || 0) + 1);
        setConteos(m);
        setTandas(res.data.tandas || []);
      } catch (e: any) { toast.error('No se pudieron cargar tandas', e?.message || 'Error'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function analizar(tanda: string) {
    setSelectedTanda(tanda); setData(null); setLoading(true);
    try {
      const res = await apiFetch<{ ok: boolean; data: Data }>(`/tramites-documentales/faltantes?tanda=${encodeURIComponent(tanda)}`);
      setData(res.data);
    } catch (e: any) {
      toast.error('No se pudo analizar', e?.message || 'Error');
    } finally { setLoading(false); }
  }

  // Prepara la subcarpeta del documento (o la del agente) en DOCU y copia la ruta de RED
  // (UNC) al portapapeles. El Explorador no se puede abrir desde el servidor (la API vive
  // aislada del escritorio), así que el usuario pega la ruta en su propio Explorador (Win+E, Ctrl+V).
  async function abrirCarpeta(dni: number, doc?: string) {
    try {
      const res = await apiFetch<{ ok: boolean; data: { uncRel: string; ruta: string; creada: boolean } }>('/tramites-documentales/abrir-carpeta', {
        method: 'POST',
        body: JSON.stringify(doc ? { dni, doc } : { dni }),
      });
      // La ruta de red usa el host por el que estás entrando (así anda en cualquier red).
      const unc = `\\\\${window.location.hostname}\\${res.data.uncRel}`;

      // 1) Intento abrir solo, vía el handler "p5abrir:" instalado en la PC (ver
      //    carpeta abrir-carpeta-handler). Si no está instalado, no pasa nada.
      try {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = `p5abrir:${encodeURIComponent(unc)}`;
        document.body.appendChild(iframe);
        window.setTimeout(() => { try { document.body.removeChild(iframe); } catch { /* noop */ } }, 1500);
      } catch { /* noop */ }

      // 2) Igual copio la ruta al portapapeles, como respaldo (si el handler no está instalado).
      let copiado = false;
      try {
        await navigator.clipboard.writeText(unc);
        copiado = true;
      } catch {
        // Fallback si el navegador bloquea el portapapeles (contexto no seguro, etc.).
        const ta = document.createElement('textarea');
        ta.value = unc; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        try { copiado = document.execCommand('copy'); } catch { copiado = false; }
        document.body.removeChild(ta);
      }
      toast.ok(
        copiado ? 'Abriendo carpeta… (si no abre sola, la ruta ya está copiada: Ctrl+V en el Explorador)' : 'Copiá esta ruta en el Explorador',
        unc,
      );
    } catch (e: any) {
      toast.error('No se pudo preparar la carpeta', e?.message || 'Error');
    }
  }

  function exportar() {
    if (!data) return;
    const rows = data.incompletos.map((a) => ({
      DNI: a.dni, Agente: a.nombre, Ley: a.ley,
      'Tiene carpeta': a.sinCarpeta ? 'NO' : 'SI',
      Completos: a.completos, Total: a.total, Faltan: a.faltan.length,
      Documentos_faltantes: a.faltan.join(' | '),
    }));
    exportToExcel(`faltantes_${data.tanda}`, rows);
  }

  const chip: React.CSSProperties = { padding: '5px 14px', borderRadius: 999, fontSize: '0.78rem', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.15)' };
  const docChip: React.CSSProperties = { padding: '2px 8px', borderRadius: 6, fontSize: '0.72rem', background: 'rgba(239,68,68,0.14)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <span style={{ color: '#94a3b8', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase' }}>Tanda</span>
        {tandas.map((t) => (
          <button key={t} type="button" onClick={() => void analizar(t)}
            style={{ ...chip, background: selectedTanda === t ? '#7c3aed' : 'rgba(255,255,255,0.05)', color: selectedTanda === t ? '#fff' : '#cbd5e1' }}>
            {t} <span style={{ opacity: 0.7 }}>({conteos.get(t) || 0})</span>
          </button>
        ))}
        {!tandas.length && <span style={{ color: '#64748b', fontSize: '0.82rem' }}>No hay tandas.</span>}
        <div style={{ flex: 1 }} />
        {data && data.incompletos.length > 0 && (
          <button type="button" onClick={exportar}
            style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#cbd5e1', fontSize: '0.78rem', cursor: 'pointer' }}>
            ⬇ Exportar
          </button>
        )}
      </div>

      {loading && <div style={{ color: '#94a3b8', fontSize: '0.85rem', padding: 20 }}>Analizando…</div>}

      {!loading && !data && <div style={{ color: '#64748b', fontSize: '0.85rem', padding: 20 }}>Elegí una tanda para ver la documentación incompleta.</div>}

      {!loading && data && (
        <>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14, fontSize: '0.82rem' }}>
            <span style={{ color: '#e2e8f0' }}><strong>{data.totalAgentes}</strong> agentes</span>
            <span style={{ color: '#f87171' }}><strong>{data.incompletos.length}</strong> incompletos</span>
            <span style={{ color: '#34d399' }}><strong>{data.completos}</strong> completos</span>
            {data.sinLey.length > 0 && <span style={{ color: '#fbbf24' }}><strong>{data.sinLey.length}</strong> sin ley</span>}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.incompletos.map((a) => (
              <div key={a.dni} style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '10px 12px', background: 'rgba(255,255,255,0.02)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                  <strong style={{ color: '#e2e8f0', fontSize: '0.85rem' }}>{a.nombre}</strong>
                  <button type="button" onClick={() => void abrirCarpeta(a.dni)} title="Copiar la ruta de la carpeta del agente (pegar en el Explorador)"
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#7dd3fc', fontSize: '0.75rem', textDecoration: 'underline' }}>
                    DNI {a.dni}
                  </button>
                  <span style={{ color: '#94a3b8', fontSize: '0.72rem' }}>ley {a.ley}</span>
                  {a.sinCarpeta
                    ? <span style={{ color: '#f87171', fontSize: '0.72rem', fontWeight: 700 }}>SIN CARPETA EN DOCU</span>
                    : <span style={{ color: '#94a3b8', fontSize: '0.72rem' }}>{a.completos}/{a.total} · faltan {a.faltan.length}</span>}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {a.faltan.map((d) => (
                    <button key={d} type="button" onClick={() => void abrirCarpeta(a.dni, d)}
                      title={`Copiar la ruta de la subcarpeta "${d}" (pegar en el Explorador)`}
                      style={{ ...docChip, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!data.incompletos.length && <div style={{ color: '#34d399', fontSize: '0.85rem', padding: 20 }}>✅ Todos los agentes de la tanda tienen su documentación completa.</div>}
          </div>

          {data.sinLey.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ color: '#fbbf24', fontSize: '0.75rem', fontWeight: 700, marginBottom: 6 }}>Sin ley detectada (no se pueden evaluar)</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {data.sinLey.map((s) => <span key={s.dni} style={{ ...docChip, background: 'rgba(251,191,36,0.14)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)' }}>{s.nombre} ({s.dni})</span>)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

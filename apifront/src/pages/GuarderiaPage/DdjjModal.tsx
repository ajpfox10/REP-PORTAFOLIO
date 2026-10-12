// src/pages/GuarderiaPage/DdjjModal.tsx
// Modal de la DDJJ para Reintegro de Guardería y/o Jardín Maternal: mismos campos que el PDF
// oficial (IF-2024-18854671-GDEBA). Se guarda en guarderia_ddjj (+ menores) y se imprime
// sobre el PDF original desde la API (GET /guarderia-ddjj/:dni/pdf).
import React, { useEffect, useState } from 'react';
import { apiFetch, apiFetchBlob } from '../../api/http';
import { useToast } from '../../ui/toast';

type Ddjj = Record<string, string | null>;
type Menor = {
  apellido_nombre: string; documento: string; fecha_nacimiento: string;
  patologia: '' | '0' | '1'; atencion_temporaria: string; atencion_permanente: string;
};

const MENOR_VACIO: Menor = {
  apellido_nombre: '', documento: '', fecha_nacimiento: '', patologia: '',
  atencion_temporaria: '', atencion_permanente: '',
};

const aMenor = (m: any): Menor => ({
  apellido_nombre: m?.apellido_nombre ?? '',
  documento: m?.documento ?? '',
  fecha_nacimiento: (m?.fecha_nacimiento ?? '').slice(0, 10),
  patologia: m?.patologia === null || m?.patologia === undefined ? '' : (Number(m.patologia) ? '1' : '0'),
  atencion_temporaria: m?.atencion_temporaria ?? '',
  atencion_permanente: m?.atencion_permanente ?? '',
});

export function DdjjModal({ dni, nombre, onClose }: { dni: string; nombre: string; onClose: () => void }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [guardada, setGuardada] = useState(false);
  const [d, setD] = useState<Ddjj>({});
  const [menores, setMenores] = useState<Menor[]>([{ ...MENOR_VACIO }]);
  // fecha de reintegro según el anual del Ministerio (fin del RN1 / maternidad + 1)
  const [reintegro, setReintegro] = useState<{ fecha: string; novedad: string; hasta: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch<any>(`/guarderia-ddjj/${dni}`);
        setGuardada(!!res?.guardada);
        setReintegro(res?.reintegro ?? null);
        setD(res?.data?.ddjj ?? {});
        const ms = (res?.data?.menores ?? []).map(aMenor);
        setMenores(ms.length ? ms : [{ ...MENOR_VACIO }]);
      } catch (e: any) {
        toast.error('Error', e?.message);
        onClose();
      } finally { setLoading(false); }
    })();
  }, [dni]);

  const v = (k: string) => d[k] ?? '';
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setD(prev => ({ ...prev, [k]: e.target.value }));
  const setMenor = (i: number, k: keyof Menor, val: string) =>
    setMenores(prev => prev.map((m, j) => (j === i ? { ...m, [k]: val } : m)));

  const guardar = async (): Promise<boolean> => {
    setSaving(true);
    try {
      await apiFetch(`/guarderia-ddjj/${dni}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...d,
          menores: menores.map(m => ({ ...m, patologia: m.patologia === '' ? null : Number(m.patologia) })),
        }),
      });
      setGuardada(true);
      return true;
    } catch (e: any) {
      toast.error('Error al guardar', e?.message);
      return false;
    } finally { setSaving(false); }
  };

  const onGuardar = async () => { if (await guardar()) toast.ok('Guardada', 'DDJJ de guardería guardada.'); };

  // Guarda y abre el PDF (la ventana se abre antes del await para que no la bloquee el navegador)
  const onImprimir = async () => {
    const w = window.open('', '_blank');
    if (!w) { toast.error('El navegador bloqueó la ventana del PDF'); return; }
    w.document.write('<p style="font-family:sans-serif">Generando la DDJJ…</p>');
    if (!(await guardar())) { w.close(); return; }
    try {
      const blob = await apiFetchBlob(`/guarderia-ddjj/${dni}/pdf`);
      w.location.href = URL.createObjectURL(blob);
    } catch (e: any) {
      w.close();
      toast.error('No se pudo generar el PDF', e?.message);
    }
  };

  const txt = (label: string, k: string, ph?: string) => (
    <div style={fg}>
      <label style={lbl}>{label}</label>
      <input className="input" value={v(k)} onChange={set(k)} placeholder={ph} />
    </div>
  );
  const date = (label: string, k: string) => (
    <div style={fg}>
      <label style={lbl}>{label}</label>
      <input className="input" type="date" value={(v(k) || '').slice(0, 10)} onChange={set(k)} />
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#1e1e2e', borderRadius: 14, padding: 24, width: '100%', maxWidth: 860, maxHeight: '92vh', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 40px rgba(0,0,0,0.6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700 }}>📄 DDJJ Reintegro de Guardería y/o Jardín Maternal</div>
            <div className="muted" style={{ fontSize: '0.8rem', marginTop: 2 }}>
              {nombre} · DNI {dni} · {loading ? 'cargando…' : guardada ? 'DDJJ guardada' : 'nueva (precargada con los datos del sistema)'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '1.2rem', padding: 0 }}>✕</button>
        </div>

        {!loading && (
          <>
            <div style={sec}>Datos del agente</div>
            <div style={grid}>
              <div style={{ ...fg, gridColumn: '1 / -1' }}>
                <label style={lbl}>Repartición</label>
                <input className="input" value={v('reparticion')} onChange={set('reparticion')} />
              </div>
              {txt('Apellido y nombre', 'apellido_nombre')}
              {txt('Número de documento', 'documento')}
              {date('Fecha de nacimiento', 'fecha_nacimiento')}
              {txt('Estado civil', 'estado_civil')}
              {txt('Nacionalidad', 'nacionalidad')}
              {txt('Número de legajo', 'legajo')}
              {txt('Cargo de revista', 'cargo')}
              {txt('Horario', 'horario')}
              <div style={{ ...fg, gridColumn: '1 / -1' }}>
                <label style={lbl}>Domicilio particular</label>
                <input className="input" value={v('domicilio')} onChange={set('domicilio')} />
              </div>
              <div style={fg}>
                <label style={lbl}>Fecha de reintegro después de licencia por maternidad</label>
                <input className="input" type="date" value={(v('fecha_reintegro') || '').slice(0, 10)} onChange={set('fecha_reintegro')} />
                {reintegro ? (
                  <span style={{ fontSize: '0.72rem', color: '#5eead4' }}>
                    Según Ministerio: {reintegro.novedad} hasta {fmtDma(reintegro.hasta)} → {fmtDma(reintegro.fecha)}
                    {(v('fecha_reintegro') || '').slice(0, 10) !== reintegro.fecha && (
                      <button type="button" onClick={() => setD(prev => ({ ...prev, fecha_reintegro: reintegro.fecha }))}
                        style={{ marginLeft: 6, background: 'none', border: 'none', color: '#5eead4', textDecoration: 'underline', cursor: 'pointer', fontSize: '0.72rem', padding: 0 }}>
                        usar
                      </button>
                    )}
                  </span>
                ) : (
                  <span className="muted" style={{ fontSize: '0.72rem' }}>Sin RN1 ni maternidad en el anual del Ministerio</span>
                )}
              </div>
              {txt('Quién tiene los niños a cargo', 'ninos_a_cargo')}
              <div style={{ ...fg, gridColumn: '1 / -1' }}>
                <label style={lbl}>En caso de tutela, tenencia, guarda: condición</label>
                <input className="input" value={v('condicion_tutela')} onChange={set('condicion_tutela')} />
              </div>
              <div style={{ ...fg, gridColumn: '1 / -1' }}>
                <label style={lbl}>Motivo por el cual no ingresa al jardín maternal / guardería</label>
                <input className="input" maxLength={300} value={v('motivo_no_ingresa')} onChange={set('motivo_no_ingresa')} />
              </div>
            </div>

            <div style={sec}>Datos del otro progenitor</div>
            <div style={grid}>
              {txt('Apellido y nombre', 'otro_apellido_nombre')}
              {txt('Número de documento', 'otro_documento')}
              <div style={{ ...fg, gridColumn: '1 / -1' }}>
                <label style={lbl}>Domicilio particular</label>
                <input className="input" value={v('otro_domicilio')} onChange={set('otro_domicilio')} />
              </div>
              {date('Fecha de nacimiento', 'otro_fecha_nacimiento')}
              {txt('Estado civil', 'otro_estado_civil')}
              {txt('Nacionalidad', 'otro_nacionalidad')}
              {txt('Lugar de trabajo', 'otro_lugar_trabajo')}
            </div>

            <div style={{ ...sec, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Menores hasta 4 años</span>
              <button className="btn" type="button" style={{ fontSize: '0.75rem', padding: '3px 10px' }}
                onClick={() => setMenores(prev => [...prev, { ...MENOR_VACIO }])}>➕ Agregar menor</button>
            </div>
            {menores.map((m, i) => (
              <div key={i} style={{ padding: '10px 12px', marginBottom: 10, borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.8rem' }}>
                  <strong>Menor {i + 1}{i >= 2 ? ' (va en hoja anexa)' : ''}</strong>
                  {menores.length > 1 && (
                    <button type="button" onClick={() => setMenores(prev => prev.filter((_, j) => j !== i))}
                      style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '0.78rem' }}>🗑 Quitar</button>
                  )}
                </div>
                <div style={grid}>
                  <div style={fg}>
                    <label style={lbl}>Apellido y nombre</label>
                    <input className="input" value={m.apellido_nombre} onChange={e => setMenor(i, 'apellido_nombre', e.target.value)} />
                  </div>
                  <div style={fg}>
                    <label style={lbl}>Número de documento</label>
                    <input className="input" value={m.documento} onChange={e => setMenor(i, 'documento', e.target.value)} />
                  </div>
                  <div style={fg}>
                    <label style={lbl}>Fecha de nacimiento</label>
                    <input className="input" type="date" value={m.fecha_nacimiento} onChange={e => setMenor(i, 'fecha_nacimiento', e.target.value)} />
                  </div>
                  <div style={fg}>
                    <label style={lbl}>¿Presenta patología que necesite atención especial?</label>
                    <select className="input" value={m.patologia} onChange={e => setMenor(i, 'patologia', e.target.value)}>
                      <option value="">— sin marcar —</option>
                      <option value="1">SI</option>
                      <option value="0">NO</option>
                    </select>
                  </div>
                  {m.patologia === '1' && (
                    <>
                      <div style={fg}>
                        <label style={lbl}>Atención especial temporaria</label>
                        <input className="input" value={m.atencion_temporaria} onChange={e => setMenor(i, 'atencion_temporaria', e.target.value)} />
                      </div>
                      <div style={fg}>
                        <label style={lbl}>Atención especial permanente</label>
                        <input className="input" value={m.atencion_permanente} onChange={e => setMenor(i, 'atencion_permanente', e.target.value)} />
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}

            <div style={sec}>Firma</div>
            <div style={grid}>
              {txt('Aclaración (agente)', 'firma_aclaracion')}
              {txt('Lugar', 'lugar')}
              {date('Fecha', 'fecha')}
              {txt('Certifico que la firma pertenece a', 'certifica_pertenece')}
              {txt('Aclaración de quien certifica', 'certifica_aclaracion')}
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
              <button type="button" className="btn" onClick={onClose} style={{ opacity: 0.7 }}>Cerrar</button>
              <button type="button" className="btn" onClick={onGuardar} disabled={saving}>{saving ? 'Guardando...' : '💾 Guardar'}</button>
              <button type="button" className="btn" onClick={onImprimir} disabled={saving}
                style={{ background: 'rgba(20,184,166,0.25)', color: '#5eead4' }}>🖨️ Guardar e imprimir</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const fmtDma = (s: string) => { const [y, m, d] = s.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };

const fg: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const lbl: React.CSSProperties = { fontSize: '0.78rem', color: 'rgba(255,255,255,0.7)' };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, marginBottom: 6 };
const sec: React.CSSProperties = { fontWeight: 700, color: '#818cf8', fontSize: '0.85rem', margin: '14px 0 8px', paddingBottom: 4, borderBottom: '1px solid rgba(255,255,255,0.08)' };

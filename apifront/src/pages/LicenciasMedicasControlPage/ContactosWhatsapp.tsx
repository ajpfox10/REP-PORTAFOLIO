// src/pages/LicenciasMedicasControlPage/ContactosWhatsapp.tsx
// "📇 Contactos de WhatsApp": baja la agenda del WhatsApp Web abierto (vía la extensión, acción
// CONTACTOS) y la cruza por número con los celulares de los agentes activos
// (GET /licencias-medicas-control/whatsapp/celulares). Sirve para ver quién está mal agendado
// (la búsqueda por nombre depende de cómo esté agendado cada uno) y quién no está agendado.
import { useMemo, useState } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { exportToExcel } from '../../utils/export';
import { normTxt } from './shared';

interface ContactoWa { numero: string; nombre: string; pushname: string; agendado: boolean }
interface AgenteCel { dni: string; apellido: string; nombre: string; telefono: string; celular: string | null; dudoso: boolean }
type Estado = 'OK' | 'PARCIAL' | 'MAL' | 'NO_AGENDADO' | 'SIN_AGENTE';
interface Fila { estado: Estado; numero: string; nombreWa: string; pushname: string; agente: AgenteCel | null }

const ESTADOS: Record<Estado, { txt: string; color: string; ayuda: string }> = {
  MAL: { txt: '❌ Mal agendado', color: 'rgba(239,68,68,0.25)', ayuda: 'El número es de un agente pero el nombre agendado no tiene ni su apellido ni su nombre' },
  PARCIAL: { txt: '⚠️ Parcial', color: 'rgba(234,179,8,0.25)', ayuda: 'Tiene el apellido o el nombre, pero no los dos: la búsqueda por nombre no lo va a encontrar' },
  OK: { txt: '✅ Bien', color: 'rgba(34,197,94,0.22)', ayuda: 'Agendado con apellido y nombre' },
  NO_AGENDADO: { txt: '📵 No agendado', color: 'rgba(100,116,139,0.3)', ayuda: 'Agente activo con celular en la base que no está en la agenda' },
  SIN_AGENTE: { txt: 'Sin agente', color: 'rgba(100,116,139,0.18)', ayuda: 'Contacto de WhatsApp cuyo número no es de ningún agente activo' },
};
const ORDEN: Estado[] = ['MAL', 'PARCIAL', 'NO_AGENDADO', 'OK', 'SIN_AGENTE'];

const tokens = (s: string) => normTxt(s).replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
const primera = (s: string) => tokens(s).find(w => w.length > 2) || tokens(s)[0] || '';
const fmtNum = (n: string) => (n.startsWith('549') && n.length === 13 ? `+54 9 ${n.slice(3, 5)} ${n.slice(5, 9)}-${n.slice(9)}` : `+${n}`);

export function ContactosWhatsapp({ pedirExtension, onCerrar }: {
  pedirExtension: (type: string, payload?: any, ms?: number) => Promise<any>;
  onCerrar: () => void;
}) {
  const toast = useToast();
  const [cargando, setCargando] = useState(false);
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [filtro, setFiltro] = useState<Estado | 'TODOS'>('MAL');
  const [q, setQ] = useState('');

  const bajar = async () => {
    setCargando(true);
    try {
      const [ext, base] = await Promise.all([
        pedirExtension('CONTACTOS', undefined, 60000),
        apiFetch<{ ok: boolean; agentes: AgenteCel[] }>('/licencias-medicas-control/whatsapp/celulares'),
      ]);
      if (!ext?.ok) throw new Error(ext?.detalle || 'No se pudo leer la agenda de WhatsApp');
      const porCel = new Map<string, AgenteCel[]>();
      for (const a of base.agentes) {
        if (!a.celular) continue;
        if (!porCel.has(a.celular)) porCel.set(a.celular, []);
        porCel.get(a.celular)!.push(a);
      }
      const out: Fila[] = [];
      const vistos = new Set<string>();
      for (const c of (ext.contactos as ContactoWa[]).filter(c => c.agendado)) {
        if (vistos.has(c.numero)) continue;
        vistos.add(c.numero);
        const ags = porCel.get(c.numero) || [];
        if (!ags.length) { out.push({ estado: 'SIN_AGENTE', numero: c.numero, nombreWa: c.nombre, pushname: c.pushname, agente: null }); continue; }
        for (const a of ags) {
          const t = tokens(c.nombre);
          const ape = t.includes(primera(a.apellido));
          const nom = t.includes(primera(a.nombre));
          out.push({ estado: ape && nom ? 'OK' : ape || nom ? 'PARCIAL' : 'MAL', numero: c.numero, nombreWa: c.nombre, pushname: c.pushname, agente: a });
        }
      }
      for (const [cel, ags] of porCel) {
        if (vistos.has(cel)) continue;
        for (const a of ags) out.push({ estado: 'NO_AGENDADO', numero: cel, nombreWa: '', pushname: '', agente: a });
      }
      out.sort((x, y) => ORDEN.indexOf(x.estado) - ORDEN.indexOf(y.estado)
        || (x.agente?.apellido || x.nombreWa).localeCompare(y.agente?.apellido || y.nombreWa, 'es'));
      setFilas(out);
      toast.ok('Agenda leída', `${vistos.size} contactos de WhatsApp cruzados con ${base.agentes.length} agentes activos`);
    } catch (e: any) {
      toast.error('Contactos de WhatsApp', e?.message || 'Error');
    } finally {
      setCargando(false);
    }
  };

  const cuenta = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of filas || []) m[f.estado] = (m[f.estado] || 0) + 1;
    return m;
  }, [filas]);

  const visibles = useMemo(() => {
    const nq = normTxt(q).trim();
    return (filas || []).filter(f => {
      if (filtro !== 'TODOS' && f.estado !== filtro) return false;
      if (!nq) return true;
      return normTxt(`${f.nombreWa} ${f.pushname} ${f.agente?.apellido} ${f.agente?.nombre} ${f.agente?.dni}`).includes(nq) || f.numero.includes(nq);
    });
  }, [filas, filtro, q]);

  const exportar = () => exportToExcel('contactos_whatsapp', visibles.map(f => ({
    Estado: ESTADOS[f.estado].txt.replace(/^\S+\s/, ''),
    'Número': fmtNum(f.numero),
    'Agendado en WhatsApp como': f.nombreWa,
    'Nombre de perfil (WhatsApp)': f.pushname,
    'Agente (base)': f.agente ? `${f.agente.apellido}, ${f.agente.nombre}` : '',
    DNI: f.agente?.dni || '',
    'Agendar como (sugerido)': f.agente ? `${f.agente.apellido} ${f.agente.nombre}` : '',
    'Teléfono en la base': f.agente?.telefono || '',
  })));

  return (
    <div className="card" style={{ padding: 12, marginBottom: 12, border: '1px solid rgba(34,197,94,0.3)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b>📇 Contactos de WhatsApp vs. base</b>
        <button type="button" className="btn" onClick={bajar} disabled={cargando}>
          {cargando ? 'Leyendo la agenda…' : filas ? '🔄 Volver a leer' : '⬇️ Leer la agenda de WhatsApp'}
        </button>
        {filas && <button type="button" className="btn" onClick={exportar} disabled={!visibles.length}>⬇️ Excel</button>}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={onCerrar}>Cerrar</button>
      </div>
      {!filas && !cargando && (
        <div className="muted" style={{ fontSize: '0.8rem', marginTop: 8 }}>
          Lee los contactos agendados del WhatsApp Web abierto y los cruza por número con los celulares de los agentes activos.
          No envía nada.
        </div>
      )}
      {filas && (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            {(['TODOS', ...ORDEN] as const).map(e => (
              <button key={e} type="button" className="btn" onClick={() => setFiltro(e)} title={e === 'TODOS' ? undefined : ESTADOS[e].ayuda}
                style={{ padding: '3px 10px', fontSize: '0.78rem', fontWeight: filtro === e ? 700 : 400, background: filtro === e ? (e === 'TODOS' ? 'rgba(124,58,237,0.3)' : ESTADOS[e].color) : undefined }}>
                {e === 'TODOS' ? `Todos · ${filas.length}` : `${ESTADOS[e].txt} · ${cuenta[e] || 0}`}
              </button>
            ))}
            <input className="input" placeholder="Buscar…" value={q} onChange={e => setQ(e.target.value)} style={{ flex: '1 1 160px', minWidth: 140 }} />
          </div>
          {filtro !== 'TODOS' && <div className="muted" style={{ fontSize: '0.75rem', marginTop: 6 }}>{ESTADOS[filtro].ayuda}.</div>}
          <div style={{ maxHeight: 420, overflowY: 'auto', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.12)', whiteSpace: 'nowrap' }}>
                  <th style={{ padding: '6px' }}>Estado</th>
                  <th style={{ padding: '6px' }}>Número</th>
                  <th style={{ padding: '6px' }}>Agendado en WhatsApp como</th>
                  <th style={{ padding: '6px' }}>Agente en la base</th>
                </tr>
              </thead>
              <tbody>
                {visibles.length === 0 && <tr><td colSpan={4} className="muted" style={{ padding: 12, textAlign: 'center' }}>Nada en este filtro.</td></tr>}
                {visibles.map((f, i) => (
                  <tr key={`${f.numero}|${f.agente?.dni ?? ''}|${i}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <td style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}><span className="badge" style={{ background: ESTADOS[f.estado].color }}>{ESTADOS[f.estado].txt}</span></td>
                    <td style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>{fmtNum(f.numero)}</td>
                    <td style={{ padding: '5px 6px' }}>
                      {f.nombreWa || <span className="muted">—</span>}
                      {f.pushname && f.pushname !== f.nombreWa && <div className="muted" style={{ fontSize: '0.7rem' }}>Perfil: {f.pushname}</div>}
                    </td>
                    <td style={{ padding: '5px 6px' }}>
                      {f.agente
                        ? <>{f.agente.apellido}, {f.agente.nombre} <span className="muted" style={{ fontSize: '0.72rem' }}>· DNI {f.agente.dni}</span></>
                        : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

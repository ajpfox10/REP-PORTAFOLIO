// src/pages/LegajoPage/index.tsx
// Legajo Personal — formulario oficial Provincia de Buenos Aires / Ministerio de Salud
// 16 páginas del legajo con visualización + CRUD para las secciones editables
import React, { useState, useCallback, useRef } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { searchPersonal } from '../../api/searchPersonal';
import { useToast } from '../../ui/toast';

// ─── helpers ─────────────────────────────────────────────────────────────────

const fmtDate = (v: any): string => {
  if (!v) return '—';
  try {
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const [y, m, d] = s.split('T')[0].split('-');
      return `${d}/${m}/${y}`;
    }
    return s;
  } catch { return String(v); }
};

const fmtMoney = (v: any): string => {
  if (v === null || v === undefined || v === '') return '—';
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(v));
};

const val = (v: any): string => {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
};

const bool = (v: any): string => (v ? 'Sí' : 'No');

// ─── sub-components ───────────────────────────────────────────────────────────

function Campo({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1,
      gridColumn: wide ? '1 / -1' : undefined }}>
      <span style={{ fontSize: '0.67rem', textTransform: 'uppercase', letterSpacing: '0.05em',
        color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: '0.82rem', color: value === '—' ? 'rgba(255,255,255,0.3)' : undefined }}>
        {value}
      </span>
    </div>
  );
}

function Seccion({ titulo, children, accent = '#7c3aed' }: {
  titulo: string; children: React.ReactNode; accent?: string;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase',
        letterSpacing: '0.07em', color: accent,
        borderBottom: `1px solid ${accent}44`, paddingBottom: 5, marginBottom: 12 }}>
        {titulo}
      </div>
      {children}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
      gap: '8px 20px' }}>
      {children}
    </div>
  );
}

// Tabla genérica para listas
function TablaLista({ cols, rows, onEdit, onDelete }: {
  cols: { key: string; label: string; fmt?: (v: any, row: any) => string }[];
  rows: any[];
  onEdit?: (row: any) => void;
  onDelete?: (row: any) => void;
}) {
  if (!rows.length) return (
    <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.8rem', padding: '8px 0' }}>
      Sin registros
    </div>
  );
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
        <thead>
          <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
            {cols.map(c => (
              <th key={c.key} style={{ padding: '5px 10px', textAlign: 'left',
                color: 'rgba(255,255,255,0.5)', fontSize: '0.7rem', whiteSpace: 'nowrap',
                fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {c.label}
              </th>
            ))}
            {(onEdit || onDelete) && <th style={{ width: 80 }} />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              {cols.map(c => (
                <td key={c.key} style={{ padding: '5px 10px', maxWidth: 220,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={String(row[c.key] ?? '')}>
                  {c.fmt ? c.fmt(row[c.key], row) : val(row[c.key])}
                </td>
              ))}
              {(onEdit || onDelete) && (
                <td style={{ padding: '3px 6px', whiteSpace: 'nowrap' }}>
                  {onEdit && (
                    <button onClick={() => onEdit(row)}
                      style={{ background: 'rgba(37,99,235,0.25)', color: '#60a5fa',
                        border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer',
                        fontSize: '0.72rem', marginRight: 4 }}>
                      Editar
                    </button>
                  )}
                  {onDelete && (
                    <button onClick={() => onDelete(row)}
                      style={{ background: 'rgba(239,68,68,0.2)', color: '#f87171',
                        border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer',
                        fontSize: '0.72rem' }}>
                      Eliminar
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Modal genérico
function Modal({ titulo, children, onClose }: {
  titulo: string; children: React.ReactNode; onClose: () => void;
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#1e1e2e', borderRadius: 12, padding: 24, width: '100%',
        maxWidth: 600, maxHeight: '90vh', overflowY: 'auto',
        border: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 20 }}>
          <strong style={{ fontSize: '0.95rem' }}>{titulo}</strong>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)',
              fontSize: '1.2rem', cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FormField({ label, name, value, onChange, type = 'text', options }: {
  label: string; name: string; value: any; onChange: (k: string, v: any) => void;
  type?: string; options?: { value: string; label: string }[];
}) {
  const style: React.CSSProperties = {
    width: '100%', padding: '6px 10px', background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: '#fff',
    fontSize: '0.82rem', boxSizing: 'border-box',
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <label style={{ fontSize: '0.7rem', textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{label}</label>
      {type === 'textarea' ? (
        <textarea name={name} value={value ?? ''} rows={3}
          onChange={e => onChange(name, e.target.value)} style={{ ...style, resize: 'vertical' }} />
      ) : type === 'select' && options ? (
        <select name={name} value={value ?? ''} onChange={e => onChange(name, e.target.value)} style={style}>
          <option value="">— Sin dato —</option>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : type === 'checkbox' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4 }}>
          <input type="checkbox" checked={!!value} onChange={e => onChange(name, e.target.checked)}
            style={{ width: 16, height: 16, cursor: 'pointer' }} />
          <span style={{ fontSize: '0.82rem' }}>{label}</span>
        </div>
      ) : (
        <input type={type} name={name} value={value ?? ''}
          onChange={e => onChange(name, e.target.value)} style={style} />
      )}
    </div>
  );
}

// ─── SECCIONES ────────────────────────────────────────────────────────────────

function SeccionDatosPersonales({ d }: { d: any }) {
  if (!d) return <div className="muted">Sin datos personales</div>;
  return (
    <>
      <Seccion titulo="Pág. 01-02 — Datos Personales">
        <Grid>
          <Campo label="Apellido" value={val(d.apellido)} />
          <Campo label="Nombre/s" value={val(d.nombre)} />
          <Campo label="DNI" value={val(d.dni)} />
          <Campo label="CUIL" value={val(d.cuil)} />
          <Campo label="Fecha de Nacimiento" value={fmtDate(d.fecha_nacimiento)} />
          <Campo label="Sexo" value={val(d.sexo_nombre ?? d.sexo_id)} />
          <Campo label="Estado Civil" value={val(d.estado_civil)} />
          <Campo label="Nacionalidad" value={val(d.nacionalidad)} />
          <Campo label="Localidad" value={val(d.localidad_nombre ?? d.localidad_id)} />
          <Campo label="CP" value={val(d.cp)} />
          <Campo label="Nro. Domicilio" value={val(d.numerodomicilio)} />
          <Campo label="Depto / Piso" value={[d.depto, d.piso].filter(Boolean).join(' — ') || '—'} />
          <Campo label="Categoría" value={val(d.categoria_nombre ?? d.categoria_id)} />
          <Campo label="Planta" value={val(d.planta_nombre ?? d.planta_id)} />
          <Campo label="Ocupación" value={val(d.ocupacion_nombre)} />
          <Campo label="Régimen Horario" value={val(d.regimen_horario_nombre)} />
          <Campo label="Observaciones" value={val(d.observaciones)} wide />
        </Grid>
      </Seccion>
    </>
  );
}

function SeccionFojaServicios({ agente, servicios }: { agente: any; servicios: any[] }) {
  return (
    <>
      <Seccion titulo="Pág. 06 — Foja de Servicios" accent="#2563eb">
        {agente ? (
          <Grid>
            <Campo label="Legajo" value={val(agente.legajo)} />
            <Campo label="Fecha Ingreso" value={fmtDate(agente.fecha_ingreso)} />
            <Campo label="Fecha Baja" value={fmtDate(agente.fecha_baja)} />
            <Campo label="Estado Empleo" value={val(agente.estado_empleo)} />
            <Campo label="Función" value={val(agente.funcion_nombre ?? agente.funcion_id)} />
            <Campo label="Servicio" value={val(agente.servicio_nombre ?? agente.servicio_id)} />
            <Campo label="Categoría" value={val(agente.categoria_nombre ?? agente.categoria_id)} />
            <Campo label="Planta" value={val(agente.planta_nombre ?? agente.planta_id)} />
            <Campo label="Régimen Horario" value={val(agente.regimen_horario_nombre)} />
            <Campo label="Dependencia" value={val(agente.dependencia_nombre ?? agente.dependencia_id)} />
            <Campo label="Repartición" value={val(agente.reparticion_nombre ?? agente.reparticion_id)} />
          </Grid>
        ) : (
          <div className="muted" style={{ fontSize: '0.8rem' }}>Sin datos de agente</div>
        )}
      </Seccion>
      {servicios.length > 0 && (
        <Seccion titulo="Historial de Servicios / Destinos" accent="#2563eb">
          <TablaLista
            cols={[
              { key: 'dependencia_nombre', label: 'Dependencia', fmt: (v, r) => val(v ?? r.dependencia_id) },
              { key: 'servicio_nombre', label: 'Servicio', fmt: (v, r) => val(v ?? r.servicio_id) },
              { key: 'fecha_desde', label: 'Desde', fmt: fmtDate },
              { key: 'fecha_hasta', label: 'Hasta', fmt: fmtDate },
              { key: 'motivo', label: 'Motivo' },
            ]}
            rows={servicios}
          />
        </Seccion>
      )}
    </>
  );
}

function SeccionBonificaciones({ rows }: { rows: any[] }) {
  return (
    <Seccion titulo="Pág. 07 — Bonificaciones" accent="#0891b2">
      <TablaLista
        cols={[
          { key: 'nombre', label: 'Nombre' },
          { key: 'decreto_numero', label: 'Decreto' },
          { key: 'norma_legal', label: 'Norma Legal' },
          { key: 'a_partir', label: 'A Partir', fmt: fmtDate },
          { key: 'fecha_baja', label: 'Fecha Baja', fmt: fmtDate },
          { key: 'expediente', label: 'Expediente' },
        ]}
        rows={rows}
      />
    </Seccion>
  );
}

// ─── SECCIONES EDITABLES ─────────────────────────────────────────────────────

type CrudState = { open: boolean; editing: any | null; form: Record<string, any>; saving: boolean };
const emptyCrud = (): CrudState => ({ open: false, editing: null, form: {}, saving: false });

function useCrud(table: string, dni: number, onRefresh: () => void) {
  const toast = useToast();
  const [state, setState] = useState<CrudState>(emptyCrud());

  const open = (row?: any) => {
    setState({ open: true, editing: row ?? null, form: row ? { ...row } : { dni }, saving: false });
  };
  const close = () => setState(emptyCrud());
  const setField = (k: string, v: any) =>
    setState(s => ({ ...s, form: { ...s.form, [k]: v } }));

  const save = async () => {
    setState(s => ({ ...s, saving: true }));
    try {
      if (state.editing?.id) {
        await apiFetch(`/legajo/seccion/${table}/${state.editing.id}`, {
          method: 'PUT', body: JSON.stringify(state.form),
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        await apiFetch(`/legajo/seccion/${table}`, {
          method: 'POST', body: JSON.stringify({ ...state.form, dni }),
          headers: { 'Content-Type': 'application/json' },
        });
      }
      toast.ok('Guardado');
      close();
      onRefresh();
    } catch (e: any) {
      toast.error('Error al guardar', e?.message);
      setState(s => ({ ...s, saving: false }));
    }
  };

  const remove = async (row: any) => {
    if (!window.confirm('¿Eliminar este registro?')) return;
    try {
      await apiFetch(`/legajo/seccion/${table}/${row.id}`, { method: 'DELETE' });
      toast.ok('Eliminado');
      onRefresh();
    } catch (e: any) {
      toast.error('Error al eliminar', e?.message);
    }
  };

  return { state, open, close, setField, save, remove };
}

function BtnAgregar({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick}
      style={{ background: 'rgba(16,185,129,0.2)', color: '#34d399',
        border: '1px solid rgba(16,185,129,0.3)', borderRadius: 6,
        padding: '4px 14px', cursor: 'pointer', fontSize: '0.78rem',
        marginBottom: 10, fontWeight: 600 }}>
      + Agregar
    </button>
  );
}

function BtnGuardar({ onClick, saving }: { onClick: () => void; saving: boolean }) {
  return (
    <button onClick={onClick} disabled={saving}
      style={{ background: saving ? 'rgba(255,255,255,0.1)' : 'rgba(37,99,235,0.8)',
        color: '#fff', border: 'none', borderRadius: 6,
        padding: '7px 20px', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '0.82rem',
        fontWeight: 600 }}>
      {saving ? 'Guardando...' : 'Guardar'}
    </button>
  );
}

// Pág 04+05 — Familia
function SeccionFamilia({ rows, expedientes, dni, onRefresh }: {
  rows: any[]; expedientes: any[]; dni: number; onRefresh: () => void;
}) {
  const familia = useCrud('legajo_familia', dni, onRefresh);
  const famExp  = useCrud('legajo_familia_expedientes', dni, onRefresh);
  const f = familia.state.form;
  const e = famExp.state.form;

  return (
    <>
      <Seccion titulo="Pág. 04 — Grupo Familiar" accent="#d97706">
        <BtnAgregar onClick={() => familia.open()} />
        <TablaLista
          cols={[
            { key: 'parentesco', label: 'Parentesco' },
            { key: 'apellido_nombres', label: 'Apellido y Nombre' },
            { key: 'sexo', label: 'Sexo' },
            { key: 'fecha_nacimiento', label: 'F. Nacimiento', fmt: fmtDate },
            { key: 'vive', label: 'Vive', fmt: bool },
            { key: 'es_empleado', label: 'Empleo' },
          ]}
          rows={rows}
          onEdit={r => familia.open(r)}
          onDelete={r => familia.remove(r)}
        />
      </Seccion>

      <Seccion titulo="Pág. 05 — Expedientes Grupo Familiar" accent="#d97706">
        <BtnAgregar onClick={() => famExp.open()} />
        <TablaLista
          cols={[
            { key: 'expediente', label: 'Expediente' },
            { key: 'fecha_informe', label: 'Fecha', fmt: fmtDate },
            { key: 'motivo', label: 'Motivo' },
            { key: 'observacion', label: 'Observación' },
          ]}
          rows={expedientes}
          onEdit={r => famExp.open(r)}
          onDelete={r => famExp.remove(r)}
        />
      </Seccion>

      {familia.state.open && (
        <Modal titulo={familia.state.editing ? 'Editar familiar' : 'Agregar familiar'}
          onClose={familia.close}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Parentesco" name="parentesco" value={f.parentesco}
              onChange={familia.setField} />
            <FormField label="Código" name="codigo" value={f.codigo} onChange={familia.setField} />
            <FormField label="Apellido y Nombre" name="apellido_nombres" value={f.apellido_nombres}
              onChange={familia.setField} />
            <FormField label="Sexo" name="sexo" value={f.sexo} onChange={familia.setField}
              type="select" options={[{value:'M',label:'Masculino'},{value:'F',label:'Femenino'},{value:'X',label:'Otro'}]} />
            <FormField label="Fecha Nacimiento" name="fecha_nacimiento" value={f.fecha_nacimiento}
              onChange={familia.setField} type="date" />
            <FormField label="¿Vive?" name="vive" value={f.vive} onChange={familia.setField}
              type="checkbox" />
            <FormField label="Empleo (si trabaja)" name="es_empleado" value={f.es_empleado}
              onChange={familia.setField} />
            <FormField label="Jubilación (si jubilado)" name="es_jubilado" value={f.es_jubilado}
              onChange={familia.setField} />
          </div>
          <FormField label="Observaciones" name="observaciones" value={f.observaciones}
            onChange={familia.setField} type="textarea" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button onClick={familia.close}
              style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 6,
                padding: '7px 16px', cursor: 'pointer', color: '#fff', fontSize: '0.82rem' }}>
              Cancelar
            </button>
            <BtnGuardar onClick={familia.save} saving={familia.state.saving} />
          </div>
        </Modal>
      )}

      {famExp.state.open && (
        <Modal titulo={famExp.state.editing ? 'Editar expediente' : 'Agregar expediente'}
          onClose={famExp.close}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Expediente" name="expediente" value={e.expediente} onChange={famExp.setField} />
            <FormField label="Fecha Informe" name="fecha_informe" value={e.fecha_informe}
              onChange={famExp.setField} type="date" />
            <FormField label="Motivo" name="motivo" value={e.motivo}
              onChange={famExp.setField} />
          </div>
          <FormField label="Observación" name="observacion" value={e.observacion}
            onChange={famExp.setField} type="textarea" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button onClick={famExp.close}
              style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 6,
                padding: '7px 16px', cursor: 'pointer', color: '#fff', fontSize: '0.82rem' }}>
              Cancelar
            </button>
            <BtnGuardar onClick={famExp.save} saving={famExp.state.saving} />
          </div>
        </Modal>
      )}
    </>
  );
}

// Pág 08 — Función y Destino
function SeccionFuncionDestino({ rows, dni, onRefresh }: {
  rows: any[]; dni: number; onRefresh: () => void;
}) {
  const crud = useCrud('legajo_funcion_destino', dni, onRefresh);
  const f = crud.state.form;
  return (
    <Seccion titulo="Pág. 08 — Función y Destino" accent="#7c3aed">
      <BtnAgregar onClick={() => crud.open()} />
      <TablaLista
        cols={[
          { key: 'funcion', label: 'Función' },
          { key: 'destino', label: 'Destino' },
          { key: 'resolucion', label: 'Resolución' },
          { key: 'fecha_ingreso', label: 'Fecha Ingreso', fmt: fmtDate },
          { key: 'fecha_egreso', label: 'Fecha Egreso', fmt: fmtDate },
        ]}
        rows={rows}
        onEdit={r => crud.open(r)}
        onDelete={r => crud.remove(r)}
      />
      {crud.state.open && (
        <Modal titulo={crud.state.editing ? 'Editar función/destino' : 'Agregar función/destino'}
          onClose={crud.close}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Función" name="funcion" value={f.funcion} onChange={crud.setField} />
            <FormField label="Destino" name="destino" value={f.destino} onChange={crud.setField} />
            <FormField label="Resolución" name="resolucion" value={f.resolucion} onChange={crud.setField} />
            <div />
            <FormField label="Fecha Ingreso" name="fecha_ingreso" value={f.fecha_ingreso}
              onChange={crud.setField} type="date" />
            <FormField label="Fecha Egreso" name="fecha_egreso" value={f.fecha_egreso}
              onChange={crud.setField} type="date" />
          </div>
          <FormField label="Observaciones" name="observaciones" value={f.observaciones}
            onChange={crud.setField} type="textarea" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button onClick={crud.close}
              style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 6,
                padding: '7px 16px', cursor: 'pointer', color: '#fff', fontSize: '0.82rem' }}>
              Cancelar
            </button>
            <BtnGuardar onClick={crud.save} saving={crud.state.saving} />
          </div>
        </Modal>
      )}
    </Seccion>
  );
}

// Pág 09 — Licencias
function SeccionLicencias({ rows, dni, onRefresh }: {
  rows: any[]; dni: number; onRefresh: () => void;
}) {
  const crud = useCrud('legajo_licencias', dni, onRefresh);
  const f = crud.state.form;
  return (
    <Seccion titulo="Pág. 09 — Licencias" accent="#0891b2">
      <BtnAgregar onClick={() => crud.open()} />
      <TablaLista
        cols={[
          { key: 'resolucion', label: 'Resolución' },
          { key: 'fecha', label: 'Fecha', fmt: fmtDate },
          { key: 'motivo', label: 'Motivo' },
          { key: 'termino', label: 'Término' },
          { key: 'con_sueldo', label: 'C/Sueldo', fmt: bool },
          { key: 'sin_sueldo', label: 'S/Sueldo', fmt: bool },
        ]}
        rows={rows}
        onEdit={r => crud.open(r)}
        onDelete={r => crud.remove(r)}
      />
      {crud.state.open && (
        <Modal titulo={crud.state.editing ? 'Editar licencia' : 'Agregar licencia'}
          onClose={crud.close}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Resolución" name="resolucion" value={f.resolucion} onChange={crud.setField} />
            <FormField label="Fecha" name="fecha" value={f.fecha} onChange={crud.setField} type="date" />
            <FormField label="Motivo" name="motivo" value={f.motivo} onChange={crud.setField} />
            <FormField label="Término" name="termino" value={f.termino} onChange={crud.setField} />
            <FormField label="A Partir: Día" name="a_partir_dia" value={f.a_partir_dia}
              onChange={crud.setField} type="number" />
            <FormField label="A Partir: Mes" name="a_partir_mes" value={f.a_partir_mes}
              onChange={crud.setField} type="number" />
            <FormField label="A Partir: Año" name="a_partir_anio" value={f.a_partir_anio}
              onChange={crud.setField} type="number" />
            <div />
          </div>
          <div style={{ display: 'flex', gap: 20, padding: '8px 0' }}>
            <FormField label="Con Sueldo" name="con_sueldo" value={f.con_sueldo}
              onChange={crud.setField} type="checkbox" />
            <FormField label="Con 50%" name="con_50pct" value={f.con_50pct}
              onChange={crud.setField} type="checkbox" />
            <FormField label="Sin Sueldo" name="sin_sueldo" value={f.sin_sueldo}
              onChange={crud.setField} type="checkbox" />
          </div>
          <FormField label="Observaciones" name="observaciones" value={f.observaciones}
            onChange={crud.setField} type="textarea" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button onClick={crud.close}
              style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 6,
                padding: '7px 16px', cursor: 'pointer', color: '#fff', fontSize: '0.82rem' }}>
              Cancelar
            </button>
            <BtnGuardar onClick={crud.save} saving={crud.state.saving} />
          </div>
        </Modal>
      )}
    </Seccion>
  );
}

// Pág 11 — Concepto y Menciones
function SeccionConceptoMenciones({ rows, dni, onRefresh }: {
  rows: any[]; dni: number; onRefresh: () => void;
}) {
  const crud = useCrud('legajo_concepto_menciones', dni, onRefresh);
  const f = crud.state.form;
  return (
    <Seccion titulo="Pág. 11 — Concepto y Menciones" accent="#059669">
      <BtnAgregar onClick={() => crud.open()} />
      <TablaLista
        cols={[
          { key: 'fecha', label: 'Fecha', fmt: fmtDate },
          { key: 'referencias', label: 'Referencias' },
        ]}
        rows={rows}
        onEdit={r => crud.open(r)}
        onDelete={r => crud.remove(r)}
      />
      {crud.state.open && (
        <Modal titulo={crud.state.editing ? 'Editar mención' : 'Agregar mención'}
          onClose={crud.close}>
          <div style={{ display: 'grid', gap: 12 }}>
            <FormField label="Fecha" name="fecha" value={f.fecha} onChange={crud.setField} type="date" />
            <FormField label="Referencias" name="referencias" value={f.referencias}
              onChange={crud.setField} type="textarea" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button onClick={crud.close}
              style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 6,
                padding: '7px 16px', cursor: 'pointer', color: '#fff', fontSize: '0.82rem' }}>
              Cancelar
            </button>
            <BtnGuardar onClick={crud.save} saving={crud.state.saving} />
          </div>
        </Modal>
      )}
    </Seccion>
  );
}

// Pág 12 — Penas Disciplinarias
function SeccionPenas({ rows, dni, onRefresh }: {
  rows: any[]; dni: number; onRefresh: () => void;
}) {
  const crud = useCrud('legajo_penas_disciplinarias', dni, onRefresh);
  const f = crud.state.form;
  return (
    <Seccion titulo="Pág. 12 — Penas Disciplinarias" accent="#dc2626">
      <BtnAgregar onClick={() => crud.open()} />
      <TablaLista
        cols={[
          { key: 'expediente_letra', label: 'Letra' },
          { key: 'expediente_nro', label: 'Nro' },
          { key: 'expediente_anio', label: 'Año' },
          { key: 'decreto_resolucion', label: 'Decreto/Resolución' },
          { key: 'fecha', label: 'Fecha', fmt: fmtDate },
          { key: 'calidad_pena', label: 'Calidad de Pena' },
        ]}
        rows={rows}
        onEdit={r => crud.open(r)}
        onDelete={r => crud.remove(r)}
      />
      {crud.state.open && (
        <Modal titulo={crud.state.editing ? 'Editar pena' : 'Agregar pena disciplinaria'}
          onClose={crud.close}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <FormField label="Letra Expediente" name="expediente_letra" value={f.expediente_letra}
              onChange={crud.setField} />
            <FormField label="Nro Expediente" name="expediente_nro" value={f.expediente_nro}
              onChange={crud.setField} />
            <FormField label="Año Expediente" name="expediente_anio" value={f.expediente_anio}
              onChange={crud.setField} type="number" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <FormField label="Decreto / Resolución" name="decreto_resolucion" value={f.decreto_resolucion}
              onChange={crud.setField} />
            <FormField label="Fecha" name="fecha" value={f.fecha} onChange={crud.setField} type="date" />
            <FormField label="Calidad de Pena" name="calidad_pena" value={f.calidad_pena}
              onChange={crud.setField} />
          </div>
          <div style={{ marginTop: 12 }}>
            <FormField label="Motivo" name="motivo" value={f.motivo}
              onChange={crud.setField} type="textarea" />
          </div>
          <div style={{ marginTop: 12 }}>
            <FormField label="Observaciones" name="observaciones" value={f.observaciones}
              onChange={crud.setField} type="textarea" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button onClick={crud.close}
              style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 6,
                padding: '7px 16px', cursor: 'pointer', color: '#fff', fontSize: '0.82rem' }}>
              Cancelar
            </button>
            <BtnGuardar onClick={crud.save} saving={crud.state.saving} />
          </div>
        </Modal>
      )}
    </Seccion>
  );
}

// Pág 14 — Incompatibilidad
function SeccionIncompatibilidad({ data, dni, onRefresh }: {
  data: any | null; dni: number; onRefresh: () => void;
}) {
  const crud = useCrud('legajo_incompatibilidad', dni, onRefresh);
  const f = crud.state.form;
  const d = data ?? {};
  return (
    <Seccion titulo="Pág. 14 — Declaración de Incompatibilidad" accent="#9333ea">
      {data ? (
        <>
          <Grid>
            <Campo label="Fecha Declaración" value={fmtDate(d.fecha_declaracion)} />
            <Campo label="Tiene Jubilación" value={bool(d.tiene_jubilacion)} />
            {d.tiene_jubilacion ? (
              <>
                <Campo label="Ley Jubilación" value={val(d.jubilacion_ley)} />
                <Campo label="Caja" value={val(d.jubilacion_caja)} />
                <Campo label="Monto" value={fmtMoney(d.jubilacion_monto)} />
                <Campo label="Fecha" value={fmtDate(d.jubilacion_fecha)} />
              </>
            ) : null}
            <Campo label="Otro Cargo" value={bool(d.otro_cargo)} />
            {d.otro_cargo ? (
              <>
                <Campo label="Nivel" value={val(d.otro_cargo_nivel)} />
                <Campo label="Lugar" value={val(d.otro_cargo_lugar)} />
                <Campo label="Monto" value={fmtMoney(d.otro_cargo_monto)} />
                <Campo label="Fecha Ingreso" value={fmtDate(d.otro_cargo_fecha_ingreso)} />
              </>
            ) : null}
            <Campo label="Otras Actividades" value={val(d.otras_actividades)} wide />
            <Campo label="Observaciones" value={val(d.observaciones)} wide />
          </Grid>
          <button onClick={() => crud.open(data)}
            style={{ marginTop: 12, background: 'rgba(37,99,235,0.25)', color: '#60a5fa',
              border: 'none', borderRadius: 6, padding: '5px 14px', cursor: 'pointer',
              fontSize: '0.78rem', fontWeight: 600 }}>
            Editar
          </button>
        </>
      ) : (
        <button onClick={() => crud.open()}
          style={{ background: 'rgba(16,185,129,0.2)', color: '#34d399',
            border: '1px solid rgba(16,185,129,0.3)', borderRadius: 6,
            padding: '4px 14px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>
          + Cargar declaración
        </button>
      )}

      {crud.state.open && (
        <Modal titulo="Declaración de Incompatibilidad" onClose={crud.close}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Fecha Declaración" name="fecha_declaracion" value={f.fecha_declaracion}
              onChange={crud.setField} type="date" />
            <div />
            <FormField label="Tiene Jubilación" name="tiene_jubilacion" value={f.tiene_jubilacion}
              onChange={crud.setField} type="checkbox" />
            {f.tiene_jubilacion ? (
              <>
                <FormField label="Ley" name="jubilacion_ley" value={f.jubilacion_ley}
                  onChange={crud.setField} />
                <FormField label="Caja" name="jubilacion_caja" value={f.jubilacion_caja}
                  onChange={crud.setField} />
                <FormField label="Monto" name="jubilacion_monto" value={f.jubilacion_monto}
                  onChange={crud.setField} type="number" />
                <FormField label="Fecha" name="jubilacion_fecha" value={f.jubilacion_fecha}
                  onChange={crud.setField} type="date" />
              </>
            ) : null}
            <FormField label="Otro Cargo" name="otro_cargo" value={f.otro_cargo}
              onChange={crud.setField} type="checkbox" />
            {f.otro_cargo ? (
              <>
                <FormField label="Nivel" name="otro_cargo_nivel" value={f.otro_cargo_nivel}
                  onChange={crud.setField} type="select"
                  options={['NACIONAL','PROVINCIAL','MUNICIPAL','NINGUNO'].map(v => ({ value: v, label: v }))} />
                <FormField label="Lugar" name="otro_cargo_lugar" value={f.otro_cargo_lugar}
                  onChange={crud.setField} />
                <FormField label="Monto" name="otro_cargo_monto" value={f.otro_cargo_monto}
                  onChange={crud.setField} type="number" />
                <FormField label="Fecha Ingreso" name="otro_cargo_fecha_ingreso"
                  value={f.otro_cargo_fecha_ingreso} onChange={crud.setField} type="date" />
              </>
            ) : null}
          </div>
          <div style={{ marginTop: 12 }}>
            <FormField label="Otras Actividades" name="otras_actividades" value={f.otras_actividades}
              onChange={crud.setField} />
          </div>
          <div style={{ marginTop: 12 }}>
            <FormField label="Observaciones" name="observaciones" value={f.observaciones}
              onChange={crud.setField} type="textarea" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button onClick={crud.close}
              style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 6,
                padding: '7px 16px', cursor: 'pointer', color: '#fff', fontSize: '0.82rem' }}>
              Cancelar
            </button>
            <BtnGuardar onClick={crud.save} saving={crud.state.saving} />
          </div>
        </Modal>
      )}
    </Seccion>
  );
}

// Pág 15 — Embargos
function SeccionEmbargos({ rows, dni, onRefresh }: {
  rows: any[]; dni: number; onRefresh: () => void;
}) {
  const crud = useCrud('legajo_embargos', dni, onRefresh);
  const f = crud.state.form;
  return (
    <Seccion titulo="Pág. 15 — Embargos" accent="#b45309">
      <BtnAgregar onClick={() => crud.open()} />
      <TablaLista
        cols={[
          { key: 'expediente', label: 'Expediente' },
          { key: 'fecha', label: 'Fecha', fmt: fmtDate },
          { key: 'suma_embargada', label: 'Suma', fmt: fmtMoney },
          { key: 'autoridad', label: 'Autoridad' },
          { key: 'ejecutante', label: 'Ejecutante' },
          { key: 'fecha_levantamiento', label: 'Levantamiento', fmt: fmtDate },
        ]}
        rows={rows}
        onEdit={r => crud.open(r)}
        onDelete={r => crud.remove(r)}
      />
      {crud.state.open && (
        <Modal titulo={crud.state.editing ? 'Editar embargo' : 'Agregar embargo'}
          onClose={crud.close}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Expediente" name="expediente" value={f.expediente} onChange={crud.setField} />
            <FormField label="Fecha" name="fecha" value={f.fecha} onChange={crud.setField} type="date" />
            <FormField label="Suma Embargada" name="suma_embargada" value={f.suma_embargada}
              onChange={crud.setField} type="number" />
            <FormField label="Autoridad" name="autoridad" value={f.autoridad} onChange={crud.setField} />
            <FormField label="Ejecutante" name="ejecutante" value={f.ejecutante} onChange={crud.setField} />
            <FormField label="Fecha Levantamiento" name="fecha_levantamiento"
              value={f.fecha_levantamiento} onChange={crud.setField} type="date" />
          </div>
          <div style={{ marginTop: 12 }}>
            <FormField label="Observaciones" name="observaciones" value={f.observaciones}
              onChange={crud.setField} type="textarea" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button onClick={crud.close}
              style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 6,
                padding: '7px 16px', cursor: 'pointer', color: '#fff', fontSize: '0.82rem' }}>
              Cancelar
            </button>
            <BtnGuardar onClick={crud.save} saving={crud.state.saving} />
          </div>
        </Modal>
      )}
    </Seccion>
  );
}

// Pág 16 — Declaración de Bienes
function SeccionBienes({ rows, dni, onRefresh }: {
  rows: any[]; dni: number; onRefresh: () => void;
}) {
  const crud = useCrud('legajo_declaracion_bienes', dni, onRefresh);
  const f = crud.state.form;
  return (
    <Seccion titulo="Pág. 16 — Declaración de Bienes" accent="#6366f1">
      <BtnAgregar onClick={() => crud.open()} />
      <TablaLista
        cols={[
          { key: 'fecha', label: 'Fecha', fmt: fmtDate },
          { key: 'descripcion', label: 'Descripción' },
        ]}
        rows={rows}
        onEdit={r => crud.open(r)}
        onDelete={r => crud.remove(r)}
      />
      {crud.state.open && (
        <Modal titulo={crud.state.editing ? 'Editar bien' : 'Agregar bien declarado'}
          onClose={crud.close}>
          <div style={{ display: 'grid', gap: 12 }}>
            <FormField label="Fecha" name="fecha" value={f.fecha} onChange={crud.setField} type="date" />
            <FormField label="Descripción" name="descripcion" value={f.descripcion}
              onChange={crud.setField} type="textarea" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button onClick={crud.close}
              style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 6,
                padding: '7px 16px', cursor: 'pointer', color: '#fff', fontSize: '0.82rem' }}>
              Cancelar
            </button>
            <BtnGuardar onClick={crud.save} saving={crud.state.saving} />
          </div>
        </Modal>
      )}
    </Seccion>
  );
}

// ─── TABS ─────────────────────────────────────────────────────────────────────

type TabKey =
  | 'datos'
  | 'foja'
  | 'bonif'
  | 'familia'
  | 'funcDest'
  | 'licencias'
  | 'concepto'
  | 'penas'
  | 'incomp'
  | 'embargos'
  | 'bienes';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'datos',    label: 'Datos Personales' },
  { key: 'foja',     label: 'Foja de Servicios' },
  { key: 'bonif',    label: 'Bonificaciones' },
  { key: 'familia',  label: 'Grupo Familiar' },
  { key: 'funcDest', label: 'Función y Destino' },
  { key: 'licencias',label: 'Licencias' },
  { key: 'concepto', label: 'Concepto / Menciones' },
  { key: 'penas',    label: 'Penas Disciplinarias' },
  { key: 'incomp',   label: 'Incompatibilidad' },
  { key: 'embargos', label: 'Embargos' },
  { key: 'bienes',   label: 'Decl. de Bienes' },
];

// ─── MAIN ─────────────────────────────────────────────────────────────────────

export function LegajoPage() {
  const toast = useToast();
  const [dni, setDni]         = useState('');
  const [apellido, setApellido] = useState('');
  const [matches, setMatches] = useState<any[]>([]);
  const [matchPage, setMatchPage] = useState(1);
  const MATCH_PAGE_SIZE = 50;
  const [loading, setLoading] = useState(false);
  const [data, setData]       = useState<any | null>(null);
  const [activeDni, setActiveDni] = useState<number>(0);
  const [tab, setTab]         = useState<TabKey>('datos');
  const printRef = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async (dniNum: number) => {
    setLoading(true);
    setData(null);
    try {
      const res = await apiFetch<{ ok: boolean; data: any }>(`/legajo/${dniNum}`);
      if (!res.ok) throw new Error('No encontrado');
      setData(res.data);
      setActiveDni(dniNum);
      setTab('datos');
      toast.ok('Legajo cargado');
    } catch (e: any) {
      toast.error('No encontrado', e?.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const buscarPorDni = useCallback(async (dniOverride?: string) => {
    const clean = (dniOverride ?? dni).trim().replace(/\D/g, '');
    if (!clean) { toast.error('Ingresá un DNI'); return; }
    setMatches([]);
    await cargar(Number(clean));
  }, [dni, cargar, toast]);

  const buscarPorApellido = useCallback(async () => {
    const q = apellido.trim();
    if (!q) { toast.error('Ingresá un apellido'); return; }
    setLoading(true);
    setMatches([]);
    setData(null);
    try {
      const results = await searchPersonal(q);
      if (!results.length) {
        toast.error('Sin resultados', `No se encontró "${q}"`);
      } else if (results.length === 1) {
        setApellido('');
        await cargar(Number(results[0].dni));
      } else {
        setMatchPage(1);
        setMatches(results);
        toast.ok(`${results.length} resultado(s) — seleccioná uno`);
      }
    } catch (e: any) {
      toast.error('Error', e?.message);
    } finally {
      setLoading(false);
    }
  }, [apellido, cargar, toast]);

  const refresh = useCallback(() => {
    if (activeDni) cargar(activeDni);
  }, [activeDni, cargar]);

  const imprimir = () => {
    if (!printRef.current) return;
    const html = `<!DOCTYPE html><html><head><title>Legajo — ${activeDni}</title>
      <meta charset="utf-8">
      <style>
        *{box-sizing:border-box}
        body{font-family:Arial,sans-serif;padding:24px;color:#111;font-size:11px;background:#fff}
        h1{font-size:15px;margin:0 0 4px 0;color:#111}
        h2{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
           color:#555;border-bottom:1px solid #ccc;padding-bottom:3px;margin:16px 0 8px 0}
        .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px 16px;margin-bottom:12px}
        .campo label{font-size:8px;text-transform:uppercase;color:#888;display:block}
        .campo span{font-size:11px}
        table{width:100%;border-collapse:collapse;margin-bottom:12px;font-size:10px}
        th{background:#f0f0f0;padding:3px 6px;text-align:left;font-size:9px;font-weight:700;
           text-transform:uppercase;color:#555}
        td{padding:3px 6px;border-bottom:1px solid #eee}
        @page{margin:15mm}
        @media print{body{padding:0}}
      </style>
    </head><body>${printRef.current.innerHTML}</body></html>`;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 300);
  };

  const d = data;

  return (
    <Layout title="Legajo Personal" showBack>
      <div style={{ marginBottom: 12 }}>
        <strong>Legajo Personal — Formulario Oficial</strong>
        <div className="muted" style={{ fontSize: '0.76rem', marginTop: 2 }}>
          Buscá un agente por DNI o apellido para ver y editar su legajo completo
        </div>
      </div>

      {/* Barra de búsqueda */}
      <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 10,
        alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 140px' }}>
          <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>DNI</div>
          <input className="input" value={dni} onChange={e => setDni(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && buscarPorDni()} placeholder="25123456" />
        </div>
        <button className="btn" onClick={() => buscarPorDni()} disabled={loading}
          style={{ background: '#2563eb', color: '#fff', height: 38 }}>
          {loading ? '⏳' : 'Buscar DNI'}
        </button>
        <div style={{ flex: '2 1 200px' }}>
          <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>APELLIDO</div>
          <input className="input" value={apellido} onChange={e => setApellido(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && buscarPorApellido()} placeholder="García" />
        </div>
        <button className="btn" onClick={buscarPorApellido} disabled={loading}
          style={{ background: '#7c3aed', color: '#fff', height: 38 }}>
          Buscar apellido
        </button>
        {d && (
          <button className="btn" onClick={imprimir} style={{ height: 38 }}>
            Imprimir
          </button>
        )}
      </div>

      {/* Lista de coincidencias por apellido */}
      {matches.length > 0 && !d && (() => {
        const totalPages = Math.ceil(matches.length / MATCH_PAGE_SIZE);
        const pageMatches = matches.slice((matchPage - 1) * MATCH_PAGE_SIZE, matchPage * MATCH_PAGE_SIZE);
        return (
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="muted" style={{ fontSize: '0.78rem', marginBottom: 8 }}>
              {matches.length} persona(s) encontrada(s){totalPages > 1 ? ` — pág. ${matchPage}/${totalPages}` : ' — seleccioná una:'}
            </div>
            {pageMatches.map((m, i) => (
              <div key={i} onClick={() => { setMatches([]); cargar(Number(m.dni)); }}
                style={{ padding: '8px 12px', cursor: 'pointer', borderRadius: 8,
                  background: 'rgba(255,255,255,0.04)', marginBottom: 4,
                  display: 'flex', gap: 12, alignItems: 'center' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(124,58,237,0.18)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}>
                <strong style={{ fontSize: '0.85rem' }}>{m.apellido}, {m.nombre}</strong>
                <span className="muted" style={{ fontSize: '0.75rem' }}>DNI {m.dni}</span>
                {m.cuil && <span className="muted" style={{ fontSize: '0.75rem' }}>CUIL {m.cuil}</span>}
              </div>
            ))}
            {totalPages > 1 && (
              <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn" disabled={matchPage === 1}
                  onClick={() => setMatchPage(p => p - 1)}
                  style={{ padding: '3px 10px', fontSize: '0.8rem' }}>← Ant</button>
                {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map(p => (
                  <button key={p} className="btn" onClick={() => setMatchPage(p)}
                    style={{ padding: '3px 10px', fontSize: '0.8rem',
                      background: p === matchPage ? 'rgba(124,58,237,0.5)' : undefined,
                      fontWeight: p === matchPage ? 700 : undefined }}>{p}</button>
                ))}
                <button className="btn" disabled={matchPage === totalPages}
                  onClick={() => setMatchPage(p => p + 1)}
                  style={{ padding: '3px 10px', fontSize: '0.8rem' }}>Sig →</button>
              </div>
            )}
          </div>
        );
      })()}

      {/* Legajo cargado */}
      {d && (
        <>
          {/* Encabezado del agente */}
          <div className="card" style={{ marginBottom: 8, padding: '12px 16px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>
                {d.datosPersonales?.apellido}, {d.datosPersonales?.nombre}
              </div>
              <div className="muted" style={{ fontSize: '0.8rem' }}>
                DNI {activeDni}
                {d.datosPersonales?.cuil ? ` · CUIL ${d.datosPersonales.cuil}` : ''}
                {d.agente?.legajo ? ` · Legajo ${d.agente.legajo}` : ''}
              </div>
            </div>
            {d.agente?.estado_empleo && (
              <span style={{
                background: d.agente.estado_empleo === 'activo'
                  ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)',
                color: d.agente.estado_empleo === 'activo' ? '#10b981' : '#ef4444',
                borderRadius: 999, padding: '3px 14px', fontSize: '0.78rem', fontWeight: 700,
              }}>
                {String(d.agente.estado_empleo).toUpperCase()}
              </span>
            )}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', marginBottom: 8 }}>
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                style={{
                  padding: '5px 12px', fontSize: '0.76rem', cursor: 'pointer',
                  borderRadius: '6px 6px 0 0', border: 'none', fontWeight: tab === t.key ? 700 : 400,
                  background: tab === t.key ? 'rgba(124,58,237,0.4)' : 'rgba(255,255,255,0.06)',
                  color: tab === t.key ? '#c084fc' : 'rgba(255,255,255,0.6)',
                  borderBottom: tab === t.key ? '2px solid #a855f7' : '2px solid transparent',
                  transition: 'all 0.15s',
                }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Contenido del tab activo */}
          <div ref={printRef} className="card" style={{ padding: 20, minHeight: 300 }}>
            {tab === 'datos'    && <SeccionDatosPersonales d={d.datosPersonales} />}
            {tab === 'foja'     && <SeccionFojaServicios agente={d.agente} servicios={d.servicios ?? []} />}
            {tab === 'bonif'    && <SeccionBonificaciones rows={d.bonificaciones ?? []} />}
            {tab === 'familia'  && (
              <SeccionFamilia
                rows={d.familia ?? []}
                expedientes={d.familiaExpedientes ?? []}
                dni={activeDni}
                onRefresh={refresh}
              />
            )}
            {tab === 'funcDest' && (
              <SeccionFuncionDestino rows={d.funcionDestino ?? []} dni={activeDni} onRefresh={refresh} />
            )}
            {tab === 'licencias' && (
              <SeccionLicencias rows={d.licencias ?? []} dni={activeDni} onRefresh={refresh} />
            )}
            {tab === 'concepto' && (
              <SeccionConceptoMenciones rows={d.conceptoMenciones ?? []} dni={activeDni} onRefresh={refresh} />
            )}
            {tab === 'penas'    && (
              <SeccionPenas rows={d.penas ?? []} dni={activeDni} onRefresh={refresh} />
            )}
            {tab === 'incomp'   && (
              <SeccionIncompatibilidad data={d.incompatibilidad} dni={activeDni} onRefresh={refresh} />
            )}
            {tab === 'embargos' && (
              <SeccionEmbargos rows={d.embargos ?? []} dni={activeDni} onRefresh={refresh} />
            )}
            {tab === 'bienes'   && (
              <SeccionBienes rows={d.declaracionBienes ?? []} dni={activeDni} onRefresh={refresh} />
            )}
          </div>
        </>
      )}
    </Layout>
  );
}

// src/pages/LegajoPage/index.tsx
// Legajo Personal — formulario oficial Provincia de Buenos Aires / Ministerio de Salud
// 16 páginas del legajo con visualización + CRUD para las secciones editables
import React, { useState, useCallback } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch, apiFetchBlob } from '../../api/http';
import { searchPersonal }                from '../../api/searchPersonal';
import { useToast }                     from '../../ui/toast';
import { AlertaBannerAgenteConMensaje } from '../../components/AlertaBannerAgente';
import { ImportarFormulario } from './ImportarFormulario';

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

// Las fechas llegan como ISO completo; los <input type="date"> necesitan YYYY-MM-DD
const normalizarFechas = (row: Record<string, any>): Record<string, any> => {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? v.slice(0, 10) : v;
  }
  return out;
};

// Campos de legajo_datos_personales (mismo listado que el backend)
const CAMPOS_DATOS_LEGAJO = [
  'nro_legajo','reparticion',
  'nac_pais','nac_provincia','nac_partido','estado_civil',
  'clase','dist_militar','cedula_nro','cedula_expedida_por',
  'carta_ciudadania','carta_otorgada_en','carta_fecha','carta_juez_federal',
  'estudios_nivel','estudios_detalle','titulo_secundario','titulo_secundario_otorgado',
  'titulo_universitario','titulo_universitario_otorgado','aptitud_especial',
  'mil_presto','mil_arma','mil_especialidad','mil_grado','mil_destino','mil_motivo_excepcion',
];

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
  const fieldId = `legajo-field-${name}`;
  const style: React.CSSProperties = {
    width: '100%', padding: '6px 10px', background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: '#fff',
    fontSize: '0.82rem', boxSizing: 'border-box',
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <label htmlFor={fieldId} style={{ fontSize: '0.7rem', textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{label}</label>
      {type === 'textarea' ? (
        <textarea id={fieldId} name={name} value={value ?? ''} rows={3}
          onChange={e => onChange(name, e.target.value)} style={{ ...style, resize: 'vertical' }} />
      ) : type === 'select' && options ? (
        <select id={fieldId} name={name} value={value ?? ''} onChange={e => onChange(name, e.target.value)} style={style}>
          <option value="">— Sin dato —</option>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : type === 'checkbox' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4 }}>
          <input id={fieldId} type="checkbox" checked={!!value} onChange={e => onChange(name, e.target.checked)}
            style={{ width: 16, height: 16, cursor: 'pointer' }} />
          <span style={{ fontSize: '0.82rem' }}>{label}</span>
        </div>
      ) : (
        <input id={fieldId} type={type} name={name} value={value ?? ''}
          onChange={e => onChange(name, e.target.value)} style={style} />
      )}
    </div>
  );
}

// ─── SECCIONES ────────────────────────────────────────────────────────────────

// Pie de los modales: Cancelar + Guardar
function PieModal({ onCancel, onSave, saving }: { onCancel: () => void; onSave: () => void; saving: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
      <button onClick={onCancel}
        style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 6,
          padding: '7px 16px', cursor: 'pointer', color: '#fff', fontSize: '0.82rem' }}>
        Cancelar
      </button>
      <BtnGuardar onClick={onSave} saving={saving} />
    </div>
  );
}

function SubTitulo({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ gridColumn: '1 / -1', fontSize: '0.72rem', fontWeight: 700, color: '#c084fc',
      textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 6 }}>{children}</div>
  );
}

// Pág 01-02 — Tapa + Datos Personales (formulario editable; lo de `personal` se muestra de referencia)
function SeccionDatosPersonales({ d, dl, agente, dni, onRefresh }: {
  d: any; dl: any | null; agente: any | null; dni: number; onRefresh: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<Record<string, any>>(() => normalizarFechas(dl ?? {}));
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  if (!d) return <div className="muted">Sin datos personales</div>;

  const guardar = async () => {
    setSaving(true);
    try {
      const body: Record<string, any> = {};
      CAMPOS_DATOS_LEGAJO.forEach(k => { body[k] = form[k] ?? null; });
      await apiFetch(`/legajo/datos-personales/${dni}`, {
        method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
      });
      toast.ok('Datos personales guardados');
      onRefresh();
    } catch (e: any) {
      toast.error('Error al guardar', e?.message);
    } finally {
      setSaving(false);
    }
  };

  const F = (label: string, name: string, type = 'text', options?: { value: string; label: string }[]) => (
    <FormField label={label} name={name} value={form[name]} onChange={set} type={type} options={options} />
  );

  return (
    <>
      <Seccion titulo="Del sistema (se corrigen en Carga de Agente)">
        <Grid>
          <Campo label="Apellido" value={val(d.apellido)} />
          <Campo label="Nombre/s" value={val(d.nombre)} />
          <Campo label="DNI" value={val(d.dni)} />
          <Campo label="CUIL" value={val(d.cuil)} />
          <Campo label="Fecha de Nacimiento" value={fmtDate(d.fecha_nacimiento ?? d.p_fecha_nacimiento)} />
          <Campo label="Sexo" value={val(d.sexo_nombre ?? d.sexo)} />
          <Campo label="Nacionalidad" value={val(d.nacionalidad)} />
          <Campo label="Legajo (sistema)" value={val(agente?.legajo ?? d.legajo)} />
          <Campo label="Repartición (sistema)" value={val(d.reparticion ?? d.dependencia)} />
        </Grid>
      </Seccion>

      <Seccion titulo="Pág. 01-02 — Tapa y Datos Personales del formulario">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          <SubTitulo>Tapa</SubTitulo>
          {F('N° de legajo (si difiere del sistema)', 'nro_legajo')}
          {F('Repartición (si difiere del sistema)', 'reparticion')}

          <SubTitulo>a) Filiación</SubTitulo>
          {F('Nacido en país', 'nac_pais')}
          {F('Provincia', 'nac_provincia')}
          {F('Partido', 'nac_partido')}
          {F('Estado civil', 'estado_civil', 'select', [
            { value: 'SOLTERO', label: 'Soltera/o' }, { value: 'CASADO', label: 'Casada/o' },
            { value: 'VIUDO', label: 'Viuda/o' }, { value: 'SEPARADO', label: 'Separada/o' },
          ])}

          <SubTitulo>b) Identidad</SubTitulo>
          {F('Clase', 'clase')}
          {F('Dist. Militar', 'dist_militar')}
          {F('C. de Identidad N°', 'cedula_nro')}
          {F('Expedida por', 'cedula_expedida_por')}
          {F('Carta de Ciudadanía', 'carta_ciudadania')}
          {F('Otorgada en', 'carta_otorgada_en')}
          {F('Fecha de otorgamiento', 'carta_fecha', 'date')}
          {F('Juez Federal', 'carta_juez_federal')}

          <SubTitulo>c) Aptitud</SubTitulo>
          {F('Estudios cursados — Nivel', 'estudios_nivel', 'select', [
            { value: 'PRIMARIO', label: 'Primario' }, { value: 'SECUNDARIO', label: 'Secundario o técnico' },
            { value: 'UNIVERSITARIO', label: 'Universitario' },
          ])}
          {F('Detalle de estudios', 'estudios_detalle')}
          {F('Título Secundario o Técnico', 'titulo_secundario')}
          {F('Otorgado por', 'titulo_secundario_otorgado')}
          {F('Título Universitario', 'titulo_universitario')}
          {F('Otorgado por', 'titulo_universitario_otorgado')}
          {F('Aptitud especial por Prof. u Oficio', 'aptitud_especial')}

          <SubTitulo>d) Servicios militares</SubTitulo>
          {F('¿Ha prestado servicios militares?', 'mil_presto', 'select', [
            { value: '1', label: 'Sí' }, { value: '0', label: 'No' },
          ])}
          {F('Arma', 'mil_arma')}
          {F('Especialidad', 'mil_especialidad')}
          {F('Grado', 'mil_grado')}
          {F('Destino', 'mil_destino')}
          {F('Motivo de la Excepción', 'mil_motivo_excepcion')}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <BtnGuardar onClick={guardar} saving={saving} />
        </div>
      </Seccion>
    </>
  );
}

// Pág 03 — Rectificaciones (al dorso de datos personales)
function SeccionRectificaciones({ rows, dni, onRefresh }: {
  rows: any[]; dni: number; onRefresh: () => void;
}) {
  const crud = useCrud('legajo_rectificaciones', dni, onRefresh);
  const f = crud.state.form;
  return (
    <Seccion titulo="Pág. 03 — Rectificaciones" accent="#d97706">
      <BtnAgregar onClick={() => crud.open()} />
      <TablaLista
        cols={[
          { key: 'seccion', label: 'Sección' },
          { key: 'fecha', label: 'Fecha', fmt: fmtDate },
          { key: 'norma_legal', label: 'Norma Legal' },
          { key: 'texto', label: 'Rectificación' },
        ]}
        rows={rows}
        onEdit={r => crud.open(r)}
        onDelete={r => crud.remove(r)}
      />
      {crud.state.open && (
        <Modal titulo={crud.state.editing ? 'Editar rectificación' : 'Agregar rectificación'} onClose={crud.close}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Sección" name="seccion" value={f.seccion} onChange={crud.setField} type="select"
              options={[{ value: 'FILIACION', label: 'a) Filiación' }, { value: 'IDENTIDAD', label: 'b) Identidad' },
                { value: 'APTITUD', label: 'c) Aptitud' }]} />
            <FormField label="Fecha" name="fecha" value={f.fecha} onChange={crud.setField} type="date" />
          </div>
          <div style={{ marginTop: 12 }}>
            <FormField label="Norma Legal" name="norma_legal" value={f.norma_legal} onChange={crud.setField} />
          </div>
          <div style={{ marginTop: 12 }}>
            <FormField label="Rectificación" name="texto" value={f.texto} onChange={crud.setField} type="textarea" />
          </div>
          <PieModal onCancel={crud.close} saving={crud.state.saving}
            onSave={() => (f.seccion ? crud.save() : alert('Elegí la sección'))} />
        </Modal>
      )}
    </Seccion>
  );
}

// Pág 06 — Foja de Servicios (carga manual; los tramos del sistema quedan de referencia)
function SeccionFojaServicios({ rows, tramos, dni, onRefresh }: {
  rows: any[]; tramos: any[]; dni: number; onRefresh: () => void;
}) {
  const crud = useCrud('legajo_foja_servicios', dni, onRefresh);
  const f = crud.state.form;
  return (
    <>
      <Seccion titulo="Pág. 06 — Foja de Servicios" accent="#2563eb">
        <BtnAgregar onClick={() => crud.open(undefined, { ministerio: 'SALUD' })} />
        <TablaLista
          cols={[
            { key: 'resolucion', label: 'Resolución/Decreto' },
            { key: 'fecha_ingreso', label: 'Ingreso/Posesión', fmt: fmtDate },
            { key: 'ministerio', label: 'Ministerio' },
            { key: 'dependencia', label: 'Dependencia' },
            { key: 'cargo', label: 'Cargo' },
            { key: 'grupo_ocupacional', label: 'G.O.' },
            { key: 'categoria', label: 'Cat.' },
            { key: 'regimen_horario', label: 'Régimen' },
            { key: 'fecha_baja', label: 'Baja', fmt: fmtDate },
            { key: 'motivo', label: 'Motivo' },
          ]}
          rows={rows}
          onEdit={r => crud.open(r)}
          onDelete={r => crud.remove(r)}
        />
      </Seccion>
      {tramos.length > 0 && (
        <Seccion titulo="Referencia: tramos cargados en el sistema (no se imprimen)" accent="#64748b">
          <TablaLista
            cols={[
              { key: 'fecha_ingreso', label: 'Ingreso', fmt: fmtDate },
              { key: 'fecha_egreso', label: 'Egreso', fmt: fmtDate },
              { key: 'estado_empleo', label: 'Estado' },
              { key: 'decreto_designacion', label: 'Decreto' },
              { key: 'funcion_nombre', label: 'Función' },
              { key: 'categoria_nombre', label: 'Categoría' },
              { key: 'planta_nombre', label: 'Planta' },
              { key: 'regimen_horario_nombre', label: 'Régimen' },
            ]}
            rows={tramos}
          />
        </Seccion>
      )}
      {crud.state.open && (
        <Modal titulo={crud.state.editing ? 'Editar renglón de foja' : 'Agregar renglón de foja'} onClose={crud.close}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Resolución o Decreto (con año)" name="resolucion" value={f.resolucion} onChange={crud.setField} />
            <FormField label="Fecha de ingreso / posesión" name="fecha_ingreso" value={f.fecha_ingreso} onChange={crud.setField} type="date" />
            <FormField label="Ministerio" name="ministerio" value={f.ministerio} onChange={crud.setField} />
            <FormField label="Dependencia" name="dependencia" value={f.dependencia} onChange={crud.setField} />
            <FormField label="Cargo" name="cargo" value={f.cargo} onChange={crud.setField} />
            <FormField label="G.O. (grupo ocupacional)" name="grupo_ocupacional" value={f.grupo_ocupacional} onChange={crud.setField} />
            <FormField label="Categoría" name="categoria" value={f.categoria} onChange={crud.setField} />
            <FormField label="Régimen horario" name="regimen_horario" value={f.regimen_horario} onChange={crud.setField} />
            <FormField label="Baja" name="fecha_baja" value={f.fecha_baja} onChange={crud.setField} type="date" />
            <FormField label="Motivo" name="motivo" value={f.motivo} onChange={crud.setField} />
          </div>
          <PieModal onCancel={crud.close} onSave={crud.save} saving={crud.state.saving} />
        </Modal>
      )}
    </>
  );
}

// Pág 07 — Bonificaciones (3 bis)
function SeccionBonificaciones({ rows, dni, onRefresh }: {
  rows: any[]; dni: number; onRefresh: () => void;
}) {
  const crud = useCrud('bonificaciones', dni, onRefresh);
  const f = crud.state.form;
  return (
    <Seccion titulo="Pág. 07 — Bonificaciones" accent="#0891b2">
      <BtnAgregar onClick={() => crud.open()} />
      <TablaLista
        cols={[
          { key: 'norma_legal', label: 'Norma Legal / Autoridad', fmt: (v, r) => val(v ?? r.decreto_numero) },
          { key: 'fecha', label: 'Fecha', fmt: fmtDate },
          { key: 'a_partir', label: 'A Partir', fmt: fmtDate },
          { key: 'fecha_baja', label: 'Baja', fmt: fmtDate },
          { key: 'motivo', label: 'Motivo' },
          { key: 'expediente', label: 'Expediente' },
          { key: 'anio', label: 'Año' },
        ]}
        rows={rows}
        onEdit={r => crud.open(r)}
        onDelete={r => crud.remove(r)}
      />
      {crud.state.open && (
        <Modal titulo={crud.state.editing ? 'Editar bonificación' : 'Agregar bonificación'} onClose={crud.close}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Norma legal y autoridad que la dicta" name="norma_legal" value={f.norma_legal} onChange={crud.setField} />
            <FormField label="Fecha" name="fecha" value={f.fecha} onChange={crud.setField} type="date" />
            <FormField label="A partir" name="a_partir" value={f.a_partir} onChange={crud.setField} type="date" />
            <FormField label="Baja" name="fecha_baja" value={f.fecha_baja} onChange={crud.setField} type="date" />
            <FormField label="Expediente N°" name="expediente" value={f.expediente} onChange={crud.setField} />
            <FormField label="Año" name="anio" value={f.anio} onChange={crud.setField} type="number" />
          </div>
          <div style={{ marginTop: 12 }}>
            <FormField label="Motivo" name="motivo" value={f.motivo} onChange={crud.setField} />
          </div>
          <div style={{ marginTop: 12 }}>
            <FormField label="Observaciones" name="observaciones" value={f.observaciones} onChange={crud.setField} type="textarea" />
          </div>
          <PieModal onCancel={crud.close} onSave={crud.save} saving={crud.state.saving} />
        </Modal>
      )}
    </Seccion>
  );
}

// Pág 10 — Licencias concepto 06 (formulario 55/80)
function SeccionLicencias06({ rows, dni, onRefresh }: {
  rows: any[]; dni: number; onRefresh: () => void;
}) {
  const crud = useCrud('legajo_licencias_06', dni, onRefresh);
  const f = crud.state.form;
  return (
    <Seccion titulo="Pág. 10 — Licencias Concepto 06 (form. 55/80)" accent="#0891b2">
      <BtnAgregar onClick={() => crud.open(undefined, { concepto: '06' })} />
      <TablaLista
        cols={[
          { key: 'codigo_trabajo', label: 'Cód.' },
          { key: 'subconcepto', label: 'Subc.' },
          { key: 'inciso', label: 'Inc.' },
          { key: 'norma_numero', label: 'Norma', fmt: (_v, r) => [r.norma_codigo, r.norma_numero, r.norma_anio].filter(Boolean).join(' / ') || '—' },
          { key: 'fecha_desde', label: 'Desde', fmt: fmtDate },
          { key: 'fecha_hasta', label: 'Hasta', fmt: fmtDate },
          { key: 'dias_con_sueldo', label: 'C/S' },
          { key: 'dias_50', label: '50%' },
          { key: 'dias_sin_sueldo', label: 'S/S' },
          { key: 'acum_con_sueldo', label: 'Acum C/S' },
          { key: 'acum_50', label: 'Acum 50%' },
          { key: 'acum_sin_sueldo', label: 'Acum S/S' },
        ]}
        rows={rows}
        onEdit={r => crud.open(r)}
        onDelete={r => crud.remove(r)}
      />
      {crud.state.open && (
        <Modal titulo={crud.state.editing ? 'Editar renglón 55/80' : 'Agregar renglón 55/80'} onClose={crud.close}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <SubTitulo>Dirección de Personal</SubTitulo>
            <FormField label="Código de trabajo" name="codigo_trabajo" value={f.codigo_trabajo} onChange={crud.setField} />
            <FormField label="Concepto" name="concepto" value={f.concepto} onChange={crud.setField} />
            <FormField label="Subconcepto" name="subconcepto" value={f.subconcepto} onChange={crud.setField} />
            <FormField label="Inciso" name="inciso" value={f.inciso} onChange={crud.setField} />
            <FormField label="N° legajo Contaduría" name="legajo_contaduria" value={f.legajo_contaduria} onChange={crud.setField} />
            <SubTitulo>Norma legal</SubTitulo>
            <FormField label="Código" name="norma_codigo" value={f.norma_codigo} onChange={crud.setField} />
            <FormField label="Número" name="norma_numero" value={f.norma_numero} onChange={crud.setField} />
            <FormField label="Año" name="norma_anio" value={f.norma_anio} onChange={crud.setField} />
            <div />
            <SubTitulo>Período</SubTitulo>
            <FormField label="Desde" name="fecha_desde" value={f.fecha_desde} onChange={crud.setField} type="date" />
            <FormField label="Hasta" name="fecha_hasta" value={f.fecha_hasta} onChange={crud.setField} type="date" />
            <div /><div />
            <SubTitulo>Total de días tomados o concedidos</SubTitulo>
            <FormField label="Con sueldo" name="dias_con_sueldo" value={f.dias_con_sueldo} onChange={crud.setField} type="number" />
            <FormField label="Con 50 %" name="dias_50" value={f.dias_50} onChange={crud.setField} type="number" />
            <FormField label="Sin sueldo" name="dias_sin_sueldo" value={f.dias_sin_sueldo} onChange={crud.setField} type="number" />
            <div />
            <SubTitulo>Acumulados</SubTitulo>
            <FormField label="Con sueldo" name="acum_con_sueldo" value={f.acum_con_sueldo} onChange={crud.setField} type="number" />
            <FormField label="Con 50 %" name="acum_50" value={f.acum_50} onChange={crud.setField} type="number" />
            <FormField label="Sin sueldo" name="acum_sin_sueldo" value={f.acum_sin_sueldo} onChange={crud.setField} type="number" />
          </div>
          <div style={{ marginTop: 12 }}>
            <FormField label="Observaciones" name="observaciones" value={f.observaciones} onChange={crud.setField} type="textarea" />
          </div>
          <PieModal onCancel={crud.close} onSave={crud.save} saving={crud.state.saving} />
        </Modal>
      )}
    </Seccion>
  );
}

// Pág 13 — Domicilio (historial)
function SeccionDomicilios({ rows, actual, dni, onRefresh }: {
  rows: any[]; actual: any; dni: number; onRefresh: () => void;
}) {
  const crud = useCrud('legajo_domicilios', dni, onRefresh);
  const f = crud.state.form;
  // Prellena el renglón con el domicilio que figura hoy en el sistema (se puede editar antes de guardar)
  const copiarActual = () => {
    const calle = [actual?.domicilio, actual?.numerodomicilio,
      actual?.piso ? `piso ${actual.piso}` : '', actual?.depto ? `depto ${actual.depto}` : '']
      .filter(Boolean).join(' ');
    crud.setField('calle_numero', calle || null);
    crud.setField('telefono', actual?.telefono ?? null);
    crud.setField('partido', actual?.municipio_nombre ?? null);
    crud.setField('localidad', actual?.localidad_nombre ?? null);
    crud.setField('codigo_partido', actual?.municipio_codigo ?? null);
    crud.setField('codigo_localidad', actual?.localidad_codigo ?? null);
  };
  return (
    <Seccion titulo="Pág. 13 — Domicilio" accent="#059669">
      <BtnAgregar onClick={() => crud.open()} />
      <TablaLista
        cols={[
          { key: 'expediente', label: 'Expediente' },
          { key: 'fecha', label: 'Fecha', fmt: fmtDate },
          { key: 'calle_numero', label: 'Calle y Número' },
          { key: 'telefono', label: 'T.E.' },
          { key: 'partido', label: 'Partido' },
          { key: 'localidad', label: 'Localidad' },
          { key: 'codigo_partido', label: 'Cód. Partido' },
          { key: 'codigo_localidad', label: 'Cód. Localidad' },
        ]}
        rows={rows}
        onEdit={r => crud.open(r)}
        onDelete={r => crud.remove(r)}
      />
      {crud.state.open && (
        <Modal titulo={crud.state.editing ? 'Editar domicilio' : 'Agregar domicilio'} onClose={crud.close}>
          <button onClick={copiarActual}
            style={{ background: 'rgba(124,58,237,0.25)', color: '#c084fc', border: 'none', borderRadius: 6,
              padding: '4px 12px', cursor: 'pointer', fontSize: '0.76rem', marginBottom: 12 }}>
            Copiar domicilio actual del sistema
          </button>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Expediente (letra y N°)" name="expediente" value={f.expediente} onChange={crud.setField} />
            <FormField label="Fecha" name="fecha" value={f.fecha} onChange={crud.setField} type="date" />
            <FormField label="Calle y número" name="calle_numero" value={f.calle_numero} onChange={crud.setField} />
            <FormField label="T.E." name="telefono" value={f.telefono} onChange={crud.setField} />
            <FormField label="Partido" name="partido" value={f.partido} onChange={crud.setField} />
            <FormField label="Localidad" name="localidad" value={f.localidad} onChange={crud.setField} />
            <FormField label="Código de partido" name="codigo_partido" value={f.codigo_partido} onChange={crud.setField} />
            <FormField label="Código de localidad" name="codigo_localidad" value={f.codigo_localidad} onChange={crud.setField} />
          </div>
          <PieModal onCancel={crud.close} onSave={crud.save} saving={crud.state.saving} />
        </Modal>
      )}
    </Seccion>
  );
}

// ─── SECCIONES EDITABLES ─────────────────────────────────────────────────────

type CrudState = { open: boolean; editing: any | null; form: Record<string, any>; saving: boolean };
const emptyCrud = (): CrudState => ({ open: false, editing: null, form: {}, saving: false });

function useCrud(table: string, dni: number, onRefresh: () => void) {
  const toast = useToast();
  const [state, setState] = useState<CrudState>(emptyCrud());

  const open = (row?: any, defaults?: Record<string, any>) => {
    setState({ open: true, editing: row ?? null,
      form: row ? normalizarFechas(row) : { dni, ...defaults }, saving: false });
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
            { key: 'dni_familiar', label: 'DNI' },
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
            <FormField label="DNI del familiar" name="dni_familiar" value={f.dni_familiar}
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
  // registros viejos: un solo "otro cargo" con nivel → se muestra en su renglón
  const cargoEn = (nivel: string, nuevo: any) => val(nuevo || (d.otro_cargo_nivel === nivel ? d.otro_cargo_lugar : null));
  return (
    <Seccion titulo="Pág. 14 — Declaración de Incompatibilidad" accent="#9333ea">
      {data ? (
        <>
          <Grid>
            <Campo label="Fecha Declaración" value={fmtDate(d.fecha_declaracion)} />
            <Campo label="¿Jubilación, Pensión o Retiro?" value={d.tiene_jubilacion ? val(d.jubilacion_tipo ?? 'Sí') : 'No'} />
            {d.tiene_jubilacion ? (
              <>
                <Campo label="Ley número" value={val(d.jubilacion_ley)} />
                <Campo label="Caja" value={val(d.jubilacion_caja)} />
                <Campo label="Monto mensual" value={fmtMoney(d.jubilacion_monto)} />
                <Campo label="Fecha de otorgamiento" value={fmtDate(d.jubilacion_fecha)} />
              </>
            ) : null}
            <Campo label="¿Otro cargo?" value={bool(d.otro_cargo)} />
            {d.otro_cargo ? (
              <>
                <Campo label="Nacional" value={cargoEn('NACIONAL', d.cargo_nacional)} />
                <Campo label="Provincial" value={cargoEn('PROVINCIAL', d.cargo_provincial)} />
                <Campo label="Municipal" value={cargoEn('MUNICIPAL', d.cargo_municipal)} />
                <Campo label="Lugar" value={val(d.otro_cargo_lugar)} />
                <Campo label="Horario" value={val(d.otro_cargo_horario)} />
                <Campo label="Monto" value={fmtMoney(d.otro_cargo_monto)} />
                <Campo label="Fecha Ingreso" value={fmtDate(d.otro_cargo_fecha_ingreso)} />
              </>
            ) : null}
            <Campo label="Otras Actividades (carácter)" value={val(d.otras_actividades)} />
            <Campo label="Lugar" value={val(d.otras_actividades_lugar)} />
            <Campo label="Monto" value={fmtMoney(d.otras_actividades_monto)} />
            <Campo label="Fecha Ingreso" value={fmtDate(d.otras_actividades_fecha)} />
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
            <SubTitulo>Jubilación, pensión o retiro</SubTitulo>
            <FormField label="Tiene jubilación, pensión o retiro" name="tiene_jubilacion" value={f.tiene_jubilacion}
              onChange={crud.setField} type="checkbox" />
            {f.tiene_jubilacion ? (
              <>
                <FormField label="Tipo" name="jubilacion_tipo" value={f.jubilacion_tipo} onChange={crud.setField}
                  type="select" options={['JUBILACION','PENSION','RETIRO'].map(v => ({ value: v, label: v }))} />
                <FormField label="Ley número" name="jubilacion_ley" value={f.jubilacion_ley} onChange={crud.setField} />
                <FormField label="Caja" name="jubilacion_caja" value={f.jubilacion_caja} onChange={crud.setField} />
                <FormField label="Monto mensual" name="jubilacion_monto" value={f.jubilacion_monto}
                  onChange={crud.setField} type="number" />
                <FormField label="Fecha de otorgamiento" name="jubilacion_fecha" value={f.jubilacion_fecha}
                  onChange={crud.setField} type="date" />
              </>
            ) : <div />}
            <SubTitulo>Otro cargo</SubTitulo>
            <FormField label="Desempeña algún otro cargo" name="otro_cargo" value={f.otro_cargo}
              onChange={crud.setField} type="checkbox" />
            {f.otro_cargo ? (
              <>
                <div />
                <FormField label="Nacional" name="cargo_nacional" value={f.cargo_nacional} onChange={crud.setField} />
                <FormField label="Provincial" name="cargo_provincial" value={f.cargo_provincial} onChange={crud.setField} />
                <FormField label="Municipal" name="cargo_municipal" value={f.cargo_municipal} onChange={crud.setField} />
                <FormField label="Lugar donde lo desempeña" name="otro_cargo_lugar" value={f.otro_cargo_lugar}
                  onChange={crud.setField} />
                <FormField label="Horario" name="otro_cargo_horario" value={f.otro_cargo_horario} onChange={crud.setField} />
                <FormField label="Monto sueldo, comisión u honorarios" name="otro_cargo_monto" value={f.otro_cargo_monto}
                  onChange={crud.setField} type="number" />
                <FormField label="Fecha de ingreso" name="otro_cargo_fecha_ingreso"
                  value={f.otro_cargo_fecha_ingreso} onChange={crud.setField} type="date" />
              </>
            ) : <div />}
            <SubTitulo>Otras actividades</SubTitulo>
            <FormField label="Otras actividades (carácter)" name="otras_actividades" value={f.otras_actividades}
              onChange={crud.setField} />
            <FormField label="Lugar donde las desempeña" name="otras_actividades_lugar" value={f.otras_actividades_lugar}
              onChange={crud.setField} />
            <FormField label="Monto sueldo, comisión u honorarios" name="otras_actividades_monto"
              value={f.otras_actividades_monto} onChange={crud.setField} type="number" />
            <FormField label="Fecha de ingreso" name="otras_actividades_fecha" value={f.otras_actividades_fecha}
              onChange={crud.setField} type="date" />
          </div>
          <div style={{ marginTop: 12 }}>
            <FormField label="Observaciones" name="observaciones" value={f.observaciones}
              onChange={crud.setField} type="textarea" />
          </div>
          <PieModal onCancel={crud.close} onSave={crud.save} saving={crud.state.saving} />
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
  | 'rectif'
  | 'familia'
  | 'foja'
  | 'bonif'
  | 'funcDest'
  | 'licencias'
  | 'lic06'
  | 'concepto'
  | 'penas'
  | 'domicilio'
  | 'incomp'
  | 'embargos'
  | 'bienes';

// Hojas del PDF oficial (assets/legajo/plantilla_legajo.pdf en la API)
const HOJAS_LEGAJO: { n: number; label: string }[] = [
  { n: 1,  label: 'Tapa' },
  { n: 2,  label: '1) Datos personales' },
  { n: 3,  label: 'Rectificaciones' },
  { n: 4,  label: '2) Familia' },
  { n: 5,  label: '2 bis) Expedientes familia' },
  { n: 6,  label: '3) Foja de servicios' },
  { n: 7,  label: '3 bis) Bonificaciones' },
  { n: 8,  label: '4) Función y destino' },
  { n: 9,  label: '5) Licencias' },
  { n: 10, label: '6) Licencias concepto 06' },
  { n: 11, label: '7) Concepto y menciones' },
  { n: 12, label: '8) Penas disciplinarias' },
  { n: 13, label: '9) Domicilio' },
  { n: 14, label: '10) Incompatibilidad' },
  { n: 15, label: '11) Embargos' },
  { n: 16, label: '12) Declaración de bienes' },
];

// Mismo orden que las hojas del formulario oficial
const TABS: { key: TabKey; label: string }[] = [
  { key: 'datos',     label: '1) Datos Personales' },
  { key: 'rectif',    label: 'Rectificaciones' },
  { key: 'familia',   label: '2) Familia' },
  { key: 'foja',      label: '3) Foja de Servicios' },
  { key: 'bonif',     label: '3 bis) Bonificaciones' },
  { key: 'funcDest',  label: '4) Función y Destino' },
  { key: 'licencias', label: '5) Licencias' },
  { key: 'lic06',     label: '6) Licencias 55/80' },
  { key: 'concepto',  label: '7) Concepto / Menciones' },
  { key: 'penas',     label: '8) Penas Disciplinarias' },
  { key: 'domicilio', label: '9) Domicilio' },
  { key: 'incomp',    label: '10) Incompatibilidad' },
  { key: 'embargos',  label: '11) Embargos' },
  { key: 'bienes',    label: '12) Decl. de Bienes' },
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
  const [hojaImprimir, setHojaImprimir] = useState<number>(0);  // 0 = legajo completo
  const [importando, setImportando] = useState(false);

  // refrescar = recarga tras guardar: no vacía la pantalla ni cambia de pestaña
  const cargar = useCallback(async (dniNum: number, refrescar = false) => {
    setLoading(true);
    if (!refrescar) setData(null);
    try {
      const res = await apiFetch<{ ok: boolean; data: any }>(`/legajo/${dniNum}`);
      if (!res.ok) throw new Error('No encontrado');
      setData(res.data);
      setActiveDni(dniNum);
      if (!refrescar) {
        setTab('datos');
        toast.ok('Legajo cargado');
      }
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
    if (activeDni) cargar(activeDni, true);
  }, [activeDni, cargar]);

  // Abre el legajo completado sobre el PDF original del Ministerio (lo arma la API)
  const imprimir = async () => {
    if (!activeDni) return;
    const w = window.open('', '_blank');  // se abre antes del await para que no lo bloquee el navegador
    if (!w) { toast.error('El navegador bloqueó la ventana del PDF'); return; }
    w.document.write('<p style="font-family:sans-serif">Generando el legajo…</p>');
    try {
      const blob = await apiFetchBlob(`/legajo/${activeDni}/pdf${hojaImprimir ? `?hojas=${hojaImprimir}` : ''}`);
      w.location.href = URL.createObjectURL(blob);
    } catch (e: any) {
      w.close();
      toast.error('No se pudo generar el PDF', e?.message);
    }
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
          <label htmlFor="legajo-dni" className="muted" style={{ display: 'block', fontSize: '0.75rem', marginBottom: 4 }}>DNI</label>
          <input id="legajo-dni" name="dni" className="input" value={dni} onChange={e => setDni(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && buscarPorDni()} placeholder="25123456" />
        </div>
        <button className="btn" onClick={() => buscarPorDni()} disabled={loading}
          style={{ background: '#2563eb', color: '#fff', height: 38 }}>
          {loading ? '⏳' : 'Buscar DNI'}
        </button>
        <div style={{ flex: '2 1 200px' }}>
          <label htmlFor="legajo-apellido" className="muted" style={{ display: 'block', fontSize: '0.75rem', marginBottom: 4 }}>APELLIDO</label>
          <input id="legajo-apellido" name="apellido" className="input" value={apellido} onChange={e => setApellido(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && buscarPorApellido()} placeholder="García" />
        </div>
        <button className="btn" onClick={buscarPorApellido} disabled={loading}
          style={{ background: '#7c3aed', color: '#fff', height: 38 }}>
          Buscar apellido
        </button>
        <button className="btn" onClick={() => setImportando(true)} style={{ height: 38 }}
          title="Importar respuestas del formulario de Google">
          📥 Importar formulario
        </button>
        {d && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
            <div>
              <label htmlFor="legajo-hoja" className="muted" style={{ display: 'block', fontSize: '0.75rem', marginBottom: 4 }}>IMPRIMIR</label>
              <select id="legajo-hoja" className="input" value={hojaImprimir}
                onChange={e => setHojaImprimir(Number(e.target.value))} style={{ height: 38 }}>
                <option value={0}>Legajo completo (16 hojas)</option>
                {HOJAS_LEGAJO.map(h => <option key={h.n} value={h.n}>Hoja {h.n} — {h.label}</option>)}
              </select>
            </div>
            <button className="btn" onClick={imprimir} style={{ height: 38 }}>
              🖨️ Imprimir
            </button>
          </div>
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

          <AlertaBannerAgenteConMensaje dni={activeDni || null} />

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
          <div className="card" style={{ padding: 20, minHeight: 300 }}>
            {tab === 'datos'    && (
              <SeccionDatosPersonales key={activeDni} d={d.datosPersonales} dl={d.datosLegajo}
                agente={d.agente} dni={activeDni} onRefresh={refresh} />
            )}
            {tab === 'rectif'   && (
              <SeccionRectificaciones rows={d.rectificaciones ?? []} dni={activeDni} onRefresh={refresh} />
            )}
            {tab === 'foja'     && (
              <SeccionFojaServicios rows={d.fojaServicios ?? []} tramos={d.tramos ?? []}
                dni={activeDni} onRefresh={refresh} />
            )}
            {tab === 'bonif'    && (
              <SeccionBonificaciones rows={d.bonificaciones ?? []} dni={activeDni} onRefresh={refresh} />
            )}
            {tab === 'lic06'    && (
              <SeccionLicencias06 rows={d.licencias06 ?? []} dni={activeDni} onRefresh={refresh} />
            )}
            {tab === 'domicilio' && (
              <SeccionDomicilios rows={d.domicilios ?? []} actual={d.datosPersonales}
                dni={activeDni} onRefresh={refresh} />
            )}
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
      {importando && (
        <ImportarFormulario onClose={() => setImportando(false)} onImportado={refresh} />
      )}
    </Layout>
  );
}

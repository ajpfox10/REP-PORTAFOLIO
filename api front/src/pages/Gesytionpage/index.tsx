// src/pages/GestionPage/index.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { Layout } from '../../components/Layout';
import { useToast } from '../../ui/toast';
import { apiFetch } from '../../api/http';
import { useAuth } from '../../auth/AuthProvider';
import { exportToExcel, exportToPdf, exportToWord, printTable } from '../../utils/export';
import { loadSession } from '../../auth/session';

import { useAgenteSearch } from './hooks/useAgenteSearch';
import { useModules, type ModuleKey } from './hooks/useModules';
import { usePedidos } from './hooks/usePedidos';
import { useDocumentos } from './hooks/useDocumentos';
import { useCellModal } from './hooks/useCellModal';
import { useDebounce } from './hooks/useDebounce';

import { AgenteSearchForm } from './components/components/AgenteSearchForm';
import { AgenteInfoCard } from './components/components/AgenteInfoCard';
import { ModuleGrid } from './components/components/ModuleGrid';
import ModuleDetailView from './components/components/ModuleDetailView';
import { MatchesList } from './components/components/MatchesList';
import { FotoCredencialCard } from './components/components/FotoCredencialCard';
import { PedidoModal } from './components/modals/PedidoModal';
import { CellModal } from './components/modals/CellModal';
import { DocViewerModal } from './components/modals/DocViewerModal';
import { GestionDocumentPreview } from './components/components/GestionDocumentPreview';

import './styles/GestionPage.css';

// ─── Panel edición inline ──────────────────────────────────────────────────────

// Catálogos con: key del campo FK, label visible, endpoint API, campo nombre en la respuesta
const CATALOG_DEFS = [
  { key: 'sexo_id',            label: 'SEXO',            endpoint: '/sexos',             nombreField: 'nombre' },
  { key: 'localidad_id',       label: 'LOCALIDAD',       endpoint: '/localidades',        nombreField: 'localidad_nombre' },
  { key: 'ley_id',             label: 'LEY',             endpoint: '/ley',               nombreField: 'nombre' },
  { key: 'planta_id',          label: 'PLANTA',          endpoint: '/plantas',           nombreField: 'nombre' },
  { key: 'categoria_id',       label: 'CATEGORÍA',       endpoint: '/categorias',        nombreField: 'nombre' },
  { key: 'funcion_id',         label: 'FUNCIÓN',         endpoint: '/funciones',         nombreField: 'nombre' },
  { key: 'ocupacion_id',       label: 'OCUPACIÓN',       endpoint: '/ocupaciones',       nombreField: 'nombre' },
  { key: 'regimen_horario_id', label: 'RÉGIMEN HORARIO', endpoint: '/regimenes_horarios', nombreField: 'nombre' },
  { key: 'dependencia_id',     label: 'DEPENDENCIA',     endpoint: '/dependencias',      nombreField: 'nombre' },
  { key: 'sector_id',          label: 'SECTOR/REPART.',  endpoint: '/reparticiones',     nombreField: 'reparticion_nombre' },
] as const;

// Todos los campos PATCH — tabla personal
const PATCH_PERSONAL_COLS = [
  'apellido','nombre','cuil','fecha_nacimiento','sexo_id',
  'email','telefono','domicilio','numerodomicilio','depto','piso',
  'observacionesdireccion','cp','localidad_id','nacionalidad',
  'observaciones',
];
// Todos los campos PATCH — tabla agentes
const PATCH_AGENTE_COLS = [
  'ley_id','planta_id','categoria_id','funcion_id','ocupacion_id',
  'regimen_horario_id','sector_id','dependencia_id','fecha_ingreso','fecha_egreso',
  'legajo','salario_mensual','estado_empleo',
];
const ALL_PATCH_COLS = [...PATCH_PERSONAL_COLS, ...PATCH_AGENTE_COLS];

function AgenteEditPanel({ row, onSaved }: { row: any; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // catalogs[key] = array de { id, nombre } (normalizado)
  const [catalogs, setCatalogs] = useState<Record<string, { id: number | string; label: string }[]>>({});
  const [loadingCatalogs, setLoadingCatalogs] = useState(false);

  // Cargar catálogos la primera vez que se expande
  useEffect(() => {
    if (!expanded || Object.keys(catalogs).length > 0) return;
    setLoadingCatalogs(true);
    Promise.all(
      CATALOG_DEFS.map(cf =>
        apiFetch<any>(`${cf.endpoint}?limit=2000`)
          .then(res => {
            // apiFetch devuelve { ok, data: [...] } — extraer el array correctamente
            // IMPORTANTE: [] falsy bug: usar Array.isArray en vez de ||
            let raw: any[] = [];
            if (Array.isArray(res)) raw = res;
            else if (Array.isArray(res?.data)) raw = res.data;
            else if (Array.isArray(res?.rows)) raw = res.rows;

            const nombreField = (cf as any).nombreField;
            const items = raw
              .map((o: any) => {
                const id = o.id ?? o.ID;
                const labelVal = o[nombreField] ?? o.nombre ?? o.ID ?? id;
                const label = labelVal != null ? String(labelVal) : '';
                return { id, label };
              })
              .filter(o => o.id != null && o.label !== '');

            return { key: cf.key, items };
          })
          .catch(() => ({ key: cf.key, items: [] }))
      )
    ).then(results => {
      const map: Record<string, { id: number | string; label: string }[]> = {};
      results.forEach(r => { map[r.key] = r.items; });
      setCatalogs(map);
    }).finally(() => setLoadingCatalogs(false));
  }, [expanded]);

  // Al cambiar el agente cargado, inicializar el formulario
  useEffect(() => {
    if (!row) return;
    const f: any = { ...row };
    // Truncar campos datetime → solo fecha
    for (const k of ['fecha_nacimiento','fecha_ingreso','fecha_egreso']) {
      if (f[k] && String(f[k]).length > 10) f[k] = String(f[k]).slice(0, 10);
    }
    setForm(f);
  }, [row?.dni]);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const payload: any = {};

      // Campos que son int en DB pero no terminan en _id
      const INT_FIELDS   = new Set(['numerodomicilio','piso','legajo']);
      // Campos que son decimal en DB
      const FLOAT_FIELDS = new Set(['salario_mensual']);
      // Campos que NO aceptan null en el schema (solo optional, no nullable)
      // Si están vacíos, NO los incluimos en el payload en vez de mandar null
      const SKIP_IF_EMPTY = new Set(['cuil','apellido','nombre']);

      ALL_PATCH_COLS.forEach(k => {
        if (form[k] === undefined) return;
        const v = form[k];

        // Campos que no pueden ser null: omitir si vacíos
        if (SKIP_IF_EMPTY.has(k)) {
          if (v === '' || v === null) return; // no incluir
          payload[k] = v;
          return;
        }

        if (k.endsWith('_id') || INT_FIELDS.has(k)) {
          payload[k] = (v === '' || v === null) ? null : Number(v) || null;
        } else if (FLOAT_FIELDS.has(k)) {
          payload[k] = (v === '' || v === null) ? null : parseFloat(v) || null;
        } else {
          payload[k] = v === '' ? null : v;
        }
      });

      await apiFetch<any>(`/personal/${row.dni}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      toast.ok('Agente actualizado correctamente');
      onSaved();
    } catch (e: any) {
      // Intentar extraer detalles de validación Zod del backend
      const details = e?.details;
      let msg = e?.message || 'Error desconocido';

      // Si viene fieldErrors de Zod, armar mensaje legible
      const fieldErrors = details?.details?.fieldErrors || details?.fieldErrors;
      if (fieldErrors && typeof fieldErrors === 'object') {
        const parts: string[] = [];
        for (const [campo, errores] of Object.entries(fieldErrors)) {
          const errs = Array.isArray(errores) ? (errores as string[]).join(', ') : String(errores);
          parts.push(`${campo}: ${errs}`);
        }
        if (parts.length) msg = parts.join('\n');
      }

      toast.error('Error al guardar', msg);
    } finally {
      setSaving(false);
    }
  };

  if (!row) return null;

  const fieldStyle = { width: '100%', boxSizing: 'border-box' as const, fontSize: '0.84rem' };
  const labelStyle = { fontSize: '0.68rem', color: '#94a3b8', marginBottom: 2 };
  const sectionStyle = { fontSize: '0.72rem', color: '#64748b', fontWeight: 600 as const, margin: '10px 0 4px' };

  // Render un <select> con opciones del catálogo, mostrando nombre y guardando id
  const renderCatalogSelect = (key: string, label: string) => {
    const options = catalogs[key] || [];
    const currentVal = form[key] ?? '';
    return (
      <div key={key}>
        <div style={labelStyle}>{label}</div>
        <select className="input" value={String(currentVal)} style={fieldStyle}
          onChange={e => set(key, e.target.value)}>
          <option value="">— sin asignar —</option>
          {options.map(o => (
            <option key={o.id} value={String(o.id)}>{o.label}</option>
          ))}
          {/* Si el valor actual no está en el catálogo (datos legacy), mostrarlo igual */}
          {currentVal !== '' && !options.find(o => String(o.id) === String(currentVal)) && (
            <option value={String(currentVal)}>ID: {currentVal} (no encontrado)</option>
          )}
        </select>
      </div>
    );
  };

  // Render un campo texto simple
  const renderText = (key: string, label: string, type = 'text') => (
    <div key={key}>
      <div style={labelStyle}>{label}</div>
      <input className="input" type={type} value={form[key] ?? ''} style={fieldStyle}
        onChange={e => set(key, e.target.value)} />
    </div>
  );

  return (
    <div className="card gp-card-14" style={{ marginTop: 8 }}>
      <div className="row gp-row-between-center" style={{ marginBottom: 8 }}>
        <strong style={{ fontSize: '0.88rem' }}>✏️ Editar datos del agente</strong>
        <button className="btn" type="button"
          style={{ padding: '2px 10px', fontSize: '0.8rem' }}
          onClick={() => setExpanded(v => !v)}>
          {expanded ? '▲ Cerrar' : '▼ Ver todos los campos'}
        </button>
      </div>

      {/* ── Campos siempre visibles: identificación básica ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
        <div>
          <div style={labelStyle}>APELLIDO</div>
          <input className="input" value={form.apellido || ''} style={fieldStyle}
            onChange={e => set('apellido', e.target.value.toUpperCase())} />
        </div>
        <div>
          <div style={labelStyle}>NOMBRE</div>
          <input className="input" value={form.nombre || ''} style={fieldStyle}
            onChange={e => set('nombre', e.target.value.toUpperCase())} />
        </div>
        <div>
          <div style={labelStyle}>CUIL</div>
          <input className="input" value={form.cuil || ''} style={fieldStyle}
            onChange={e => set('cuil', e.target.value)} />
        </div>
        <div>
          <div style={labelStyle}>EMAIL</div>
          <input className="input" type="email" value={form.email || ''} style={fieldStyle}
            onChange={e => set('email', e.target.value)} />
        </div>
      </div>

      {/* ── Campos expandidos ── */}
      {expanded && (
        <div style={{ marginTop: 8 }}>
          {loadingCatalogs && (
            <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: 6 }}>⏳ Cargando catálogos…</div>
          )}

          {/* DATOS PERSONALES */}
          <div style={sectionStyle}>— DATOS PERSONALES —</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
            {renderText('telefono', 'TELÉFONO')}
            {renderText('fecha_nacimiento', 'F. NACIMIENTO', 'date')}
            {renderCatalogSelect('sexo_id', 'SEXO')}
            {renderText('nacionalidad', 'NACIONALIDAD')}

            {/* Domicilio */}
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={labelStyle}>CALLE (DOMICILIO)</div>
              <input className="input" value={form.domicilio || ''} style={fieldStyle}
                onChange={e => set('domicilio', e.target.value)} />
            </div>
            {renderText('numerodomicilio', 'NRO. DOMICILIO')}
            {renderText('piso', 'PISO')}
            {renderText('depto', 'DEPTO')}
            {renderText('cp', 'CÓDIGO POSTAL')}
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={labelStyle}>OBS. DIRECCIÓN</div>
              <input className="input" value={form.observacionesdireccion || ''} style={fieldStyle}
                onChange={e => set('observacionesdireccion', e.target.value)} />
            </div>
            {renderCatalogSelect('localidad_id', 'LOCALIDAD')}

            <div>
              <div style={labelStyle}>ESTADO EMPLEO</div>
              <select className="input" value={form.estado_empleo || ''} style={fieldStyle}
                onChange={e => set('estado_empleo', e.target.value)}>
                <option value="">— sin asignar —</option>
                <option value="ACTIVO">ACTIVO</option>
                <option value="INACTIVO">INACTIVO</option>
                <option value="BAJA">BAJA</option>
              </select>
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <div style={labelStyle}>OBSERVACIONES</div>
              <textarea className="input" value={form.observaciones || ''} rows={2}
                style={{ ...fieldStyle, resize: 'vertical' }}
                onChange={e => set('observaciones', e.target.value)} />
            </div>
          </div>

          {/* DATOS LABORALES */}
          <div style={sectionStyle}>— DATOS LABORALES —</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
            {renderCatalogSelect('ley_id', 'LEY')}
            {renderCatalogSelect('planta_id', 'PLANTA')}
            {renderCatalogSelect('categoria_id', 'CATEGORÍA')}
            {renderCatalogSelect('funcion_id', 'FUNCIÓN')}
            {renderCatalogSelect('ocupacion_id', 'OCUPACIÓN')}
            {renderCatalogSelect('regimen_horario_id', 'RÉGIMEN HORARIO')}
            {renderCatalogSelect('dependencia_id', 'DEPENDENCIA')}
            {renderCatalogSelect('sector_id', 'SECTOR / REPARTICIÓN')}
            {renderText('fecha_ingreso', 'F. INGRESO', 'date')}
            {renderText('fecha_egreso', 'F. EGRESO', 'date')}
            {renderText('legajo', 'LEGAJO')}
            {renderText('salario_mensual', 'SALARIO MENSUAL')}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10, gap: 8 }}>
        {expanded && (
          <button className="btn" type="button" onClick={() => setForm({ ...row })}
            style={{ fontSize: '0.8rem' }}>
            ↩ Revertir
          </button>
        )}
        <button className="btn" type="button" disabled={saving} onClick={save}
          style={{ background: '#2563eb', color: '#fff', borderColor: '#1d4ed8' }}>
          {saving ? '⏳ Guardando…' : '💾 Guardar'}
        </button>
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export function GestionPage() {
  const toast = useToast();
  const { hasPerm } = useAuth();
  // Solo admins con permisos específicos pueden editar agentes
  const canEdit = hasPerm('personal:write') || hasPerm('crud:*:*') || hasPerm('crud:personal:update');

  // Hooks — useAgenteSearch y useModules usan useToast() internamente
  const agenteSearch = useAgenteSearch();
  const debouncedDni = useDebounce(agenteSearch.dni, 500);

  // useModules solo necesita cleanDni (usa useToast internamente)
  const { modules, loadModule, closeModule, setSelectedIndex, setTablePage, setTablePageSize, getSelectedRow } =
    useModules(agenteSearch.cleanDni);

  const pedidos = usePedidos(agenteSearch.cleanDni, modules.pedidos);
  const documentos = useDocumentos(agenteSearch.cleanDni);
  const cellModal = useCellModal(toast);

  const [matches, setMatches] = useState<any[]>([]);
  const [row, setRow] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setRow(agenteSearch.row); }, [agenteSearch.row]);
  useEffect(() => { setLoading(agenteSearch.loading); }, [agenteSearch.loading]);

  // Cargar foto cuando hay agente
  useEffect(() => {
    const dni = agenteSearch.cleanDni;
    if (!dni) { documentos.revokeLastObjectUrl?.(); return; }
    documentos.fetchFotoPrivada?.(dni).catch(() => {});
  }, [agenteSearch.cleanDni]);

  // Auto-search por DNI al tipear
  useEffect(() => {
    const d = String(debouncedDni || '');
    if (d && d.replace(/\D/g, '').length >= 7) {
      agenteSearch.onSearch();
    }
  }, [debouncedDni]);

  const onSearch = () => agenteSearch.onSearch();

  const onSearchByName = async () => {
    const q = agenteSearch.fullName.trim();
    if (!q) { toast.error('Ingresá apellido y/o nombre'); return; }
    try {
      setLoading(true);
      setMatches([]);
      setRow(null);
      Object.keys(modules).forEach(k => closeModule(k as ModuleKey));
      documentos.revokeLastObjectUrl?.();
      const res = await apiFetch<any>(`/personal/search?q=${encodeURIComponent(q)}&limit=30&page=1`);
      const lista = res?.data || [];
      setMatches(lista);
      if (!lista.length) toast.error('Sin resultados', `No hay agentes que coincidan con "${q}"`);
      else toast.ok(`${lista.length} resultado(s)`, 'Clic para cargar agente');
    } catch (e: any) {
      toast.error('Error al buscar', e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  };

  // Al seleccionar desde lista de coincidencias
  const loadByDni = useCallback((dni: string) => {
    const clean = String(dni).replace(/\D/g, '');
    agenteSearch.setDni(clean);
    setMatches([]);
    // Cerrar módulos del agente anterior y recargar
    Object.keys(modules).forEach(k => closeModule(k as ModuleKey));
    setTimeout(() => agenteSearch.onSearch(), 20);
  }, [agenteSearch, modules, closeModule]);

  // Reload agente + módulos abiertos (después de editar)
  const onAgenteEdited = useCallback(() => {
    agenteSearch.onSearch();
    // Recargar todos los módulos que estén abiertos
    const openModules = (Object.keys(modules) as ModuleKey[]).filter(k => modules[k].open);
    openModules.forEach(k => loadModule(k, { forceReload: true }));
  }, [agenteSearch, modules, loadModule]);

  const getModuleTitle = (k: ModuleKey) =>
    k === 'pedidos' ? 'Pedidos' : k === 'documentos' ? 'Documentos' : 'Consultas';

  const getModuleCols = (key: ModuleKey, rows: any[]) => {
    if (!rows.length) return [];
    const cols = Object.keys(rows[0]);
    const preferred: Record<ModuleKey, string[]> = {
      consultas: ['id','dni','motivo_consulta','explicacion','created_at'],
      pedidos: ['id','dni','pedido','estado','lugar','fecha','observacion','created_at'],
      documentos: ['id','nombre','tipo','numero','fecha','descripcion_archivo','nombre_archivo_original'],
    };
    const pref = preferred[key] || [];
    const out: string[] = [];
    for (const p of pref) if (cols.includes(p)) out.push(p);
    for (const c of cols) if (!out.includes(c) && !['ruta','deleted_at'].includes(c)) out.push(c);
    return out;
  };

  const renderExportActions = (key: ModuleKey) => {
    const st = modules[key];
    const title = `${getModuleTitle(key)} (DNI ${agenteSearch.cleanDni})`;
    const file = `${key}_dni_${agenteSearch.cleanDni}`;
    return (
      <div className="row gp-export-actions">
        <button className="btn" onClick={() => printTable(title, st.rows)} disabled={!st.rows.length}>🖨 Imprimir</button>
        {key === 'pedidos' && (
          <button className="btn" onClick={() => documentos.openCertificadoIoma?.()} disabled={!agenteSearch.cleanDni}>
            Cert. IOMA
          </button>
        )}
        <button className="btn" onClick={() => exportToExcel(`${file}.xlsx`, st.rows)} disabled={!st.rows.length}>Excel</button>
        <button className="btn" onClick={() => exportToPdf(`${file}.pdf`, st.rows)} disabled={!st.rows.length}>PDF</button>
        <button className="btn" onClick={() => exportToWord(`${file}.docx`, st.rows)} disabled={!st.rows.length}>Word</button>
      </div>
    );
  };

  return (
    <Layout title="Gestión" showBack>
      <div className="gestion-layout">

        {/* ── GRID SUPERIOR: izquierda + derecha (foto) ── */}
        <div className="gp-topgrid">

          {/* IZQUIERDA */}
          <div className="gp-col gp-left">
            <AgenteSearchForm
              dni={agenteSearch.dni}
              fullName={agenteSearch.fullName}
              loading={loading}
              onDniChange={e => agenteSearch.setDni(String(e.target.value))}
              onFullNameChange={e => agenteSearch.setFullName(e.target.value)}
              onSearch={onSearch}
              onSearchByName={onSearchByName}
            />

            {loading && <div className="card gp-card-14">🔄 Cargando…</div>}

            {matches.length > 0 && (
              <MatchesList matches={matches} onSelect={loadByDni} />
            )}

            <AgenteInfoCard row={row} />

            {row?.dni && (
              <ModuleGrid
                modules={modules}
                cleanDni={agenteSearch.cleanDni}
                onToggleModule={loadModule}
                onOpenPedidoModal={pedidos.openPedidoModal}
                onCloseModule={closeModule}
              />
            )}
          </div>

          {/* DERECHA: foto + edición — sticky */}
          <div className="gp-col gp-right-panel">
            <FotoCredencialCard
              hasAgente={!!row?.dni}
              fotoUrl={documentos.fotoUrl}
            />
            {canEdit && row?.dni && (
              <AgenteEditPanel row={row} onSaved={onAgenteEdited} />
            )}
          </div>
        </div>

        {/* ── MÓDULOS ABIERTOS ── */}
        <div className="gp-bottomstack">
          {(['consultas', 'pedidos', 'documentos'] as ModuleKey[])
            .filter(k => modules[k].open)
            .map(k => {
              const st = modules[k];
              const moduleCols = getModuleCols(k, st.rows);
              const pageSize = st.tablePageSize || 50;
              const totalPages = Math.max(1, Math.ceil(st.rows.length / pageSize));
              const curPage = Math.min(Math.max(st.tablePage || 1, 1), totalPages);
              const start = (curPage - 1) * pageSize;
              const pageRows = st.rows.slice(start, start + pageSize);

              return (
                <ModuleDetailView
                  key={k}
                  moduleKey={k}
                  moduleState={st}
                  moduleTitle={getModuleTitle(k)}
                  moduleCols={moduleCols}
                  selectedRow={getSelectedRow(k)}
                  selectedRowIdx={st.selectedIndex}
                  pageRows={pageRows}
                  start={start}
                  curPage={curPage}
                  totalPages={totalPages}
                  pageSize={pageSize}
                  cleanDni={agenteSearch.cleanDni}
                  onClose={() => closeModule(k)}
                  onSetSelectedIndex={idx => setSelectedIndex(k, idx)}
                  onSetTablePage={page => setTablePage(k, page)}
                  onSetTablePageSize={size => setTablePageSize(k, size)}
                  onCellClick={(col, value, rowIndex) => cellModal.openCellModal(k, col, value, rowIndex)}
                  onOpenDoc={(route, row) => documentos.openDocViewer(route, row)}
                  onExport={() => renderExportActions(k)}
                  onRowSelect={idx => setSelectedIndex(k, idx)}
                  onPedidoAction={k === 'pedidos' ? {
                    onOpenPedidoModal: pedidos.openPedidoModal,
                    onIoma: pedidos.generarIomaSelected,
                    onCertificadoIoma: () => documentos.openCertificadoIoma?.(),
                    onMarcarPendiente: () => pedidos.marcarPedidoEstado('pendiente'),
                    onMarcarHecho: () => pedidos.marcarPedidoEstado('hecho'),
                    onBaja: pedidos.bajaPedidoSelected,
                    hasRows: !!st.rows.length
                  } : undefined}
                />
              );
            })}
        </div>
      </div>

      <PedidoModal
        open={pedidos.pedidoModal.open}
        data={pedidos.pedidoModal}
        cleanDni={agenteSearch.cleanDni}
        onChange={pedidos.setPedidoModal}
        onClose={pedidos.closePedidoModal}
        onSubmit={pedidos.createPedidosFromModal}
        getActor={() => {
          const s = loadSession();
          const u: any = s?.user || {};
          return u?.email || u?.id || 'anon';
        }}
      />
      <CellModal open={!!cellModal.cellModal} data={cellModal.cellModal}
        onClose={cellModal.closeCellModal} onCopy={cellModal.copyToClipboard} />
      <DocViewerModal open={documentos.docViewer.open} data={documentos.docViewer}
        onClose={documentos.closeDocViewer} previewComponent={GestionDocumentPreview} />
    </Layout>
  );
}

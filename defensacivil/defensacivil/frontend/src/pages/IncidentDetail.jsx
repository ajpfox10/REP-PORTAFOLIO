import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { incidentsApi } from '../api/incidents.api';
import useAuthStore from '../store/authStore';
import { StatusBadge, PriorityBadge } from '../components/common/Badge';
import Button from '../components/common/Button';
import Modal from '../components/common/Modal';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const STATUSES = ['RECIBIDO','EN_CAMINO','EN_ESCENA','CONTROLADO','CERRADO','CANCELADO'];
const UNIT_TYPES = ['BOMBEROS','POLICIA','AMBULANCIA','DEFENSA_CIVIL','RESCATE','GENDARMERIA','PREFECTURA','EJERCITO','CRUZ_ROJA','OTRO'];
const RES_TYPES  = ['VEHICULO','EQUIPO','MATERIAL','HERRAMIENTA','OTRO'];

const row  = { display:'flex', gap:'1rem', alignItems:'baseline', padding:'0.5rem 0', borderBottom:'1px solid #f1f5f9' };
const lbl  = { fontSize:'0.8125rem', color:'#64748b', minWidth:160 };
const val  = { fontSize:'0.875rem', color:'#1e293b', fontWeight:500 };

export default function IncidentDetail() {
  const { uuid }      = useParams();
  const navigate      = useNavigate();
  const canWrite      = useAuthStore(s => s.canWrite());
  const isAdmin       = useAuthStore(s => s.isAdmin());

  const [incident, setIncident]       = useState(null);
  const [history,  setHistory]        = useState([]);
  const [tab,      setTab]            = useState('info');
  const [statusModal, setStatusModal] = useState(false);
  const [newStatus,   setNewStatus]   = useState('');
  const [statusNotes, setStatusNotes] = useState('');
  const [delModal,    setDelModal]    = useState(false);
  const [loading,     setLoading]     = useState(false);

  // Inline unit/resource forms
  const [unitForm, setUnitForm]       = useState({ unit_name:'', unit_type:'BOMBEROS', unit_number:'', personnel_count:0, notes:'' });
  const [resForm,  setResForm]        = useState({ resource_type:'VEHICULO', resource_name:'', quantity:1, notes:'' });

  const load = () => {
    incidentsApi.getOne(uuid).then(r => setIncident(r.data));
    incidentsApi.getHistory(uuid).then(r => setHistory(r.data));
  };

  useEffect(() => { load(); }, [uuid]);

  const changeStatus = async () => {
    if (!newStatus) return;
    setLoading(true);
    try { await incidentsApi.updateStatus(uuid, { status: newStatus, notes: statusNotes }); setStatusModal(false); load(); }
    finally { setLoading(false); }
  };

  const handleDelete = async () => {
    await incidentsApi.delete(uuid);
    navigate('/incidents');
  };

  const addUnit = async () => {
    await incidentsApi.addUnit(uuid, unitForm);
    setUnitForm({ unit_name:'', unit_type:'BOMBEROS', unit_number:'', personnel_count:0, notes:'' });
    load();
  };

  const addResource = async () => {
    await incidentsApi.addResource(uuid, resForm);
    setResForm({ resource_type:'VEHICULO', resource_name:'', quantity:1, notes:'' });
    load();
  };

  if (!incident) return <p style={{ color:'#64748b' }}>Cargando...</p>;

  const inp = { padding:'0.375rem 0.625rem', border:'1px solid #d1d5db', borderRadius:'var(--radius)', fontSize:'0.8125rem', background:'#fff' };
  const sel = { ...inp, cursor:'pointer' };

  return (
    <div style={{ maxWidth:900, margin:'0 auto' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:'1.5rem', flexWrap:'wrap', gap:'1rem' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'1rem' }}>
          <button onClick={() => navigate(-1)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'1.25rem', color:'#64748b' }}>←</button>
          <div>
            <div style={{ fontSize:'0.8rem', color:'#64748b', marginBottom:'0.25rem' }}>{incident.incident_number}</div>
            <h1 style={{ fontSize:'1.375rem', fontWeight:700 }}>{incident.title}</h1>
            <div style={{ display:'flex', gap:'0.5rem', marginTop:'0.5rem', flexWrap:'wrap' }}>
              <StatusBadge status={incident.status} />
              <PriorityBadge priority={incident.priority} />
              <span style={{ fontSize:'0.8125rem', color:'#64748b' }}>{incident.type_name}</span>
            </div>
          </div>
        </div>
        <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap' }}>
          {canWrite && <Button size="sm" variant="secondary" onClick={() => { setNewStatus(incident.status); setStatusModal(true); }}>Cambiar Estado</Button>}
          {canWrite && <Button size="sm" onClick={() => navigate(`/incidents/${uuid}/edit`)}>Editar</Button>}
          {isAdmin  && <Button size="sm" variant="danger" onClick={() => setDelModal(true)}>Eliminar</Button>}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:'0.5rem', marginBottom:'1rem', borderBottom:'2px solid var(--color-border)' }}>
        {['info','unidades','recursos','historial'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding:'0.5rem 1rem', background:'none', border:'none', cursor:'pointer',
            borderBottom:`2px solid ${tab===t ? '#1d4ed8' : 'transparent'}`,
            color: tab===t ? '#1d4ed8' : '#64748b', fontWeight: tab===t ? 600 : 400,
            textTransform:'capitalize', fontSize:'0.875rem', marginBottom:-2,
          }}>
            {t === 'historial' ? 'Historial' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div style={{ background:'#fff', borderRadius:'var(--radius)', boxShadow:'var(--shadow)', padding:'1.5rem' }}>

        {/* INFO TAB */}
        {tab === 'info' && (
          <div>
            <div style={row}><span style={lbl}>Tipo</span><span style={val}>{incident.type_name}</span></div>
            {incident.subtype_name && <div style={row}><span style={lbl}>Subtipo</span><span style={val}>{incident.subtype_name}</span></div>}
            <div style={row}><span style={lbl}>Descripción</span><span style={{ ...val, whiteSpace:'pre-wrap' }}>{incident.description}</span></div>
            <div style={row}><span style={lbl}>Provincia</span><span style={val}>{incident.province_name || '-'}</span></div>
            <div style={row}><span style={lbl}>Partido</span><span style={val}>{incident.partido_name || '-'}</span></div>
            <div style={row}><span style={lbl}>Localidad</span><span style={val}>{incident.locality_name || '-'}</span></div>
            <div style={row}><span style={lbl}>Dirección</span><span style={val}>{incident.address || '-'}</span></div>
            {incident.latitude && <div style={row}><span style={lbl}>Coordenadas</span><span style={val}>{Number(incident.latitude).toFixed(6)}, {Number(incident.longitude).toFixed(6)}</span></div>}
            <div style={row}><span style={lbl}>Personas afectadas</span><span style={val}>{incident.affected_persons_count}</span></div>
            <div style={row}><span style={lbl}>Heridos</span><span style={val}>{incident.injured_count}</span></div>
            <div style={row}><span style={lbl}>Fallecidos</span><span style={val}>{incident.deceased_count}</span></div>
            <div style={row}><span style={lbl}>Evacuados</span><span style={val}>{incident.evacuated_count}</span></div>
            <div style={row}><span style={lbl}>Oficial asignado</span><span style={val}>{incident.assigned_officer || '-'}</span></div>
            <div style={row}><span style={lbl}>Reportado por</span><span style={val}>{incident.reporter_full_name}</span></div>
            <div style={row}><span style={lbl}>Inicio</span><span style={val}>{format(new Date(incident.started_at), 'dd/MM/yyyy HH:mm', { locale:es })}</span></div>
            {incident.controlled_at && <div style={row}><span style={lbl}>Controlado</span><span style={val}>{format(new Date(incident.controlled_at), 'dd/MM/yyyy HH:mm', { locale:es })}</span></div>}
            {incident.closed_at    && <div style={row}><span style={lbl}>Cerrado</span><span style={val}>{format(new Date(incident.closed_at), 'dd/MM/yyyy HH:mm', { locale:es })}</span></div>}
            {incident.notes && <div style={row}><span style={lbl}>Notas</span><span style={{ ...val, whiteSpace:'pre-wrap' }}>{incident.notes}</span></div>}

            {incident.latitude && incident.longitude && (
              <div style={{ marginTop:'1rem', borderRadius:'var(--radius)', overflow:'hidden', height:250 }}>
                <MapContainer center={[Number(incident.latitude), Number(incident.longitude)]} zoom={15} style={{ height:'100%', width:'100%' }} scrollWheelZoom={false}>
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap' />
                  <Marker position={[Number(incident.latitude), Number(incident.longitude)]}>
                    <Popup>{incident.incident_number} - {incident.title}</Popup>
                  </Marker>
                </MapContainer>
              </div>
            )}
          </div>
        )}

        {/* UNITS TAB */}
        {tab === 'unidades' && (
          <div>
            {incident.units?.length === 0 && <p style={{ color:'#64748b', marginBottom:'1rem' }}>Sin unidades asignadas</p>}
            {incident.units?.map(u => (
              <div key={u.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.75rem 0', borderBottom:'1px solid #f1f5f9' }}>
                <div>
                  <span style={{ fontWeight:600 }}>{u.unit_name}</span>
                  <span style={{ color:'#64748b', marginLeft:'0.75rem', fontSize:'0.8125rem' }}>{u.unit_type} {u.unit_number ? `— ${u.unit_number}` : ''} {u.personnel_count ? `— ${u.personnel_count} pers.` : ''}</span>
                </div>
                {canWrite && <Button size="sm" variant="danger" onClick={async () => { await incidentsApi.removeUnit(uuid, u.id); load(); }}>✕</Button>}
              </div>
            ))}
            {canWrite && (
              <div style={{ marginTop:'1rem', display:'flex', flexWrap:'wrap', gap:'0.5rem', alignItems:'center' }}>
                <input style={inp} placeholder="Nombre unidad" value={unitForm.unit_name} onChange={e => setUnitForm(f => ({...f, unit_name: e.target.value}))} />
                <select style={sel} value={unitForm.unit_type} onChange={e => setUnitForm(f => ({...f, unit_type: e.target.value}))}>
                  {UNIT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input style={{...inp, width:90}} placeholder="Móvil N°" value={unitForm.unit_number} onChange={e => setUnitForm(f => ({...f, unit_number: e.target.value}))} />
                <input type="number" min="0" style={{...inp, width:80}} placeholder="Pers." value={unitForm.personnel_count} onChange={e => setUnitForm(f => ({...f, personnel_count: parseInt(e.target.value)||0}))} />
                <Button size="sm" onClick={addUnit} disabled={!unitForm.unit_name}>+ Agregar</Button>
              </div>
            )}
          </div>
        )}

        {/* RESOURCES TAB */}
        {tab === 'recursos' && (
          <div>
            {incident.resources?.length === 0 && <p style={{ color:'#64748b', marginBottom:'1rem' }}>Sin recursos asignados</p>}
            {incident.resources?.map(r => (
              <div key={r.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.75rem 0', borderBottom:'1px solid #f1f5f9' }}>
                <div>
                  <span style={{ fontWeight:600 }}>{r.resource_name}</span>
                  <span style={{ color:'#64748b', marginLeft:'0.75rem', fontSize:'0.8125rem' }}>{r.resource_type} — Cant: {r.quantity}</span>
                </div>
                {canWrite && <Button size="sm" variant="danger" onClick={async () => { await incidentsApi.removeResource(uuid, r.id); load(); }}>✕</Button>}
              </div>
            ))}
            {canWrite && (
              <div style={{ marginTop:'1rem', display:'flex', flexWrap:'wrap', gap:'0.5rem', alignItems:'center' }}>
                <select style={sel} value={resForm.resource_type} onChange={e => setResForm(f => ({...f, resource_type: e.target.value}))}>
                  {RES_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input style={inp} placeholder="Nombre recurso" value={resForm.resource_name} onChange={e => setResForm(f => ({...f, resource_name: e.target.value}))} />
                <input type="number" min="1" style={{...inp, width:80}} placeholder="Cant." value={resForm.quantity} onChange={e => setResForm(f => ({...f, quantity: parseInt(e.target.value)||1}))} />
                <Button size="sm" onClick={addResource} disabled={!resForm.resource_name}>+ Agregar</Button>
              </div>
            )}
          </div>
        )}

        {/* HISTORY TAB */}
        {tab === 'historial' && (
          <div>
            {history.map((h, i) => (
              <div key={h.id} style={{ display:'flex', gap:'1rem', marginBottom:'1rem' }}>
                <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
                  <div style={{ width:12, height:12, borderRadius:'50%', background:'#1d4ed8', flexShrink:0 }} />
                  {i < history.length-1 && <div style={{ width:2, flex:1, background:'#e2e8f0', margin:'4px 0' }} />}
                </div>
                <div style={{ flex:1, paddingBottom:'0.75rem' }}>
                  <div style={{ display:'flex', gap:'0.5rem', alignItems:'center', flexWrap:'wrap' }}>
                    <StatusBadge status={h.new_status} />
                    {h.previous_status && <span style={{ color:'#94a3b8', fontSize:'0.8rem' }}>← {h.previous_status.replace('_',' ')}</span>}
                    <span style={{ color:'#94a3b8', fontSize:'0.8rem' }}>{h.full_name}</span>
                  </div>
                  {h.notes && <p style={{ fontSize:'0.8125rem', color:'#64748b', marginTop:'0.25rem' }}>{h.notes}</p>}
                  <p style={{ fontSize:'0.75rem', color:'#94a3b8', marginTop:'0.25rem' }}>
                    {format(new Date(h.changed_at), 'dd/MM/yyyy HH:mm', { locale:es })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Status Change Modal */}
      <Modal isOpen={statusModal} onClose={() => setStatusModal(false)} title="Cambiar Estado" width={420}>
        <div style={{ marginBottom:'1rem' }}>
          <label style={{ display:'block', fontWeight:500, marginBottom:'0.5rem' }}>Nuevo Estado</label>
          <select style={{ ...inp, width:'100%' }} value={newStatus} onChange={e => setNewStatus(e.target.value)}>
            {STATUSES.map(s => <option key={s} value={s}>{s.replace('_',' ')}</option>)}
          </select>
        </div>
        <div style={{ marginBottom:'1.5rem' }}>
          <label style={{ display:'block', fontWeight:500, marginBottom:'0.5rem' }}>Notas (opcional)</label>
          <textarea rows={3} style={{ ...inp, width:'100%', resize:'vertical' }} value={statusNotes} onChange={e => setStatusNotes(e.target.value)} />
        </div>
        <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end' }}>
          <Button variant="secondary" onClick={() => setStatusModal(false)}>Cancelar</Button>
          <Button onClick={changeStatus} isLoading={loading}>Guardar</Button>
        </div>
      </Modal>

      <ConfirmDialog isOpen={delModal} onClose={() => setDelModal(false)} onConfirm={handleDelete}
        title="Eliminar Incidente" message="¿Confirma la eliminación de este incidente?" />
    </div>
  );
}

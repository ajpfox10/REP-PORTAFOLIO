const STATUS_COLORS = {
  RECIBIDO:   { bg:'#dbeafe', text:'#1d4ed8', label:'Recibido' },
  EN_CAMINO:  { bg:'#fef3c7', text:'#d97706', label:'En Camino' },
  EN_ESCENA:  { bg:'#fee2e2', text:'#dc2626', label:'En Escena' },
  CONTROLADO: { bg:'#fef9c3', text:'#ca8a04', label:'Controlado' },
  CERRADO:    { bg:'#dcfce7', text:'#16a34a', label:'Cerrado' },
  CANCELADO:  { bg:'#f1f5f9', text:'#64748b', label:'Cancelado' },
};

const PRIORITY_COLORS = {
  BAJA:    { bg:'#dcfce7', text:'#16a34a', label:'Baja' },
  MEDIA:   { bg:'#dbeafe', text:'#1d4ed8', label:'Media' },
  ALTA:    { bg:'#fef3c7', text:'#d97706', label:'Alta' },
  CRITICA: { bg:'#fee2e2', text:'#dc2626', label:'Crítica' },
};

const ROLE_COLORS = {
  admin:       { bg:'#ede9fe', text:'#7c3aed', label:'Admin' },
  medium:      { bg:'#dbeafe', text:'#1d4ed8', label:'Operador' },
  read:        { bg:'#f1f5f9', text:'#64748b', label:'Lector' },
  telefonista: { bg:'#fef3c7', text:'#d97706', label:'Telefonista' },
  chofer:      { bg:'#dcfce7', text:'#16a34a', label:'Chofer' },
};

export function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || { bg:'#f1f5f9', text:'#64748b', label: status };
  return <Badge bg={c.bg} text={c.text}>{c.label}</Badge>;
}

export function PriorityBadge({ priority }) {
  const c = PRIORITY_COLORS[priority] || { bg:'#f1f5f9', text:'#64748b', label: priority };
  return <Badge bg={c.bg} text={c.text}>{c.label}</Badge>;
}

export function RoleBadge({ role }) {
  const c = ROLE_COLORS[role] || { bg:'#f1f5f9', text:'#64748b', label: role };
  return <Badge bg={c.bg} text={c.text}>{c.label}</Badge>;
}

export default function Badge({ children, bg = '#e2e8f0', text = '#475569' }) {
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', padding:'0.125rem 0.625rem',
      borderRadius:'9999px', fontSize:'0.75rem', fontWeight:600,
      background: bg, color: text, whiteSpace:'nowrap',
    }}>
      {children}
    </span>
  );
}

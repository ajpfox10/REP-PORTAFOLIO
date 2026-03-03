// src/pages/SolicitudAltaPage/index.tsx
import React, { useState } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

const EMPTY = {
  dni: '', apellido: '', nombre: '', cuil: '',
  fecha_nacimiento: '', email: '', telefono: '',
  estado_empleo: 'activo', observaciones: '',
};

export function SolicitudAltaPage() {
  const toast = useToast();
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (k: string, v: string) => {
    setForm(f => ({ ...f, [k]: v }));
    setErrors(e => { const n = { ...e }; delete n[k]; return n; });
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.dni.replace(/\D/g, '').match(/^\d{6,8}$/)) e.dni = 'DNI: 6-8 dígitos';
    if (!form.apellido.trim()) e.apellido = 'Requerido';
    if (!form.nombre.trim()) e.nombre = 'Requerido';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      await apiFetch<any>('/solicitudes_alta', {
        method: 'POST',
        body: JSON.stringify({
          dni: Number(form.dni.replace(/\D/g, '')),
          apellido: form.apellido.trim().toUpperCase(),
          nombre: form.nombre.trim().toUpperCase(),
          cuil: form.cuil || null,
          fecha_nacimiento: form.fecha_nacimiento || null,
          email: form.email || null,
          telefono: form.telefono || null,
          estado_empleo: form.estado_empleo,
          observaciones: form.observaciones || null,
          estado_solicitud: 'pendiente',
        }),
      });
      setDone(true);
      toast.ok('Solicitud enviada', 'Un administrador revisará el pedido de alta.');
    } catch (e: any) {
      toast.error('Error al enviar solicitud', e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <Layout title="Solicitud de alta" showBack>
        <div className="container" style={{ maxWidth: 600, margin: '2rem auto', textAlign: 'center' }}>
          <div className="card" style={{ padding: '2.5rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: 16 }}>✅</div>
            <h2 style={{ marginBottom: 12 }}>Solicitud enviada</h2>
            <p style={{ color: '#64748b', marginBottom: 24 }}>
              La solicitud de alta para <strong>{form.apellido}, {form.nombre}</strong> (DNI {form.dni}) fue enviada correctamente.
              Un administrador la revisará y procesará el alta definitiva.
            </p>
            <button className="btn btn-primary" onClick={() => { setForm({ ...EMPTY }); setDone(false); }}>
              ➕ Nueva solicitud
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  const field = (key: string, label: string, opts?: { type?: string; placeholder?: string; required?: boolean }) => (
    <div>
      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b',
        textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
        {label}{opts?.required && <span style={{ color: '#ef4444' }}> *</span>}
      </div>
      <input
        className={`input${errors[key] ? ' error' : ''}`}
        type={opts?.type || 'text'}
        placeholder={opts?.placeholder || ''}
        value={(form as any)[key]}
        onChange={e => set(key, e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
      {errors[key] && <div style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: 3 }}>⚠ {errors[key]}</div>}
    </div>
  );

  return (
    <Layout title="Solicitar alta de agente" showBack>
      <div style={{ maxWidth: 700, margin: '0 auto' }}>
        <div className="card" style={{ padding: '1.8rem' }}>
          <h2 style={{ marginBottom: 6, fontSize: '1.2rem' }}>📝 Solicitud de alta</h2>
          <p style={{ color: '#64748b', fontSize: '0.88rem', marginBottom: 24 }}>
            Completá los datos básicos. Un administrador revisará y completará el alta definitiva.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 20px', marginBottom: 20 }}>
            {field('dni', 'DNI', { placeholder: 'Ej: 12345678', required: true })}
            {field('cuil', 'CUIL', { placeholder: 'Ej: 20-12345678-9' })}
            <div style={{ gridColumn: '1 / -1' }}>
              {field('apellido', 'Apellido', { placeholder: 'En mayúsculas', required: true })}
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              {field('nombre', 'Nombre', { placeholder: 'En mayúsculas', required: true })}
            </div>
            {field('fecha_nacimiento', 'Fecha de nacimiento', { type: 'date' })}
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b',
                textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                Estado laboral
              </div>
              <select className="input" value={form.estado_empleo}
                onChange={e => set('estado_empleo', e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box' }}>
                {['activo','inactivo','licencia','jubilado','becario','contratado','pasante','baja']
                  .map(o => <option key={o} value={o}>{o.charAt(0).toUpperCase()+o.slice(1)}</option>)}
              </select>
            </div>
            {field('email', 'Email institucional', { type: 'email', placeholder: 'usuario@organismo.gov.ar' })}
            {field('telefono', 'Teléfono', { placeholder: 'Con código de área' })}
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b',
                textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                Observaciones / Motivo de la solicitud
              </div>
              <textarea className="textarea" rows={3}
                placeholder="Información adicional para el administrador…"
                value={form.observaciones}
                onChange={e => set('observaciones', e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box' }} />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button className="btn" type="button"
              onClick={() => { setForm({ ...EMPTY }); setErrors({}); }}>
              Limpiar
            </button>
            <button className="btn btn-primary" type="button" disabled={saving} onClick={submit}>
              {saving ? '⏳ Enviando…' : '📤 Enviar solicitud'}
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
}

import { useState } from 'react';
import { toast } from 'sonner';
import Modal from '../common/Modal';
import Button from '../common/Button';
import { Field, Alert } from '../common/ui';
import { authApi } from '../../api/auth.api';
import { setAccessToken } from '../../api/axios';
import { apiError } from '../../lib/format';

const EMPTY = { currentPassword: '', newPassword: '', confirm: '' };

export default function ChangePasswordModal({ isOpen, onClose }) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const close = () => { setForm(EMPTY); setError(null); onClose(); };
  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }));

  const submit = async e => {
    e.preventDefault();
    if (form.newPassword !== form.confirm) { setError('Las contraseñas nuevas no coinciden'); return; }
    setSaving(true);
    setError(null);
    try {
      const { data } = await authApi.changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword });
      setAccessToken(data.accessToken);
      toast.success('Contraseña actualizada. Se cerraron las sesiones en otros dispositivos.');
      close();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="Cambiar contraseña"
      width={440}
      footer={
        <>
          <Button variant="secondary" onClick={close}>Cancelar</Button>
          <Button type="submit" form="pw-form" isLoading={saving}>Guardar</Button>
        </>
      }
    >
      <form id="pw-form" onSubmit={submit} className="stack" style={{ gap: 14 }}>
        {error && <Alert type="error">{error}</Alert>}
        <Field label="Contraseña actual" htmlFor="pw-current" required>
          <input id="pw-current" type="password" className="input" autoComplete="current-password" value={form.currentPassword} onChange={set('currentPassword')} required />
        </Field>
        <Field label="Contraseña nueva" htmlFor="pw-new" required hint="Mínimo 8 caracteres, con mayúsculas, minúsculas y números.">
          <input id="pw-new" type="password" className="input" autoComplete="new-password" value={form.newPassword} onChange={set('newPassword')} required minLength={8} />
        </Field>
        <Field label="Repetir contraseña nueva" htmlFor="pw-confirm" required>
          <input id="pw-confirm" type="password" className="input" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required />
        </Field>
      </form>
    </Modal>
  );
}

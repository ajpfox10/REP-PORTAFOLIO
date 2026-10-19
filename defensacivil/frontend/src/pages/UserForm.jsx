import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { usersApi } from '../api/users.api';
import Button from '../components/common/Button';
import { PageHeader, Card, Field, Alert, Loading } from '../components/common/ui';
import { ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS } from '../lib/constants';
import { apiError, fieldErrors } from '../lib/format';

const PASSWORD_RULES = {
  minLength: { value: 8, message: 'Mínimo 8 caracteres' },
  pattern: { value: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, message: 'Debe tener mayúsculas, minúsculas y números' },
};

function RolePicker({ register }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      {ROLES.map(r => (
        <label key={r} className="row" style={{ gap: 10, padding: '10px 12px', border: '1px solid var(--border-2)', borderRadius: 10, cursor: 'pointer', flexWrap: 'nowrap' }}>
          <input type="radio" value={r} {...register('role')} />
          <span><strong>{ROLE_LABELS[r]}</strong><span className="muted" style={{ display: 'block', fontSize: 12.5 }}>{ROLE_DESCRIPTIONS[r]}</span></span>
        </label>
      ))}
    </div>
  );
}

export default function UserForm() {
  const { uuid } = useParams();
  const isEdit = !!uuid;
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);
  const [newPw, setNewPw] = useState('');
  const [pwState, setPwState] = useState({ saving: false, error: null });
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm({ defaultValues: { role: 'read' } });

  useEffect(() => {
    if (!isEdit) return;
    usersApi.getOne(uuid).then(r => {
      setUser(r.data);
      reset({ full_name: r.data.full_name, email: r.data.email, role: r.data.role });
    }).catch(setError);
  }, [uuid, isEdit, reset]);

  const onSubmit = async data => {
    setError(null);
    try {
      if (isEdit) await usersApi.update(uuid, { full_name: data.full_name, email: data.email, role: data.role });
      else await usersApi.create(data);
      toast.success(isEdit ? 'Usuario actualizado' : 'Usuario creado');
      navigate('/usuarios');
    } catch (err) {
      setError(err);
    }
  };

  const resetPassword = async () => {
    setPwState({ saving: true, error: null });
    try {
      await usersApi.resetPassword(uuid, { newPassword: newPw });
      toast.success('Contraseña restablecida. Se cerraron sus sesiones abiertas.');
      setNewPw('');
      setPwState({ saving: false, error: null });
    } catch (err) {
      setPwState({ saving: false, error: apiError(err) });
    }
  };

  if (isEdit && !user) return <div className="page">{error ? <Alert type="error">{apiError(error)}</Alert> : <Loading />}</div>;

  const server = fieldErrors(error);
  const err = name => errors[name]?.message || server[name];

  return (
    <div className="page page-narrow">
      <PageHeader title={isEdit ? `Editar a ${user.full_name}` : 'Nuevo usuario'} subtitle={isEdit ? `Usuario: ${user.username}` : 'El usuario podrá ingresar con la contraseña que definas.'} back={{ to: '/usuarios', label: 'Usuarios' }} />
      {error && !Object.keys(server).length && <Alert type="error" style={{ marginBottom: 16 }}>{apiError(error)}</Alert>}

      <Card>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="form-grid">
          <Field label="Nombre completo" htmlFor="u-name" required error={err('full_name')} className="full">
            <input id="u-name" className="input" {...register('full_name', { required: 'Ingresá el nombre', minLength: { value: 2, message: 'Mínimo 2 caracteres' } })} />
          </Field>
          {!isEdit && (
            <Field label="Usuario" htmlFor="u-username" required error={err('username')} hint="Letras y números, sin espacios.">
              <input id="u-username" className="input" autoComplete="off" {...register('username', { required: 'Ingresá un usuario', pattern: { value: /^[a-zA-Z0-9]{3,50}$/, message: 'Entre 3 y 50 letras o números' } })} />
            </Field>
          )}
          <Field label="Email" htmlFor="u-email" required error={err('email')} className={isEdit ? 'full' : ''}>
            <input id="u-email" type="email" className="input" {...register('email', { required: 'Ingresá el email' })} />
          </Field>
          {!isEdit && (
            <Field label="Contraseña inicial" htmlFor="u-pass" required error={err('password')} className="full" hint="Mínimo 8 caracteres, con mayúsculas, minúsculas y números.">
              <input id="u-pass" type="password" className="input" autoComplete="new-password" {...register('password', { required: 'Ingresá una contraseña', ...PASSWORD_RULES })} />
            </Field>
          )}
          <Field label="Rol" className="full" error={err('role')}><RolePicker register={register} /></Field>
          <div className="full form-actions" style={{ marginTop: 0 }}>
            <Button variant="secondary" onClick={() => navigate('/usuarios')}>Cancelar</Button>
            <Button type="submit" isLoading={isSubmitting}>{isEdit ? 'Guardar cambios' : 'Crear usuario'}</Button>
          </div>
        </form>
      </Card>

      {isEdit && (
        <Card title="Restablecer contraseña" hint="Al cambiarla se cierran todas sus sesiones." className="" >
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <Field htmlFor="u-newpw" error={pwState.error} className="spacer">
              <input id="u-newpw" type="password" className="input" autoComplete="new-password" placeholder="Contraseña nueva" value={newPw} onChange={e => setNewPw(e.target.value)} aria-label="Contraseña nueva" />
            </Field>
            <Button variant="secondary" onClick={resetPassword} isLoading={pwState.saving} disabled={newPw.length < 8}>Restablecer</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

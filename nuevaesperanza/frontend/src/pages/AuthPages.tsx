import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { CircleAlert } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { ApiError } from '../lib/api'
import { useToast } from '../context/ToastContext'

function useRedirect() {
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  return from && from.startsWith('/') ? from : '/'
}

export function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const redirect = useRedirect()
  const notify = useToast()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={redirect} replace />

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const logged = await login(form.email, form.password)
      notify(`¡Hola, ${logged.name.split(' ')[0]}!`)
      navigate(logged.role === 'admin' && redirect === '/' ? '/admin' : redirect, { replace: true })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No pudimos iniciar sesión')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1>Ingresá a tu cuenta</h1>
        <p className="page-subtitle">Para comprar y seguir tus pedidos.</p>
        <form onSubmit={submit} noValidate>
          {error && <div className="alert alert--error" role="alert"><CircleAlert size={18} /> {error}</div>}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" className="input" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="password">Contraseña</label>
            <input id="password" className="input" type="password" autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
        </form>
        <p className="switch">¿No tenés cuenta? <Link to="/registrarse" state={{ from: redirect }}>Creala gratis</Link></p>
        <div className="demo-box">
          Para probar: cliente <code>lucia@cliente.test</code> / <code>Cliente.2026</code> (con <code>npm run seed:demo</code>).
        </div>
      </div>
    </div>
  )
}

export function RegisterPage() {
  const { user, register } = useAuth()
  const navigate = useNavigate()
  const redirect = useRedirect()
  const notify = useToast()
  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '', address: '' })
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={redirect} replace />

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value })

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setFields({})
    try {
      await register(form)
      notify('¡Bienvenido a Nueva Esperanza!')
      navigate(redirect, { replace: true })
    } catch (e) {
      if (e instanceof ApiError) { setError(e.message); setFields(e.fields) } else setError('No pudimos crear la cuenta')
    } finally {
      setBusy(false)
    }
  }

  const fieldProps = (key: keyof typeof form) => ({
    id: key,
    className: 'input',
    value: form[key],
    onChange: set(key),
    'aria-invalid': Boolean(fields[key]),
    'aria-describedby': fields[key] ? `${key}-error` : undefined,
  })
  const fieldError = (key: string) => fields[key] && <span id={`${key}-error`} className="field-error">{fields[key]}</span>

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1>Creá tu cuenta</h1>
        <p className="page-subtitle">Tarda menos de un minuto.</p>
        <form onSubmit={submit} noValidate>
          {error && <div className="alert alert--error" role="alert"><CircleAlert size={18} /> {error}</div>}
          <div className="field"><label htmlFor="name">Nombre y apellido</label><input {...fieldProps('name')} autoComplete="name" required />{fieldError('name')}</div>
          <div className="field"><label htmlFor="email">Email</label><input {...fieldProps('email')} type="email" autoComplete="email" required />{fieldError('email')}</div>
          <div className="field">
            <label htmlFor="password">Contraseña</label>
            <input {...fieldProps('password')} type="password" autoComplete="new-password" required />
            {fieldError('password') || <span className="field-hint">Mínimo 8 caracteres, con letras y números.</span>}
          </div>
          <div className="field"><label htmlFor="phone">Teléfono <span className="muted">(opcional)</span></label><input {...fieldProps('phone')} type="tel" autoComplete="tel" />{fieldError('phone')}</div>
          <div className="field"><label htmlFor="address">Dirección <span className="muted">(opcional)</span></label><input {...fieldProps('address')} autoComplete="street-address" />{fieldError('address')}</div>
          <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={busy}>{busy ? 'Creando cuenta…' : 'Crear cuenta'}</button>
        </form>
        <p className="switch">¿Ya tenés cuenta? <Link to="/ingresar" state={{ from: redirect }}>Ingresá</Link></p>
      </div>
    </div>
  )
}

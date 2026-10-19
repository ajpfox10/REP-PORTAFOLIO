import { Link } from 'react-router-dom';
import { ArrowLeft, Inbox, AlertCircle, CheckCircle2, Info, AlertTriangle } from 'lucide-react';

export function PageHeader({ title, subtitle, back, actions }) {
  return (
    <div className="page-header">
      <div style={{ minWidth: 0 }}>
        {back && (
          <Link to={back.to} className="back-link"><ArrowLeft size={14} /> {back.label}</Link>
        )}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, hint, actions, children, bodyClass = 'card-body', className = '', footer }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-header">
          <div>
            {title && <h2>{title}</h2>}
            {hint && <div className="hint">{hint}</div>}
          </div>
          {actions}
        </div>
      )}
      {bodyClass === null ? children : <div className={bodyClass}>{children}</div>}
      {footer && <div className="card-footer">{footer}</div>}
    </section>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, children }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon size={22} /></div>
      {title && <h3>{title}</h3>}
      {children && <p>{children}</p>}
    </div>
  );
}

export function Loading({ label = 'Cargando…' }) {
  return <div className="loading-center" role="status"><span className="spinner" /> {label}</div>;
}

const ALERT_ICONS = { error: AlertCircle, success: CheckCircle2, info: Info, warning: AlertTriangle };

export function Alert({ type = 'info', children, style }) {
  const Icon = ALERT_ICONS[type];
  return (
    <div className={`alert alert-${type}`} role={type === 'error' ? 'alert' : 'status'} style={style}>
      <Icon size={17} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

// Campo con etiqueta, ayuda y error debajo
export function Field({ label, htmlFor, required, error, hint, className = '', children }) {
  return (
    <div className={`field ${className}`}>
      {label && <label className="label" htmlFor={htmlFor}>{label}{required && <span className="req" aria-hidden="true">*</span>}</label>}
      {children}
      {error ? <span className="field-error" role="alert">{error}</span> : hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function Pagination({ page, pages, total, onPage, noun = 'resultados' }) {
  return (
    <div className="pagination">
      <span>{total} {noun}</span>
      {pages > 1 && (
        <div className="row">
          <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</button>
          <span className="tabular">Página {page} de {pages}</span>
          <button className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Siguiente</button>
        </div>
      )}
    </div>
  );
}

import { AlertTriangle } from 'lucide-react';
import { STATUS_LABELS, PRIORITY_LABELS, ROLE_LABELS } from '../../lib/constants';

export function StatusBadge({ status }) {
  return (
    <span className={`badge st-${status}`}>
      <span className="dot" aria-hidden="true" />
      {STATUS_LABELS[status] || status}
    </span>
  );
}

export function PriorityBadge({ priority }) {
  return (
    <span className={`badge pr-${priority}`}>
      {priority === 'CRITICA' && <AlertTriangle size={12} aria-hidden="true" />}
      {PRIORITY_LABELS[priority] || priority}
    </span>
  );
}

export function RoleBadge({ role }) {
  return <span className="badge badge-outline">{ROLE_LABELS[role] || role}</span>;
}

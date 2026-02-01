// src/pages/DashboardPage/components/StatTile.tsx
import React from 'react';
import { Link } from 'react-router-dom';

interface StatTileProps {
  to: string;
  title: string;
  desc: string;
  stat?: string;
  disabled?: boolean;
}

export function StatTile({ to, title, desc, stat, disabled }: StatTileProps) {
  const cls = `tile ${disabled ? 'disabled' : ''}`;
  const content = (
    <>
      <div className="row dash-stat-head">
        <h3 className="dash-stat-title">{title}</h3>
        {stat ? <span className="badge">{stat}</span> : null}
      </div>
      <p>{desc}</p>
    </>
  );
  
  if (disabled) {
    return <div className={cls} aria-disabled="true">{content}</div>;
  }
  
  return (
    <Link className={cls} to={to}>
      {content}
    </Link>
  );
}
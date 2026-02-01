// src/pages/DashboardPage/components/Tile.tsx
import React from 'react';
import { Link } from 'react-router-dom';

interface TileProps {
  to: string;
  title: string;
  desc: string;
  disabled?: boolean;
}

export function Tile({ to, title, desc, disabled }: TileProps) {
  const cls = `tile ${disabled ? 'disabled' : ''}`;
  
  if (disabled) {
    return (
      <div className={cls} aria-disabled="true">
        <h3>{title}</h3>
        <p>{desc}</p>
      </div>
    );
  }
  
  return (
    <Link className={cls} to={to}>
      <h3>{title}</h3>
      <p>{desc}</p>
    </Link>
  );
}
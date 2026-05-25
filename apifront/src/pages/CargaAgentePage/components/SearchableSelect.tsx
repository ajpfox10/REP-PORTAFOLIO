import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface Option { id: string | number; nombre: string; }

interface SearchableSelectProps {
  value: string;
  onChange: (val: string) => void;
  options: Option[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

export function SearchableSelect({
  value, onChange, options, placeholder = '— Seleccionar —', disabled = false, className = '', id,
}: SearchableSelectProps) {
  const [open, setOpen]       = useState(false);
  const [query, setQuery]     = useState('');
  const [dropRect, setDropRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef          = useRef<HTMLDivElement>(null);
  const dropdownRef           = useRef<HTMLDivElement>(null);
  const inputRef              = useRef<HTMLInputElement>(null);
  const listRef               = useRef<HTMLUListElement>(null);

  const sorted = [...options].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const filtered = query.trim()
    ? sorted.filter(o => o.nombre.toLowerCase().includes(query.toLowerCase()))
    : sorted;

  const selected = options.find(o => String(o.id) === String(value));

  const openDropdown = useCallback(() => {
    if (disabled) return;
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropRect({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    setOpen(true);
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [disabled]);

  const select = useCallback((id: string) => {
    onChange(id);
    setOpen(false);
    setQuery('');
  }, [onChange]);

  const clear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setOpen(false);
    setQuery('');
  }, [onChange]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        !containerRef.current?.contains(e.target as Node) &&
        !dropdownRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Reposition on scroll/resize while open
  useEffect(() => {
    if (!open) return;
    const update = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDropRect({ top: rect.bottom + 4, left: rect.left, width: rect.width });
      }
    };
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  // Keyboard nav
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); setQuery(''); }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const first = listRef.current?.querySelector('li') as HTMLElement | null;
      first?.focus();
    }
  }, []);

  const onItemKeyDown = useCallback((e: React.KeyboardEvent<HTMLLIElement>, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(id); }
    if (e.key === 'ArrowDown') { e.preventDefault(); (e.currentTarget.nextSibling as HTMLElement | null)?.focus(); }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = e.currentTarget.previousSibling as HTMLElement | null;
      if (prev) prev.focus(); else inputRef.current?.focus();
    }
    if (e.key === 'Escape') { setOpen(false); setQuery(''); }
  }, [select]);

  const dropdown = open && dropRect ? createPortal(
    <div ref={dropdownRef} className="ss-dropdown" style={{
      position: 'fixed', zIndex: 9999,
      top: dropRect.top, left: dropRect.left, width: dropRect.width,
      background: 'var(--ca-navy2, #1e293b)',
      border: '1px solid var(--ca-amber)',
      borderRadius: 8,
      boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
      overflow: 'hidden',
    }}>
      <div style={{ padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <input
          ref={inputRef}
          aria-label="Buscar opción"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Buscar…"
          style={{
            width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6, padding: '5px 8px', color: 'var(--ca-text)', fontSize: '0.85rem',
            outline: 'none', boxSizing: 'border-box', fontFamily: 'DM Sans, sans-serif',
          }}
        />
      </div>
      <ul ref={listRef} role="listbox" style={{ margin: 0, padding: '4px 0', listStyle: 'none', maxHeight: 240, overflowY: 'auto' }}>
        {filtered.length === 0 && (
          <li style={{ padding: '8px 12px', color: 'rgba(148,163,184,0.5)', fontSize: '0.85rem', fontStyle: 'italic' }}>Sin resultados</li>
        )}
        {filtered.map(o => (
          <li
            key={o.id}
            role="option"
            tabIndex={0}
            aria-selected={String(o.id) === String(value)}
            onClick={() => select(String(o.id))}
            onKeyDown={e => onItemKeyDown(e, String(o.id))}
            style={{
              padding: '7px 12px',
              cursor: 'pointer',
              fontSize: '0.88rem',
              color: String(o.id) === String(value) ? 'var(--ca-amber)' : 'var(--ca-text)',
              background: String(o.id) === String(value) ? 'rgba(245,158,11,0.1)' : 'transparent',
              fontWeight: String(o.id) === String(value) ? 600 : 400,
              transition: 'background 0.1s',
              outline: 'none',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = String(o.id) === String(value) ? 'rgba(245,158,11,0.1)' : 'transparent'; }}
          >
            {o.nombre}
          </li>
        ))}
      </ul>
    </div>,
    document.body
  ) : null;

  return (
    <div ref={containerRef} className={`ss-wrap${disabled ? ' ss-disabled' : ''} ${className}`} style={{ position: 'relative', width: '100%', minWidth: 0, boxSizing: 'border-box' }}>
      {/* Trigger */}
      <div
        id={id}
        className="ca-input ss-trigger"
        tabIndex={disabled ? -1 : 0}
        onClick={openDropdown}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDropdown(); } }}
        style={{ cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none', width: '100%', minWidth: 0, boxSizing: 'border-box' }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span style={{ color: selected ? 'var(--ca-text)' : 'rgba(148,163,184,0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.nombre : placeholder}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, marginLeft: 6 }}>
          {selected && !disabled && (
            <span
              onClick={clear}
              style={{ fontSize: '0.75rem', color: 'rgba(148,163,184,0.5)', lineHeight: 1, cursor: 'pointer', padding: '0 2px' }}
              title="Limpiar"
            >✕</span>
          )}
          <span style={{ fontSize: '0.7rem', color: 'rgba(148,163,184,0.4)', transition: 'transform 0.15s', display: 'inline-block', transform: open ? 'rotate(180deg)' : 'none' }}>▼</span>
        </span>
      </div>

      {dropdown}
    </div>
  );
}

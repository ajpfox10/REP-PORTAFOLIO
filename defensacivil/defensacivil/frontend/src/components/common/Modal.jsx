import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function Modal({ isOpen, onClose, title, children, width = 560 }) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = e => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position:'fixed', inset:0, background:'rgba(0,0,0,0.4)',
        display:'flex', alignItems:'center', justifyContent:'center',
        zIndex:1000, padding:'1rem',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background:'#fff', borderRadius:'var(--radius)',
          boxShadow:'0 20px 60px rgba(0,0,0,0.2)',
          width:'100%', maxWidth:width, maxHeight:'90vh',
          display:'flex', flexDirection:'column',
        }}
      >
        <div style={{
          display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'1rem 1.5rem', borderBottom:'1px solid var(--color-border)',
        }}>
          <h2 style={{ fontSize:'1.125rem', fontWeight:600 }}>{title}</h2>
          <button
            onClick={onClose}
            style={{ background:'none', border:'none', cursor:'pointer', fontSize:'1.25rem', color:'#64748b' }}
          >
            ✕
          </button>
        </div>
        <div style={{ padding:'1.5rem', overflowY:'auto', flex:1 }}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

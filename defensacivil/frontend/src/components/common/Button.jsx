const VARIANTS = {
  primary:  { bg:'#1d4ed8', hover:'#1e40af', text:'#fff' },
  danger:   { bg:'#dc2626', hover:'#b91c1c', text:'#fff' },
  success:  { bg:'#16a34a', hover:'#15803d', text:'#fff' },
  secondary:{ bg:'#f1f5f9', hover:'#e2e8f0', text:'#1e293b' },
  ghost:    { bg:'transparent', hover:'#f1f5f9', text:'#1e293b' },
};

const SIZES = {
  sm: { padding:'0.375rem 0.75rem', fontSize:'0.8125rem' },
  md: { padding:'0.5rem 1rem',      fontSize:'0.875rem'  },
  lg: { padding:'0.625rem 1.25rem', fontSize:'1rem'      },
};

export default function Button({
  children, variant = 'primary', size = 'md',
  onClick, type = 'button', disabled = false, isLoading = false,
  style = {},
}) {
  const v = VARIANTS[variant] || VARIANTS.primary;
  const s = SIZES[size] || SIZES.md;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || isLoading}
      style={{
        display:'inline-flex', alignItems:'center', gap:'0.5rem',
        ...s, background: v.bg, color: v.text,
        border:'none', borderRadius:'var(--radius)', cursor:'pointer',
        fontWeight:500, transition:'background 0.15s',
        opacity: (disabled || isLoading) ? 0.6 : 1,
        ...style,
      }}
      onMouseOver={e => { if (!disabled && !isLoading) e.currentTarget.style.background = v.hover; }}
      onMouseOut={e  => { e.currentTarget.style.background = v.bg; }}
    >
      {isLoading && (
        <span style={{
          width:14, height:14, border:'2px solid currentColor',
          borderTopColor:'transparent', borderRadius:'50%',
          animation:'spin 0.7s linear infinite',
          display:'inline-block',
        }} />
      )}
      {children}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </button>
  );
}

import { forwardRef } from 'react';
import { Link } from 'react-router-dom';

const Button = forwardRef(function Button(
  { variant = 'primary', size, icon: Icon, isLoading = false, block = false, to, className = '', children, disabled, type = 'button', ...rest },
  ref
) {
  const classes = ['btn', `btn-${variant}`, size && `btn-${size}`, block && 'btn-block', !children && 'btn-icon', className]
    .filter(Boolean).join(' ');
  const content = (
    <>
      {isLoading ? <span className="spinner" aria-hidden="true" /> : Icon && <Icon size={size === 'sm' ? 15 : 16} aria-hidden="true" />}
      {children}
    </>
  );
  if (to) return <Link ref={ref} to={to} className={classes} {...rest}>{content}</Link>;
  return (
    <button ref={ref} type={type} className={classes} disabled={disabled || isLoading} aria-busy={isLoading || undefined} {...rest}>
      {content}
    </button>
  );
});

export default Button;

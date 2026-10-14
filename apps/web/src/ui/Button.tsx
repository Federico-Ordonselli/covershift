import { type ButtonHTMLAttributes } from 'react';
import styles from './ui.module.css';

export function Button({
  variant = 'primary',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }) {
  const classes = [styles.button, variant === 'secondary' ? styles.secondary : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return <button type={type} className={classes} {...props} />;
}

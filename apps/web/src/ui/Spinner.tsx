import styles from './ui.module.css';

/** Loading state, announced politely to screen readers. */
export function Spinner({ label }: { label: string }) {
  return (
    <div className={styles.spinner} role="status">
      <span aria-hidden="true">…</span>
      <span>{label}</span>
    </div>
  );
}

export function FullPageSpinner({ label }: { label: string }) {
  return (
    <div className={styles.fullPage}>
      <Spinner label={label} />
    </div>
  );
}

import { type ReactNode, useEffect, useRef } from 'react';

/**
 * The page's <h1>. Takes focus when the page mounts, so after client-side navigation
 * screen-reader and keyboard users start at the new page's title, as with a full load.
 */
export function PageHeading({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <h1 ref={ref} tabIndex={-1}>
      {children}
    </h1>
  );
}

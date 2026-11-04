import { useEffect, useState } from 'react';

function readDarkTheme(): boolean {
  return (
    document.body.classList.contains('vscode-dark') ||
    document.body.classList.contains('vscode-high-contrast')
  );
}

/** Tracks the IDE's light/dark theme, which VS Code signals via body classes. */
export function useVsCodeDarkTheme(): boolean {
  const [isDark, setIsDark] = useState(readDarkTheme);

  useEffect(() => {
    const observer = new MutationObserver(() => setIsDark(readDarkTheme()));
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

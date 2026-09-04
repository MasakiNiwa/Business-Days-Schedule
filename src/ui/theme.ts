/**
 * 配色モード（自動 / ライト / ダーク）。
 *
 * 自動は OS の設定に従う。明示的に選んだ場合は <html data-theme> を立て、
 * CSS 側で prefers-color-scheme より優先させる。
 */

export type Theme = 'auto' | 'light' | 'dark';

export const THEMES: { value: Theme; label: string; icon: string }[] = [
  { value: 'auto', label: '自動', icon: '◐' },
  { value: 'light', label: 'ライト', icon: '☀' },
  { value: 'dark', label: 'ダーク', icon: '☾' },
];

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

/** 自動 → ライト → ダーク → 自動 と巡回する。 */
export function nextTheme(theme: Theme): Theme {
  const index = THEMES.findIndex((item) => item.value === theme);
  return THEMES[(index + 1) % THEMES.length]?.value ?? 'auto';
}

export function themeLabel(theme: Theme): string {
  return THEMES.find((item) => item.value === theme)?.label ?? '自動';
}

export function themeIcon(theme: Theme): string {
  return THEMES.find((item) => item.value === theme)?.icon ?? '◐';
}

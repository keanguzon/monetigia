interface NavigationIntent {
  button?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
  target?: string;
  download?: boolean;
}

export function navigationDestination(href: string, current: string, intent: NavigationIntent) {
  if (intent.defaultPrevented || (intent.button ?? 0) !== 0 || intent.ctrlKey || intent.metaKey || intent.shiftKey || intent.altKey || intent.download || (intent.target && intent.target !== "_self")) return null;
  const from = new URL(current);
  const to = new URL(href, from);
  if (to.origin !== from.origin || !["http:", "https:"].includes(to.protocol)) return null;
  if (to.pathname === from.pathname && to.search === from.search) return null;
  return `${to.pathname}${to.search}${to.hash}`;
}

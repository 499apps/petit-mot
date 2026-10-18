/** Elements whose text Petit Mot never changes. */
export const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'BUTTON',
  'A', 'LABEL', 'CODE', 'PRE', 'KBD', 'SAMP', 'VAR', 'TT', 'SVG', 'MATH', 'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO',
  'OBJECT', 'EMBED', 'NAV', 'FOOTER', 'FORM', 'DIALOG', 'SUMMARY', 'ABBR', 'TIME', 'ADDRESS',
]);
const SKIP_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'button', 'link', 'menu', 'menuitem', 'menubar', 'tab', 'tablist', 'navigation', 'toolbar', 'option', 'listbox', 'switch', 'checkbox', 'radio', 'slider', 'spinbutton', 'code']);

function selfSkips(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName.toUpperCase())) return true;
  if ((el as HTMLElement).isContentEditable) return true;
  const ce = el.getAttribute('contenteditable');
  if (ce !== null && ce !== 'false') return true;
  if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return true;
  if (el.getAttribute('translate') === 'no' || el.classList.contains('notranslate')) return true;
  const role = el.getAttribute('role');
  if (role && SKIP_ROLES.has(role)) return true;
  if (el.hasAttribute('data-pm-id') || el.hasAttribute('data-pm-ui')) return true; // ours
  return false;
}

/** Memoised "is this element or any ancestor off-limits?" for one scan. */
export function makeSkipper(): (el: Element | null) => boolean {
  const memo = new WeakMap<Element, boolean>();
  const check = (el: Element | null): boolean => {
    if (!el) return false;
    const hit = memo.get(el);
    if (hit !== undefined) return hit;
    const r = selfSkips(el) || check(el.parentElement);
    memo.set(el, r);
    return r;
  };
  return check;
}

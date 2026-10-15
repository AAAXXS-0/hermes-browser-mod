export const POINTER_BINDING = '__hermesBrowserModPointer';

// Observe real browser mouse events. No elements/styles are inserted into the
// remote page, so the pointer never changes its DOM snapshot or screenshots.
export function installPointerTelemetry({ bindingName }) {
  const marker = `${bindingName}Installed`;
  if (window[marker]) return;
  window[marker] = true;
  let pendingMove = null;
  let scheduled = false;
  const clean = value => String(value || '').replace(/[\uE000-\uF8FF]/g, '').replace(/\s+/g, ' ').trim();
  const report = (phase, event) => {
    if (phase !== 'reset' && !event?.isTrusted) return;
    const raw = event?.target instanceof Element ? event.target : null;
    const element = raw?.closest('button,a,input,textarea,select,[role="button"],[role="link"],h1,h2,h3,h4,h5,h6') || raw;
    const label = element ? clean(element.getAttribute('aria-label') || element.labels?.[0]?.innerText || element.getAttribute('title') || element.getAttribute('placeholder') || (element.matches('button,a,[role="button"],[role="link"],h1,h2,h3,h4,h5,h6') ? element.innerText : '')).slice(0, 100) : '';
    let context = '';
    for (let ancestor = element?.parentElement, depth = 0; ancestor && ancestor.tagName !== 'BODY' && depth < 5; ancestor = ancestor.parentElement, depth++) {
      const headings = ancestor.querySelectorAll('h1,h2,h3,h4,h5,h6');
      if (headings.length === 1) { context = clean(headings[0].innerText).slice(0, 100); break; }
    }
    const data = {
      phase, x: event?.clientX, y: event?.clientY,
      viewport: { width: innerWidth, height: innerHeight },
      label, context, tag: element?.tagName.toLowerCase() || '',
      button: event?.button ?? 0, clickCount: event?.detail || 1,
    };
    try { Promise.resolve(window[bindingName]?.(data)).catch(() => {}); } catch {}
  };
  window.addEventListener('mousemove', event => {
    pendingMove = event;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; if (pendingMove) report('move', pendingMove); pendingMove = null; });
  }, true);
  for (const [name, phase] of [['mousedown', 'down'], ['mouseup', 'up']]) {
    window.addEventListener(name, event => {
      // Flush pending movement before the press so a later RAF doesn't show an
      // older point after a newer click.
      if (pendingMove) { report('move', pendingMove); pendingMove = null; }
      report(phase, event);
    }, true);
  }
  for (const name of ['scroll', 'resize']) window.addEventListener(name, () => { pendingMove = null; report('reset'); }, { capture: true, passive: true });
}

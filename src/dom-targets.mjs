// Runs in the page through Playwright. The same descriptor is used for snapshots
// and for validating a saved ElementHandle immediately before an action.
export function inspectDom(root, { firstRef = 1, limit = 180, describeOnly = false } = {}) {
  const clean = value => String(value || '').replace(/[\uE000-\uF8FF]/g, '').replace(/\s+/g, ' ').trim();
  function describe(element) {
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute('role');
    const label = clean(element.getAttribute('aria-label') || element.labels?.[0]?.innerText || element.getAttribute('placeholder') || element.getAttribute('title') || element.innerText || element.getAttribute('name')).slice(0, 240);
    let context = '';
    for (let ancestor = element.parentElement, depth = 0; ancestor && depth < 6 && ancestor.tagName !== 'BODY'; ancestor = ancestor.parentElement, depth++) {
      const headings = [...ancestor.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')];
      const text = clean(ancestor.innerText);
      if (headings.length && headings.length <= 2 && text.length <= 500) { context = text.slice(0, 360); break; }
      if (!context && text && text !== label && text.length <= 300) context = text;
    }
    const box = element.getBoundingClientRect();
    const heading = /^h[1-6]$/.test(tag) || role === 'heading';
    const native = ['a', 'button', 'input', 'textarea', 'select'].includes(tag) || ['button', 'link'].includes(role);
    const pointer = getComputedStyle(element).cursor === 'pointer';
    const kind = element.isContentEditable ? 'editor' : heading ? 'heading' : native ? (role || tag) : pointer ? 'clickable-container' : 'element';
    const href = element.getAttribute('href');
    return {
      tag, role, label, context, kind, type: element.getAttribute('type'), href,
      unnamed: !label,
      editable: element.isContentEditable || ['input', 'textarea'].includes(tag),
      disabled: !!element.disabled || element.getAttribute('aria-disabled') === 'true',
      rect: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
      inViewport: box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth,
      fingerprint: JSON.stringify([tag, role, label, context, href]),
      value: element.type === 'password' ? '[hidden]' : element.isContentEditable ? element.innerText.slice(0, 1000) : element.value,
    };
  }
  if (describeOnly) return { connected: root.isConnected, ...describe(root) };
  const semantic = 'a,button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"],h1,h2,h3,h4,h5,h6,[role="heading"],[onclick],[tabindex]';
  const candidates = [...root.querySelectorAll('*')].filter(element => {
    if (['SCRIPT', 'STYLE', 'SVG', 'PATH', 'NOSCRIPT'].includes(element.tagName)) return false;
    if (!element.getClientRects().length) return false;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.visibility === 'collapse' || style.display === 'none') return false;
    if (element.matches(semantic)) return true;
    // Detect clickable div/card boundaries without listing every descendant that
    // merely inherits cursor:pointer. Headings stay addressable independently.
    return style.cursor === 'pointer' && (!element.parentElement || getComputedStyle(element.parentElement).cursor !== 'pointer');
  });
  const selected = candidates.slice(0, limit);
  return {
    targets: selected,
    payload: {
      elements: selected.map((element, index) => ({ ref: `e${firstRef + index}`, ...describe(element) })),
      totalTargets: candidates.length,
      truncated: candidates.length > limit,
    },
  };
}

export function formatTargets(elements) {
  return elements.map(element => `[ref=${element.ref}] ${element.kind} ${JSON.stringify(element.label || (element.editable ? '可输入编辑器' : '无名称控件'))}${element.frameId ? ` | frame=${element.frameId}` : ''}${element.context ? ` | 所属区域: ${element.context}` : ''}${element.unnamed ? ' | 无名称，不能据编号猜测用途' : ''}${element.disabled ? ' | 已禁用' : ''}`).join('\n');
}

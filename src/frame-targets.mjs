// Playwright can inspect cross-origin frames without the site's same-origin
// restrictions. Coordinates exposed to the agent always use the main viewport.
export async function frameMetadata(frame, frames) {
  const frameId = `f${frames.indexOf(frame)}`;
  const parent = frame.parentFrame();
  if (!parent) return { frameId, parentFrameId: null, url: frame.url(), name: frame.name(), rect: null };
  const element = await frame.frameElement();
  try {
    return { frameId, parentFrameId: `f${frames.indexOf(parent)}`, url: frame.url(), name: frame.name(), title: await element.getAttribute('title'), rect: await element.boundingBox() };
  } finally { await element.dispose(); }
}

// Return the deepest DOM target at a main-frame point. Merely returning the
// outer iframe falsely suggests that browser mouse events stopped at its edge.
export async function hitTestFrame(page, point) {
  const frames = page.frames();
  let frame = page.mainFrame(), local = point;
  const path = [];
  for (let depth = 0; depth < 32; depth++) {
    const handle = await frame.evaluateHandle(({ x, y }) => document.elementFromPoint(x, y), local);
    try {
      const element = handle.asElement();
      if (!element) return { target: null, framePath: path };
      const target = await element.evaluate(node => ({ tag: node.tagName.toLowerCase(), role: node.getAttribute('role'), label: (node.getAttribute('aria-label') || node.getAttribute('placeholder') || node.getAttribute('title') || node.innerText || '').trim().slice(0, 160), editable: node.isContentEditable || ['INPUT', 'TEXTAREA'].includes(node.tagName) }));
      path.push({ frameId: `f${frames.indexOf(frame)}`, url: frame.url() });
      const child = await element.contentFrame();
      if (!child) return { target: { ...target, frameId: path.at(-1).frameId }, framePath: path };
      // elementFromPoint uses the parent's CSS coordinates. Include borders
      // and ordinary axis-aligned CSS scaling when entering a child frame.
      const box = await element.evaluate(node => {
        const rect = node.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, offsetWidth: node.offsetWidth, offsetHeight: node.offsetHeight, borderX: node.clientLeft, borderY: node.clientTop };
      });
      if (!box.width || !box.height || !box.offsetWidth || !box.offsetHeight) return { target, framePath: path };
      const next = { x: (local.x - box.x) * box.offsetWidth / box.width - box.borderX, y: (local.y - box.y) * box.offsetHeight / box.height - box.borderY };
      const size = await child.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      // A frame's border belongs to the iframe element, not its document.
      if (next.x < 0 || next.y < 0 || next.x >= size.width || next.y >= size.height) return { target: { ...target, frameId: path.at(-1).frameId }, framePath: path };
      frame = child;
      local = next;
    } finally { await handle.dispose(); }
  }
  throw new Error('iframe 嵌套过深，请使用 DOM ref 定位');
}

export async function focusedEditable(page) {
  let frame = page.mainFrame();
  for (let depth = 0; depth < 32; depth++) {
    const handle = await frame.evaluateHandle(() => document.activeElement);
    const element = handle.asElement();
    if (!element) { await handle.dispose(); break; }
    const child = await element.contentFrame();
    if (child) { await handle.dispose(); frame = child; continue; }
    return { element, frame };
  }
  throw new Error('没有可输入的焦点，请先点击编辑器或提供 ref');
}

export function describeEditable(node) {
  const input = node.tagName === 'INPUT' && ['text', 'search', 'url', 'tel', 'email', 'password', 'number'].includes(node.type);
  return { editable: !node.disabled && !node.readOnly && (node.isContentEditable || input || node.tagName === 'TEXTAREA'), tag: node.tagName.toLowerCase(), label: node.getAttribute('aria-label') || node.getAttribute('placeholder') || node.getAttribute('title') || '', password: node.type === 'password' };
}

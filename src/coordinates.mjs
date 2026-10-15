export function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error('截图不是有效 PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export function toViewportPoint({ x, y, coordinateSpace = 'image' }, screenshot) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('坐标 x/y 必须是有限数字');
  const sizes = {
    image: { width: screenshot.imageWidth, height: screenshot.imageHeight },
    viewport: screenshot.viewport,
    normalized: { width: 1, height: 1 },
  };
  const size = sizes[coordinateSpace];
  if (!size) throw new Error('坐标系必须是 image、viewport 或 normalized');
  if (x < 0 || y < 0 || x >= size.width || y >= size.height) throw new Error(`坐标超出 ${coordinateSpace} 范围：0 ≤ x < ${size.width}，0 ≤ y < ${size.height}`);
  return { x: x / size.width * screenshot.viewport.width, y: y / size.height * screenshot.viewport.height };
}

// A page-context JSHandle holds this tracker; no global is exposed to the site.
export function createVisualTracker() {
  let revision = 0;
  const observer = new MutationObserver(() => { revision++; });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  return { document: document.documentElement, documentId: `${Date.now()}-${Math.random()}`, observer, get revision() { return revision; } };
}

export function readVisualTracker(tracker) {
  return {
    connected: tracker.document === document.documentElement && tracker.document.isConnected,
    documentId: tracker.documentId,
    revision: tracker.revision,
    width: innerWidth, height: innerHeight,
    scrollX, scrollY, devicePixelRatio,
    url: location.href,
  };
}

// Resize a captured bitmap offscreen. This never inserts DOM nodes or changes
// browser emulation / zoom, and works without a site's img-src data: allowance.
export async function resizeScreenshotInPage({ data, width, height }) {
  const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0));
  const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  try {
    const surface = new OffscreenCanvas(width, height);
    const context = surface.getContext('2d');
    context.drawImage(image, 0, 0, width, height);
    const blob = await surface.convertToBlob({ type: 'image/png' });
    const output = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < output.length; offset += 32768) binary += String.fromCharCode(...output.subarray(offset, offset + 32768));
    return btoa(binary);
  } finally { image.close(); }
}

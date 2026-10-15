export function previewGeometry({ width, height }, image, viewport) {
  if (!width || !height || !image.width || !image.height || !viewport.width || !viewport.height) return null;
  const scale = Math.min(width / image.width, height / image.height);
  return {
    left: (width - image.width * scale) / 2,
    top: (height - image.height * scale) / 2,
    width: image.width * scale,
    height: image.height * scale,
    viewport,
  };
}

export function viewportToPreview(point, geometry) {
  if (!geometry || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x >= geometry.viewport.width || point.y >= geometry.viewport.height) return null;
  return { x: geometry.left + point.x / geometry.viewport.width * geometry.width, y: geometry.top + point.y / geometry.viewport.height * geometry.height };
}

export function previewToViewport(point, geometry) {
  if (!geometry || point.x < geometry.left || point.y < geometry.top || point.x >= geometry.left + geometry.width || point.y >= geometry.top + geometry.height) return null;
  return { x: (point.x - geometry.left) / geometry.width * geometry.viewport.width, y: (point.y - geometry.top) / geometry.height * geometry.viewport.height };
}

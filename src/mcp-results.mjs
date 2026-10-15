// Keep the full event feed and pointer animation data in the UI/WS protocol.
// Repeating 35 old events after every agent action wastes its context window.
export function formatMcpResult(result, action, args = {}) {
  if (action === 'snapshot') {
    const limit = args.includeTree ? 24000 : 4000;
    return { ...result, tree: result.tree.slice(0, limit), treeTruncated: result.treeTruncated || result.tree.length > limit };
  }
  if (!Array.isArray(result.tabs)) return result;
  const { events, pointer, ...state } = result;
  const lastClick = pointer?.lastClick;
  return { ...state, ...(action === 'state' ? { events: events?.slice(-3), lastClick: lastClick ? { x: lastClick.x, y: lastClick.y, label: lastClick.label, context: lastClick.context, actor: lastClick.actor } : null } : {}) };
}

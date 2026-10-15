import { atom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import type { GatewayEvent } from "@hermes/protocol";
import { getGatewayClient } from "@/lib/gateway-client";
import { resolvePersistentSessionId } from "@/lib/session-map";
import { runtime } from "@/lib/runtime";
import { rightRailVisibleAtom } from "@/stores/ui";
import { previewEditorDirtyAtom } from "@/stores/preview-rail";
import { appendNoticeAtom } from "@/stores/chat";

const actions: Record<string, string> = {
  state: "查看浏览器", snapshot: "读取网页", navigate: "打开网页", click: "点击元素",
  fill: "填写内容", type: "逐字输入", press: "按键", scroll: "滚动网页",
  new_tab: "新建标签页", activate_tab: "切换标签页", close_tab: "关闭标签页",
  screenshot: "截取网页", click_at: "坐标点击", hover_at: "鼠标悬停",
  handle_dialog: "处理网页弹窗", release_control: "交给你操作",
};
export function browserModAction(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const prefix = "mcp__hermes_browser_mod__browser_";
  return name.startsWith(prefix) ? actions[name.slice(prefix.length)] ?? null : null;
}
interface Activity { sessionId: string; toolId?: string; label: string; state: "running" | "done" | "error"; }
export const browserModActivityAtom = atom<Activity | null>(null);

export function useBrowserModAutoReveal(sessionId: string | undefined) {
  const [searchParams, setSearchParams] = useSearchParams();
  const dirty = useAtomValue(previewEditorDirtyAtom);
  const reveal = useSetAtom(rightRailVisibleAtom);
  const setActivity = useSetAtom(browserModActivityAtom);
  const appendNotice = useSetAtom(appendNoticeAtom);
  const latest = useRef({ sessionId, dirty, searchParams, setSearchParams });
  latest.current = { sessionId, dirty, searchParams, setSearchParams };
  useEffect(() => {
    if (runtime.isRemote()) return;
    const seen = new Set<string>();
    let warned = false;
    return getGatewayClient().onAny((event: GatewayEvent) => {
      if (runtime.isRemote()) return;
      if (event.type !== "tool.start" && event.type !== "tool.complete") return;
      const current = latest.current;
      const selectedSessionId = current.sessionId;
      if (!selectedSessionId || typeof event.session_id !== "string" || resolvePersistentSessionId(event.session_id) !== resolvePersistentSessionId(selectedSessionId)) return;
      const payload = event.payload as { name?: unknown; tool_id?: unknown; error?: unknown } | undefined;
      const label = browserModAction(payload?.name);
      const toolId = typeof payload?.tool_id === "string" ? payload.tool_id : undefined;
      if (event.type === "tool.complete") {
        setActivity(previous => previous !== null && previous.sessionId === selectedSessionId && (toolId ? previous.toolId === toolId : label === previous.label)
          ? { ...previous, state: payload?.error ? "error" : "done" } : previous);
        return;
      }
      if (!label) return;
      const key = toolId ? `${event.session_id}:${toolId}` : null;
      if (key && seen.has(key)) return;
      if (key) { seen.add(key); if (seen.size > 256) seen.delete(seen.values().next().value!); }
      setActivity({ sessionId: selectedSessionId, toolId, label, state: "running" });
      if (current.dirty) {
        if (!warned) appendNotice({ sessionId: event.session_id, level: "warning", text: "Agent 正在使用浏览器。文件预览有未保存修改，请保存后切到浏览器查看操作。" });
        warned = true;
        return;
      }
      warned = false;
      const next = new URLSearchParams(current.searchParams);
      next.set("panel", "web");
      current.setSearchParams(next, { replace: true });
      reveal(true);
    });
  }, [appendNotice, reveal, setActivity]);
}

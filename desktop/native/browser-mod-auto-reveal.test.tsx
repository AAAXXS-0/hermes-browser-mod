// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider, atom, createStore, useAtomValue, useSetAtom } from "jotai";
import { MemoryRouter, useLocation } from "react-router-dom";
const mocks = vi.hoisted(() => ({ listener: null as ((event: any) => void) | null, unsubscribe: vi.fn(), remote: false, notices: [] as any[] }));
vi.mock("@/lib/gateway-client", () => ({ getGatewayClient: () => ({ onAny: (cb: any) => { mocks.listener = cb; return mocks.unsubscribe; } }) }));
vi.mock("@/lib/session-map", () => ({ resolvePersistentSessionId: (id: string) => id === "gateway-current" ? "current" : id }));
vi.mock("@/lib/runtime", () => ({ runtime: { isRemote: () => mocks.remote } }));
vi.mock("@/stores/ui", () => ({ rightRailVisibleAtom: atom(false) }));
vi.mock("@/stores/preview-rail", () => ({ previewEditorDirtyAtom: atom(false) }));
vi.mock("@/stores/chat", () => ({ appendNoticeAtom: atom(null, (_get, _set, notice) => { mocks.notices.push(notice); }) }));
import { rightRailVisibleAtom } from "@/stores/ui";
import { previewEditorDirtyAtom } from "@/stores/preview-rail";
import { browserModAction, browserModActivityAtom, useBrowserModAutoReveal } from "./browser-mod-auto-reveal";
function Harness() {
  useBrowserModAutoReveal("current");
  const visible = useAtomValue(rightRailVisibleAtom), setVisible = useSetAtom(rightRailVisibleAtom);
  const activity = useAtomValue(browserModActivityAtom);
  return <><output data-testid="state">{JSON.stringify({ visible, search: useLocation().search, activity })}</output><button onClick={() => setVisible(false)}>关闭</button></>;
}
function mount(dirty = false) {
  const store = createStore(); store.set(previewEditorDirtyAtom, dirty);
  render(<Provider store={store}><MemoryRouter initialEntries={["/tasks/current?panel=files&keep=yes"]}><Harness /></MemoryRouter></Provider>);
  return store;
}
function event(type = "tool.start", id = "one", name: string | undefined = "mcp__hermes_browser_mod__browser_snapshot", session = "gateway-current", error?: string) {
  act(() => mocks.listener?.({ type, session_id: session, payload: { tool_id: id, name, error } }));
}
function state() { return JSON.parse(screen.getByTestId("state").textContent!); }
afterEach(() => { cleanup(); mocks.listener = null; mocks.remote = false; mocks.notices = []; vi.clearAllMocks(); });
describe("Browser Mod 自动展开", () => {
  it("opens the current session rail and switches tabs while retaining other query parameters", () => {
    mount(); expect(state().visible).toBe(false); event();
    expect(state()).toMatchObject({ visible: true, activity: { label: "读取网页", state: "running" } });
    expect(state().search).toContain("panel=web"); expect(state().search).toContain("keep=yes");
    event("tool.complete"); expect(state().activity.state).toBe("done");
  });
  it("ignores other sessions, built-in browsers, unrelated MCP tools and unknown actions", () => {
    mount(); event("tool.start", "one", "mcp__hermes_browser_mod__browser_click", "other");
    for (const name of ["browser_exec", "mcp__other__browser_click", "mcp__hermes_browser_mod__browser_unknown"]) event("tool.start", name, name);
    expect(state().visible).toBe(false); expect(state().activity).toBeNull();
  });
  it("allows manual close until a new call and never reopens on completion or a duplicate start", () => {
    mount(); event(); fireEvent.click(screen.getByText("关闭")); event(); event("tool.complete");
    expect(state().visible).toBe(false); event("tool.start", "two"); expect(state().visible).toBe(true);
  });
  it("protects unsaved file drafts and notifies once until safe to switch", () => {
    const store = mount(true); event(); event("tool.start", "two");
    expect(state().visible).toBe(false); expect(state().search).toContain("panel=files"); expect(mocks.notices).toHaveLength(1);
    act(() => store.set(previewEditorDirtyAtom, false)); event("tool.start", "three"); expect(state().visible).toBe(true);
  });
  it("tracks failures by tool ID even if completion omits the name, and ignores stale completions", () => {
    mount(); event(); event("tool.start", "two"); event("tool.complete", "one"); expect(state().activity.state).toBe("running");
    act(() => mocks.listener?.({ type: "tool.complete", session_id: "gateway-current", payload: { tool_id: "two", error: "failure" } }));
    expect(state().activity.state).toBe("error");
  });
  it("does not subscribe for remote connections and unsubscribes on unmount", () => {
    mocks.remote = true; mount(); expect(mocks.listener).toBeNull(); cleanup();
    mocks.remote = false; mount(); cleanup(); expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });
  it("matches all 16 actual MCP tool names with readable action labels", () => {
    const names = ["state", "snapshot", "navigate", "click", "fill", "type", "press", "scroll", "new_tab", "activate_tab", "close_tab", "screenshot", "click_at", "hover_at", "handle_dialog", "release_control"];
    for (const name of names) expect(browserModAction(`mcp__hermes_browser_mod__browser_${name}`)).toBeTruthy();
  });
});

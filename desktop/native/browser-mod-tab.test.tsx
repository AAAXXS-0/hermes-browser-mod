// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ postJSON: vi.fn(), remote: vi.fn(() => false) }));
vi.mock("@/lib/transport", () => ({ postJSON: mocks.postJSON }));
vi.mock("@/lib/runtime", () => ({ runtime: { isRemote: mocks.remote } }));
import { BrowserModTab } from "./browser-mod-tab";
vi.mock("./browser-mod-auto-reveal", async () => ({ browserModActivityAtom: (await import("jotai")).atom(null) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.remote.mockReturnValue(false); });
describe("native Browser Mod tab", () => {
  it("starts through the native transport and embeds the issued connection URL", async () => {
    mocks.postJSON.mockResolvedValue({ running: true, version: "1.4.1", embedUrl: "http://127.0.0.1:17371/?embedded=1&ticket=one-use" });
    render(<BrowserModTab />);
    const frame = await screen.findByTitle("Hermes 浏览器");
    expect(frame.getAttribute("src")).toContain("ticket=one-use");
    expect(mocks.postJSON).toHaveBeenCalledWith("/api/plugins/hermes-browser-mod/start", {});
  });
  it("reports failure and retries with a fresh embed connection", async () => {
    mocks.postJSON.mockRejectedValueOnce(new Error("service unavailable")).mockResolvedValueOnce({ running: true, embedUrl: "http://127.0.0.1:17371/?embedded=1&ticket=fresh" });
    render(<BrowserModTab />);
    expect((await screen.findByRole("alert")).textContent).toContain("service unavailable");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.getByTitle("Hermes 浏览器").getAttribute("src")).toContain("ticket=fresh"));
  });
  it("does not start a local browser for a remote Hermes connection", () => {
    mocks.remote.mockReturnValue(true);
    render(<BrowserModTab />);
    expect(screen.getByText("浏览器 Mod 当前仅支持本机 Hermes 连接。")).toBeTruthy();
    expect(mocks.postJSON).not.toHaveBeenCalled();
  });
});

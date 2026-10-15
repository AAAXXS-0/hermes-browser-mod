import { useEffect, useRef, useState } from "react";
import { Globe, RotateCw } from "lucide-react";
import { postJSON } from "@/lib/transport";
import { runtime } from "@/lib/runtime";
import s from "./preview-rail.module.css";
import { useAtomValue } from "jotai";
import { browserModActivityAtom } from "./browser-mod-auto-reveal";

interface BrowserConnection { running: boolean; version?: string; embedUrl: string; }

export function BrowserModTab({ sessionId }: { sessionId?: string } = {}) {
  const activity = useAtomValue(browserModActivityAtom);
  const [connection, setConnection] = useState<BrowserConnection | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const remote = runtime.isRemote();
  const connect = async () => {
    setBusy(true); setError("");
    try {
      const result = await postJSON<BrowserConnection>("/api/plugins/hermes-browser-mod/start", {});
      if (!result.running || !result.embedUrl) throw new Error("浏览器未就绪，请确认 Browser Mod 已更新并重新连接。");
      if (mounted.current) setConnection(result);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "浏览器连接失败");
    } finally { if (mounted.current) setBusy(false); }
  };
  useEffect(() => {
    mounted.current = true;
    if (!remote) void connect();
    return () => { mounted.current = false; };
  }, [remote]); // eslint-disable-line react-hooks/exhaustive-deps
  if (remote) return <div className={s.notice}>浏览器 Mod 当前仅支持本机 Hermes 连接。</div>;
  return <>
    <div className={s.bar}>
      <Globe size={12} aria-hidden />
      <span style={{ flex: 1, fontSize: 12 }}>Browser Mod {connection?.version ? `V${connection.version}` : ""}</span>
      <button type="button" className={s.iconBtn} disabled={busy} onClick={() => void connect()}>
        <RotateCw size={12} aria-hidden />{busy ? "连接中…" : "重新连接"}
      </button>
    </div>
    {activity && activity.sessionId === sessionId ? <div role="status" style={{ padding: "4px 12px", fontSize: 12 }}>
      Agent：{activity.label} · {activity.state === "running" ? "执行中" : activity.state === "error" ? "失败，请查看对话工具结果" : "已完成"}
    </div> : null}
    {error ? <div className={s.empty} role="alert"><p>{error}</p><button className={s.iconBtn} onClick={() => void connect()} disabled={busy}>重试</button></div> : null}
    {connection ? <iframe className={s.iframe} style={{ background: "var(--h-bg-app)" }} src={connection.embedUrl} title="Hermes 浏览器" referrerPolicy="no-referrer" /> : !error ? <div className={s.empty}>正在连接独立浏览器…</div> : null}
  </>;
}

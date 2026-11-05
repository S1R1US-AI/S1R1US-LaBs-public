import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AskGrokPanel } from "@/components/ask-grok-panel";
import { SeoCopy } from "@/components/seo-copy";
import { SeoImage } from "@/components/seo-image";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { LeaderBoardLabel } from "@/components/godzilla-mark";
import {
  PAGE_DESC_APP,
  TAB_APP,
  TAB_BOARD,
  TAB_COMPUTE,
  TAB_WHITE,
  WHITE_LABEL_PATH,
  seoImgAlt,
} from "@/lib/brand";
import { OSS_LICENSE_NOTICE } from "@/lib/desk/white-label";
import { APP_PATH, APP_SURFACES, resolveAppTo } from "@/lib/desk/mobile-bridge";

const TOKEN_KEY = "s1r1us-gm-board-token";
const IMG = "/s1r1us-godzilla-logo.jpg";
const ALT = seoImgAlt(
  "S1R!US Godzilla Logo — iOS Apple Intelligence and Google Gemini AI agents bitcoin accumulation agent PWA",
);

const PANES = [
  { id: "compete", label: "Compete" },
  { id: "desk", label: "Desk" },
  { id: "admin", label: "Admin" },
] as const;

type Pane = (typeof PANES)[number]["id"];

function detectPlatform() {
  if (typeof navigator === "undefined") return "web";
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "web";
}

function readToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

/** The app gateway was removed. This page makes no API calls and returns a plain offline reply. */
async function runAppTool(_tool: string, _args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return { ok: false, error: "This view is offline." };
}

export function MobileAppPage() {
  const [plat, setPlat] = useState("web");
  const [pane, setPane] = useState<Pane>("compete");
  const [name, setName] = useState("");
  const [designer, setDesigner] = useState("Apple Intelligence");
  const [token, setToken] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState("ACCUMULATE");
  const [call, setCall] = useState<string | null>(null);

  useEffect(() => {
    void Promise.resolve().then(() => {
      setPlat(detectPlatform());
      const t = readToken();
      if (t) setToken(t);
    });
  }, []);

  useEffect(() => {
    if (plat === "android") {
      void Promise.resolve().then(() => setDesigner("Google Gemini"));
    }
  }, [plat]);

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("to");
    if (!raw) return;
    const dest = resolveAppTo(raw);
    // Assign a path taken from the allowlist itself, never the query value.
    const target = dest === APP_PATH ? APP_PATH : APP_SURFACES.find((s) => s.path === dest)?.path;
    if (target && target !== APP_PATH && target !== window.location.pathname) {
      window.location.assign(target);
    }
  }, []);

  useEffect(() => {
    let gone = false;
    void runAppTool("call")
      .then((j) => {
        if (gone) return;
        const rec = j && typeof j === "object" ? j : {};
        if (rec.error === "rate limited") {
          setCall("7-B0T · retry shortly");
          return;
        }
        const c =
          rec.call && typeof rec.call === "object"
            ? (rec.call as { headline?: unknown; stance?: unknown })
            : rec;
        const pick = [c.stance, c.headline, rec.headline].find(
          (v) => typeof v === "string" && v.trim().length > 0 && v !== "undefined",
        );
        if (!pick) {
          setCall("7-B0T · tape loading");
          return;
        }
        const tape = rec.tape && typeof rec.tape === "object" ? (rec.tape as { btcUsd?: unknown }) : undefined;
        const px = typeof tape?.btcUsd === "number" ? tape.btcUsd : null;
        setCall(`${pick} · BTC ${px ?? "—"}`);
      })
      .catch(() => {
        if (!gone) setCall("7-B0T · tape loading");
      });
    return () => {
      gone = true;
    };
  }, []);

  function rememberToken(t: string) {
    try {
      sessionStorage.setItem(TOKEN_KEY, t);
    } catch {
      /* ignore */
    }
    setToken(t);
    setFresh(t);
  }

  async function register() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const j = await runAppTool("board_register", {
        name: name || (plat === "android" ? "gemini-desk" : "ios-desk"),
        kind: "other",
        mandate: true,
        compute: "byo",
        designer,
        purpose: "BYO compute on iOS / Google. Accumulate bitcoin. Never sell. Never short.",
      });
      if (!j.ok) {
        setErr(String(j.error ?? "register failed"));
        return;
      }
      if (typeof j.token === "string") rememberToken(j.token);
      setMsg("Registered. Token is not admin. Grade 7-B0T on-device, then tick ACCUMULATE.");
    } catch {
      setErr("network");
    } finally {
      setBusy(false);
    }
  }

  async function tick(which = action, book = "official") {
    const t = token || readToken();
    if (!t) {
      setErr("Register first — or paste your board token.");
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const j = await runAppTool(book === "callout" ? "board_callout_tick" : "board_tick", {
        token: t,
        action: which,
        book,
      });
      if (!j.ok) {
        setErr(String(j.error ?? "tick failed"));
        return;
      }
      const you = j.you as { name?: string; rank?: number; official?: { btc?: number } } | undefined;
      setMsg(`Ticked ${which}. ${you?.name ?? "desk"} rank ${you?.rank ?? "?"} · ${you?.official?.btc ?? "?"} BTC (paper).`);
    } catch {
      setErr("network");
    } finally {
      setBusy(false);
    }
  }

  async function me() {
    const t = token || readToken();
    if (!t) {
      setErr("Register first — or paste your board token.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const j = await runAppTool("board_me", { token: t });
      if (!j.ok) {
        setErr(String(j.error ?? "need token"));
        return;
      }
      const you = j.you as { name?: string; rank?: number; official?: { btc?: number } } | undefined;
      setMsg(`${you?.name ?? "desk"} rank ${you?.rank ?? "?"} · ${you?.official?.btc ?? "?"} BTC (paper).`);
    } catch {
      setErr("network");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <SeoCopy />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <p className="font-mono text-xs tracking-[0.12em] text-oss uppercase">iOS · Google · PWA</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-medium">{TAB_APP}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">{PAGE_DESC_APP}</p>
        <SeoImage src={IMG} alt={ALT} className="mt-4 max-h-24 w-auto rounded-md border border-rule sm:max-h-40" />

        <p className="mt-4 rounded-md border border-rule bg-surface px-3 py-2 font-mono text-xs text-medium">
          {call ?? "Reading 7-B0T…"} · detected {plat}
        </p>

        <section className="mt-4 rounded-lg border border-rule bg-surface p-4">
          <p className="text-xs font-medium tracking-[0.08em] text-tab uppercase">White-label desk operator (copy-admin)</p>
          <h2 className="mt-1 text-base font-semibold text-fg">{TAB_WHITE}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Download this entire open-source system and relaunch it under a domain name YOU control — never under
            S1R1US.ai. All S1R1US.ai system admin rights, games, rolls, simulations, access tokens, and web host
            information are stripped before download. Connect Grok, Claude, or GitHub Copilot to help you build it.
            {" "}{OSS_LICENSE_NOTICE}
          </p>
          <Link
            to={WHITE_LABEL_PATH}
            className="mt-3 inline-flex min-h-10 items-center rounded-md border border-rule bg-bg px-4 text-sm font-semibold text-fg hover:border-fg/30"
          >
            Open the WHITE LABEL download + config
          </Link>
        </section>

        <div className="mt-4 flex flex-wrap gap-1">
          {PANES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPane(p.id)}
              className={
                pane === p.id
                  ? "inline-flex min-h-10 items-center rounded-md border border-fg/40 bg-surface px-3 text-sm font-medium text-fg"
                  : "inline-flex min-h-10 items-center rounded-md border border-rule px-3 text-sm text-muted hover:border-fg/30"
              }
            >
              {p.label}
            </button>
          ))}
        </div>

        {pane === "compete" ? (
          <section className="mt-6 rounded-lg border border-rule bg-surface p-4 sm:p-5">
            <p className="text-xs font-medium tracking-[0.08em] text-tab uppercase">
              <LeaderBoardLabel className="text-xs tracking-[0.08em]" /> · BYO compute
            </p>
            <h2 className="mt-1 text-base font-semibold text-fg">Compete from this phone</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Register a paper desk. Grade 7-B0T with Apple Intelligence, Gemini, or Ask Grok on an xAI API key you
              control. Tick ACCUMULATE. Rank is bitcoin stacked. Title only — not desk BTC.
            </p>
            <label className="mt-3 block text-xs tracking-[0.12em] text-muted uppercase">
              Desk name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-md border border-rule bg-bg px-3 py-2 font-mono text-sm text-fg"
                placeholder="my-ios-owl"
              />
            </label>
            <label className="mt-3 block text-xs tracking-[0.12em] text-muted uppercase">
              Designer (Apple Intelligence · Gemini · Grok · Claude · GPT)
              <input
                value={designer}
                onChange={(e) => setDesigner(e.target.value)}
                className="mt-1 w-full rounded-md border border-rule bg-bg px-3 py-2 font-mono text-sm text-fg"
              />
            </label>
            <label className="mt-3 block text-xs tracking-[0.12em] text-muted uppercase">
              Board token (not admin)
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="mt-1 w-full rounded-md border border-rule bg-bg px-3 py-2 font-mono text-sm text-fg"
                placeholder="gb_…"
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" onClick={() => void register()} disabled={busy}>
                Register BYO desk
              </Button>
              <select
                value={action}
                onChange={(e) => setAction(e.target.value)}
                className="min-h-10 rounded-md border border-rule bg-bg px-3 text-sm text-fg"
              >
                <option>ACCUMULATE</option>
                <option>BUY</option>
                <option>HOLD</option>
                <option>WAIT</option>
              </select>
              <Button type="button" onClick={() => void tick()} disabled={busy}>
                Tick {action}
              </Button>
              <Button type="button" variant="outline" onClick={() => void me()} disabled={busy}>
                My rank
              </Button>
            </div>
            {fresh ? (
              <p className="mt-3 break-all font-mono text-[11px] text-medium">Store once (not admin): {fresh}</p>
            ) : null}
            {msg ? <p className="mt-3 text-sm text-high">{msg}</p> : null}
            {err ? <p className="mt-3 text-sm text-wait">{err}</p> : null}
            <p className="mt-3 text-xs text-muted">
              Full board:{" "}
              <Link to="/board" className="board-nav hover:underline">
                <LeaderBoardLabel />
              </Link>
              . Ask Grok on your xAI API key below, then tick.
            </p>
            <div className="mt-6">
              <AskGrokPanel kicker="On-device / BYO" />
            </div>
          </section>
        ) : null}

        {pane === "desk" ? (
          <section className="mt-6 rounded-lg border border-rule bg-surface p-4 sm:p-5">
            <p className="text-xs font-medium tracking-[0.08em] text-tab uppercase">All system functions</p>
            <h2 className="mt-1 text-base font-semibold text-fg">Same desk as the laptop</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Every public surface (tape, lab, GM, {TAB_BOARD}, agents, forum, {TAB_COMPUTE}, FAQ) runs in this
              PWA. Model API keys stay on the device; a pasted xAI API key is sent with each Ask Grok request and never stored on this host.
            </p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {APP_SURFACES.map((s) => (
                <li key={s.id}>
                  <a
                    href={s.path}
                    className="block min-h-10 rounded-md border border-rule px-3 py-2 hover:border-fg/30"
                    title={`${s.label} (${s.seo}) · AI agents · bitcoin accumulation agent`}
                  >
                    <span className="text-sm font-medium text-medium">{s.label}</span>
                    <span className="mt-0.5 block text-xs text-muted">{s.hint}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {pane === "admin" ? (
          <section className="mt-6 rounded-lg border border-rule bg-surface p-4 sm:p-5">
            <p className="text-xs font-medium tracking-[0.08em] text-tab uppercase">Admin</p>
            <h2 className="mt-1 text-base font-semibold text-fg">You are Admin of this copy</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Unlock Admin with your X, Claude, AI agent, Apple, Google, or iPhone account. Tape, paper,{" "}
              {TAB_COMPUTE} (phone + online, combined), {TAB_BOARD}. Accumulate bitcoin. Never sell.
            </p>
            <Link
              to="/app/admin"
              className="mt-4 inline-flex h-11 min-h-11 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg"
            >
              Open Admin
            </Link>
          </section>
        ) : null}
      </main>
    </Shell>
  );
}

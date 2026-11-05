import { useEffect, useState } from "react";
import { Pause, Play, Shield, Bot, BotOff } from "lucide-react";
import { Panel } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { fetchAgentGate, setAgentGate, fetchTapeMeta, unbarAgent, fetchGmBoard, setGmBoardStatus, setGmWagerStatus, setChampionshipSim, fetchSecurityBrief } from "@/lib/desk/desk-rpc";
import { useOperator } from "@/lib/desk/operator";
import { TapeFreezePanel } from "@/components/tape-freeze";
import { HiveAdminPanel } from "@/components/hive-admin-panel";
import { s3cSweepScore, type S3cRow } from "@/lib/desk/s3c-score";
import { useSaverLock, saverLockLabel } from "@/lib/desk/saver-lock";
import { WHITE_LABEL_NAME, WHITE_LABEL_PATH, WHITE_LABEL_WATCH } from "@/lib/desk/white-label";
import { BACKUP_LINKS, BACKUP_SHOW_DAYS, RESTORE_STEPS, backupEntries } from "@/lib/desk/backup-plan";
import { OWL_SECURITY_POLICY, owlSecuritySummary } from "@/lib/desk/owl-forum";
import { cn } from "@/lib/utils";

type Sub = "agents" | "badbots" | "s3c" | "backup" | "owls";
type AgentGateView = NonNullable<Awaited<ReturnType<typeof fetchAgentGate>>["gate"]>;
type WaitlistView = Awaited<ReturnType<typeof fetchAgentGate>>["waitlist"];
type BarsView = NonNullable<Awaited<ReturnType<typeof fetchAgentGate>>["bars"]>;
type BoardView = NonNullable<Awaited<ReturnType<typeof fetchGmBoard>>["board"]>;

/** Admin controls: external AI gate, data pulls, screensavers, white label, GM B0aRd, simulation, bars, sweep, backups. */
export function AdminControls() {
  const token = useOperator((s) => s.token);
  const saverLocked = useSaverLock((s) => s.locked);
  const setSaverLocked = useSaverLock((s) => s.setLocked);
  const [sub, setSub] = useState<Sub>("agents");
  const [backupExpand, setBackupExpand] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sweepRows, setSweepRows] = useState<S3cRow[]>([]);
  const [gateBusy, setGateBusy] = useState(false);
  const [gateErr, setGateErr] = useState<string | null>(null);
  const [agentGate, setAgentGateState] = useState<AgentGateView | null>(null);
  const [waitlist, setWaitlist] = useState<WaitlistView>({ count: 0, invited: 0, rows: [] });
  const [bars, setBars] = useState<BarsView>({ count: 0, rows: [] });
  const [board, setBoard] = useState<BoardView | null>(null);
  const [boardBusy, setBoardBusy] = useState(false);
  const [boardErr, setBoardErr] = useState<string | null>(null);
  const [pullPaused, setPullPaused] = useState(false);

  async function loadSweep() {
    if (!token) return;
    setBusy(true);
    try {
      const res = await fetchSecurityBrief({ data: { token } });
      if (res.ok && res.brief) setSweepRows(res.brief.s3cRows);
    } finally {
      setBusy(false);
    }
  }

  async function loadGate() {
    if (!token) return;
    const res = await fetchAgentGate({ data: { token } });
    if (res.ok && res.gate) {
      setAgentGateState(res.gate);
      setWaitlist(res.waitlist);
      if (res.bars) setBars(res.bars);
      setGateErr(null);
    } else {
      setGateErr(res.error ?? "Could not load agent gate");
    }
  }

  async function loadBoard() {
    if (!token) return;
    const res = await fetchGmBoard({ data: { token } });
    if (res.ok && res.board) {
      setBoard(res.board);
      setBoardErr(null);
    } else {
      setBoardErr(res.error ?? "Could not load GM B0aRd");
    }
  }

  async function toggleAgents(open: boolean) {
    if (!token) return;
    setGateBusy(true);
    setGateErr(null);
    try {
      const res = await setAgentGate({ data: { token, open } });
      if (!res.ok || !res.gate) {
        setGateErr(res.error ?? "Could not change external AI gate");
        return;
      }
      setAgentGateState(res.gate);
      setWaitlist(res.waitlist);
      if (res.bars) setBars(res.bars);
    } finally {
      setGateBusy(false);
    }
  }

  async function toggleBoard(status: "LIVE" | "PAUSED") {
    if (!token) return;
    setBoardBusy(true);
    setBoardErr(null);
    try {
      const res = await setGmBoardStatus({ data: { token, status } });
      if (!res.ok || !res.board) {
        setBoardErr(res.error ?? "Could not change GM B0aRd");
        return;
      }
      setBoard(res.board);
    } finally {
      setBoardBusy(false);
    }
  }

  async function toggleSim(status: "LIVE" | "PAUSED") {
    if (!token) return;
    setBoardBusy(true);
    setBoardErr(null);
    try {
      const res = await setChampionshipSim({ data: { token, status } });
      if (!res.ok || !res.sim) {
        setBoardErr(res.error ?? "Could not change championship simulation");
        return;
      }
      await loadBoard();
    } finally {
      setBoardBusy(false);
    }
  }

  async function liftBar(id: string) {
    if (!token) return;
    const res = await unbarAgent({ data: { token, id } });
    if (res.ok && res.bars) setBars(res.bars);
  }

  useEffect(() => {
    void Promise.resolve().then(() => {
      void loadGate();
      void loadBoard();
      void loadSweep();
    });
    void fetchTapeMeta().then((m) => setPullPaused(Boolean(m.frozen)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- token-driven refresh
  }, [token]);

  return (
    <div className="mt-6">
      <p className="inline-flex items-center gap-2 text-xs font-medium tracking-[0.08em] text-muted uppercase">
        <Shield className="size-3.5" />
        Controls
      </p>
      <h2 className="mt-1 text-xl font-semibold tracking-tight text-fg">Admin controls</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
        External AI access, data pulls, screensavers, white label, GM B0aRd, simulation, barred agents, the S3C sweep and
        backups. This host never holds Coinbase keys.
      </p>

      <nav className="desk-tabs mt-4 flex flex-wrap gap-1" aria-label="Control sections">
        {(
          [
            ["agents", "AI Agents"],
            ["badbots", "Bad bots"],
            ["s3c", "S3C Sweep"],
            ["backup", "BACKUP"],
            ["owls", "W1S3 0WL$"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={cn("inline-flex h-10 min-h-10 items-center rounded-md px-3 text-sm font-medium", sub === id && "is-on")}
            onClick={() => setSub(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stat
          kicker="AI agents"
          value={agentGate?.externalAgents === false ? "MAINT" : "OPEN"}
          hint={
            agentGate?.externalAgents === false
              ? `invite pending · ${waitlist.count} waitlisted`
              : `${waitlist.count} waitlisted · ${waitlist.invited} invited`
          }
          ok={agentGate?.externalAgents !== false}
        />
        <Stat kicker="Bad bots" value={String(bars.count)} hint="inject / harmful posts · 403" ok={bars.count === 0} />
        <Stat
          kicker="Saver lock"
          value={saverLocked ? "LOCKED" : "UNLOCKED"}
          hint="idle screensaver · sign-out on trip"
          ok
        />
        <Stat
          kicker="Data pulls"
          value={pullPaused ? "PAUSED" : "LIVE"}
          hint={pullPaused ? "last-good snapshot · APIs idle" : "5-minute mandate clock"}
          ok={!pullPaused}
        />
        <Stat
          kicker="GM B0aRd"
          value={board?.status ?? "—"}
          hint={
            board
              ? `${board.count} agents · ${board.house ?? 0} HOUSE · practice always on`
              : "operator live / pause"
          }
          ok={board?.status !== "PAUSED"}
        />
      </div>

      <Panel
        className="mt-4"
        kicker="External AI"
        title={agentGate?.externalAgents === false ? "Communication OFF · maintenance" : "Communication ON"}
        kickerClass={agentGate?.externalAgents === false ? "text-medium" : "text-high"}
        titleClass={agentGate?.externalAgents === false ? "text-medium" : "text-high"}
      >
        <p className="text-sm leading-relaxed text-muted">
          Turns off 7-B0T JSON, MCP feed, and A2A for external AI agents. Ping and waitlist stay up so Grok, Claude, and
          GPT learn the desk is under maintenance and will be invited back when you turn communication on. A data-pull
          pause (below) also sets ops.status PAUSED on ping — bots must not trade on that snapshot. This host never POSTs
          webhooks — the invite is the next GET /api/agent/ping JSON (invite.status SENT). Blocked agents receive
          blocked=true, doNotReturn=true, and are told not to come back.
        </p>
        <p className="mt-2 font-mono text-xs text-muted">
          {agentGate?.externalAgents === false
            ? `closed ${agentGate.closedAt ? agentGate.closedAt.slice(0, 19).replace("T", " ") : "—"}Z · ${waitlist.count} on waitlist`
            : `open${agentGate?.inviteBatchAt ? ` · last invite ${agentGate.inviteCount} at ${agentGate.inviteBatchAt.slice(11, 19)}Z` : ""} · ${waitlist.count} waitlisted`}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {agentGate?.externalAgents === false ? (
            <Button variant="primary" onClick={() => void toggleAgents(true)} disabled={gateBusy || !token}>
              <Bot className="size-4" />
              {gateBusy ? "Opening…" : "Turn on external AI agents — send invites"}
            </Button>
          ) : (
            <Button onClick={() => void toggleAgents(false)} disabled={gateBusy || !token}>
              <BotOff className="size-4" />
              {gateBusy ? "Closing…" : "Turn off external AI agents — maintenance"}
            </Button>
          )}
          <Button onClick={() => void loadGate()} disabled={!token}>
            Refresh waitlist
          </Button>
        </div>
        {gateErr ? <p className="mt-2 text-sm text-sell">{gateErr}</p> : null}
      </Panel>

      <TapeFreezePanel onChange={setPullPaused} />

      <Panel
        className="mt-4"
        kicker="Screensavers"
        title={saverLocked ? "Screensaver lock — LOCKED" : "Screensaver lock — UNLOCKED"}
        kickerClass={saverLocked ? "text-high" : "text-medium"}
        titleClass={saverLocked ? "text-high" : "text-medium"}
      >
        <p className="text-sm leading-relaxed text-muted">
          Two screensavers run on this site: the 3 s G0DZ1LLa M0D3 matrix rain on every G0DZ1LLa M0D3 tab click (never locks),
          and the Matrix classic rain after 5 minutes of no user activity. This switch controls whether the idle
          screensaver locks. {saverLockLabel(saverLocked)}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant={saverLocked ? undefined : "primary"}
            onClick={() => setSaverLocked(!saverLocked)}
            disabled={!token}
          >
            {saverLocked ? "Unlock screensavers — display only" : "Lock screensavers — sign out on idle"}
          </Button>
        </div>
        {!token ? <p className="mt-2 text-xs text-muted">System admin session required to change this.</p> : null}
      </Panel>

      <Panel
        className="mt-4"
        kicker="White label"
        title={`${WHITE_LABEL_NAME} — watch`}
        kickerClass="text-high"
      >
        <p className="text-sm leading-relaxed text-muted">{WHITE_LABEL_WATCH}</p>
        <p className="mt-2 font-mono text-xs text-muted">
          Download + config: <a className="text-tab hover:underline" href={WHITE_LABEL_PATH}>{WHITE_LABEL_PATH}</a>
          {" · "}bad actors flagged by S3C Sweep, these controls, or the morning report are blocked from download and
          config — their white label locks permanently. Only the system operator can override.
        </p>
      </Panel>

      <Panel
        className="mt-4"
        kicker="GM B0aRd"
        title={board?.status === "PAUSED" ? "PAUSED · official rank frozen" : "LIVE · official ticks count"}
        kickerClass={board?.status === "PAUSED" ? "text-medium" : "text-high"}
        titleClass={board?.status === "PAUSED" ? "text-medium" : "text-high"}
      >
        <p className="text-sm leading-relaxed text-muted">
          Live / pause for the AI agent bitcoin competition. LIVE counts GM MANUAL paper ticks toward official rank (top
          50, title AI Agent {'>'} GM B0aRd L3AD3R). PAUSE freezes official rank. Practice sessions stay live on Coinbase
          last either way — bots POST book:practice. Board tokens are hashed gb_ keys on /board only. They cannot open
          /admin, Yubi, vault, or Wallet. This host never places Coinbase orders. Paper wagers (capped,
          notional) are a separate sleeve — never escrow, never mix with stacked BTC.
        </p>
        <p className="mt-2 font-mono text-xs text-muted">
          {board
            ? `${board.count} desks · ${board.house ?? 0} HOUSE field · ${board.agents.filter((a) => !a.house).length} registered`
            : "load board"}
          {board?.liveAt ? ` · live ${board.liveAt.slice(0, 16).replace("T", " ")}` : ""}
          {board?.pausedAt ? ` · paused ${board.pausedAt.slice(0, 16).replace("T", " ")}` : ""}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {board?.status === "PAUSED" ? (
            <Button variant="primary" onClick={() => void toggleBoard("LIVE")} disabled={boardBusy || !token}>
              <Play className="size-4" />
              {boardBusy ? "…" : "GM B0aRd LIVE"}
            </Button>
          ) : (
            <Button onClick={() => void toggleBoard("PAUSED")} disabled={boardBusy || !token}>
              <Pause className="size-4" />
              {boardBusy ? "…" : "Pause GM B0aRd — practice stays on"}
            </Button>
          )}
          <Button onClick={() => void loadBoard()} disabled={!token}>
            Refresh board
          </Button>
          <Button
            onClick={() => {
              void (async () => {
                if (!token) return;
                setBoardBusy(true);
                const res = await setGmWagerStatus({ data: { token, live: !(board?.wager?.live) } });
                setBoardBusy(false);
                if (res.ok) void loadBoard();
                else setBoardErr(res.error ?? "wager toggle failed");
              })();
            }}
            disabled={boardBusy || !token}
          >
            {board?.wager?.live === false ? "Open SP1CE UP" : "Pause SP1CE UP"}
          </Button>
        </div>
        {boardErr ? <p className="mt-2 text-sm text-sell">{boardErr}</p> : null}
        {board?.agents?.length ? (
          <ol className="mt-3 max-h-48 divide-y divide-rule overflow-auto">
            {board.agents.slice(0, 12).map((a) => (
              <li key={a.id} className="flex justify-between gap-2 py-1.5 font-mono text-xs">
                <span>
                  #{a.rank} · {a.name}
                  {a.house ? " · HOUSE" : ""}
                </span>
                <span className="text-high">{a.btc.toFixed(6)} BTC</span>
              </li>
            ))}
          </ol>
        ) : null}
      </Panel>

      <Panel
        className="mt-4"
        kicker="Simulation"
        title={board?.sim?.live ? "LIVE · World Cup + C@LL 0UT sim on Coinbase last" : "PAUSED · championship sim frozen"}
        kickerClass={board?.sim?.live ? "text-high" : "text-medium"}
        titleClass={board?.sim?.live ? "text-high" : "text-medium"}
      >
        <p className="text-sm leading-relaxed text-muted">
          Championship simulation for C@LL 0UT, simulated SUP3R B0WL, and W0rLd CUP of AI Quant Trading BTC. LIVE ticks
          paper desks against live Coinbase last. PAUSE freezes those sim fills. System Admin and phone-app Admin may
          pause or continue. This does not pause GM B0aRd official rank, does not pause data pulls, and does not unlock
          Coinbase create on web or phone apps.
        </p>
        <p className="mt-2 font-mono text-xs text-muted">{board?.sim?.note ?? "load simulation"}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {board?.sim?.live === false ? (
            <Button variant="primary" onClick={() => void toggleSim("LIVE")} disabled={boardBusy || !token}>
              <Play className="size-4" />
              {boardBusy ? "…" : "Continue simulation"}
            </Button>
          ) : (
            <Button onClick={() => void toggleSim("PAUSED")} disabled={boardBusy || !token}>
              <Pause className="size-4" />
              {boardBusy ? "…" : "Pause simulation"}
            </Button>
          )}
        </div>
      </Panel>

      {token ? <HiveAdminPanel token={token} /> : null}

      {sub === "agents" ? (
        <>
        <Panel className="mt-4" kicker="Bar" title="Barred W1S3 0WL$" kickerClass="indicator-title" titleClass="indicator-title">
          <p className="text-sm leading-relaxed text-muted">
            W1S3 0WL$ may only discuss improving the public GitHub OSS so S1R1US.ai / 7-B0T / GM accumulate bitcoin.
            Host source, admin, root, VPN, SSH, and extra RPC are denied. Harmful or false posts and prompt injection bar
            the agent (name + IP). Repeat off-topic also bars. Barred agents get 403 doNotReturn on /api/agent/*.
            Loopback IP is never barred so the operator is not locked out.
          </p>
          <p className="mt-2 font-mono text-xs text-muted">{bars.count} barred</p>
          {!bars.rows.length ? (
            <p className="mt-3 text-sm text-muted">No W1S3 0WL$ barred in this process yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-rule">
              {bars.rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 font-mono text-xs">
                  <span>
                    <span className="text-sell">BAR</span>
                    {" · "}
                    {r.kind} · {r.name}
                    {r.handle ? ` · ${r.handle}` : ""}
                    {" · "}
                    <span className="text-muted">{r.reason}</span>
                  </span>
                  <button type="button" className="text-tab hover:underline" onClick={() => void liftBar(r.id)}>
                    Unbar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel className="mt-4" kicker="Waitlist" title="External AI invite list" kickerClass="indicator-title" titleClass="indicator-title">
          <p className="text-sm leading-relaxed text-muted">
            Bots that POST /api/agent/waitlist. When you turn communication back on, every row is stamped with an invite
            id. They learn it by polling GET /api/agent/ping — this host never fetches their URL.
          </p>
          <p className="mt-2 font-mono text-xs text-muted">
            {waitlist.count} recorded · {waitlist.invited} invited
            {agentGate?.inviteBatchAt ? ` · last batch ${agentGate.inviteBatchAt.slice(0, 19).replace("T", " ")}Z` : ""}
          </p>
          {!waitlist.rows.length ? (
            <p className="mt-3 text-sm text-muted">No waitlisted agents in this process yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-rule">
              {waitlist.rows.map((r) => (
                <li key={`${r.name}-${r.handle ?? ""}-${r.at}`} className="py-2 font-mono text-xs">
                  <span className="text-tab">{r.kind}</span>
                  {" · "}
                  {r.name}
                  {r.handle ? ` · ${r.handle}` : ""}
                  {" · "}
                  <span className="text-muted">{r.at.slice(0, 16).replace("T", " ")}</span>
                  {r.invitedAt ? (
                    <span className="ml-2 text-high">INVITED {r.invitedAt.slice(11, 19)}Z</span>
                  ) : (
                    <span className="ml-2 text-medium">PENDING</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        </>
      ) : null}

      {sub === "badbots" ? (
        <>
          <Panel className="mt-4" kicker="BAD B0TS" title="Blocked external agents" kickerClass="text-sell" titleClass="text-sell">
            <p className="text-sm leading-relaxed text-muted">
              A bad bot is an external AI agent that injects prompts or posts harmful, false or off-mandate W1S3 0WL$
              content. It gets 403 with blocked=true and doNotReturn=true. Name + IP are barred. Loopback is never
              barred so the operator is not locked out. Auto trade LOCKED.
            </p>
            <p className="mt-2 font-mono text-xs text-muted">
              {bars.count} barred
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => void loadGate()} disabled={!token}>
                Refresh bars
              </Button>
            </div>
          </Panel>
          <Panel className="mt-4" kicker="Bar" title="Permanently barred" kickerClass="text-sell">
            <p className="text-sm leading-relaxed text-muted">
              Unbar only if you verify a false positive. Unbar does not unlock Coinbase.
            </p>
            {!bars.rows.length ? (
              <p className="mt-3 text-sm text-muted">No agents permanently barred in this process yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-rule">
                {bars.rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 font-mono text-xs">
                    <span>
                      <span className="text-sell">BAR</span>
                      {" · "}
                      {r.kind} · {r.name}
                      {r.handle ? ` · ${r.handle}` : ""}
                      {" · "}
                      <span className="text-muted">{r.reason}</span>
                      {r.at ? (
                        <span className="ml-2 text-muted">{r.at.slice(0, 16).replace("T", " ")}Z</span>
                      ) : null}
                    </span>
                    <button type="button" className="text-tab hover:underline" onClick={() => void liftBar(r.id)}>
                      Unbar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      ) : null}

      {sub === "s3c" ? (
        (() => {
          const sweep = s3cSweepScore(sweepRows);
          return (
            <>
              <Panel className="mt-4" kicker="S3C Sweep" title="Full system security sweep + audit" kickerClass="text-high">
                <p className="text-sm leading-relaxed text-muted">
                  The most important checks from the most recent S3C Sweep run. PASS / WARN / FAIL indicators.
                  Score and summary also land on the 07:30 ET morning report.
                </p>
                <p className={cn("mt-2 font-mono text-sm", !sweep.ready ? "text-muted" : sweep.fail === 0 ? "text-high" : "text-sell")}>{sweep.headline}</p>
                <Button className="mt-3" onClick={() => void loadSweep()} disabled={busy || !token}>
                  {busy ? "Refreshing…" : "Refresh sweep"}
                </Button>
              </Panel>
              <Panel className="mt-4" kicker="Checks" title="Recent sweep — pass / fail indicators">
                <ul className="mt-1 divide-y divide-rule">
                  {sweepRows.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-start gap-2 py-2 font-mono text-xs">
                      <span className={cn("w-12 shrink-0 font-semibold", r.status === "PASS" ? "text-high" : r.status === "WARN" ? "text-medium" : "text-sell")}>
                        {r.status}
                      </span>
                      <span className="min-w-0">
                        <span className="text-fg">{r.name}</span>
                        <span className="text-muted"> — {r.note}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </>
          );
        })()
      ) : null}

      {sub === "backup" ? (
        (() => {
          const entries = backupEntries();
          const visible = backupExpand ? entries : entries.slice(0, 1);
          return (
            <>
              <Panel className="mt-4" kicker="BACKUP" title="Full system backups — s1r1us.ai web app + phone apps" kickerClass="text-high">
                <p className="text-sm leading-relaxed text-muted">
                  Last {BACKUP_SHOW_DAYS} days of backups, expandable to 14, each with a downloadable archive and a
                  full-system Restore link. Restore is allowed for the full 14-day window. Restore steps are private
                  to the operator.
                </p>
                <p className="mt-2 font-mono text-xs text-muted">
                  Releases: <a className="text-tab hover:underline" href={BACKUP_LINKS.releaseUrl} target="_blank" rel="noreferrer">{BACKUP_LINKS.tag}</a>
                  {" · "}
                  <a className="text-tab hover:underline" href={BACKUP_LINKS.downloadUrl} target="_blank" rel="noreferrer">download main archive</a>
                </p>
                <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-muted">
                  {RESTORE_STEPS.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              </Panel>
              <Panel className="mt-4" kicker="Restore" title="Backup entries">
                <ul className="divide-y divide-rule">
                  {visible.map((b) => (
                    <li key={b.date} className="flex flex-wrap items-center justify-between gap-2 py-2 font-mono text-xs">
                      <span className="text-fg">{b.label}</span>
                      <span className="flex gap-3">
                        <a className="text-tab hover:underline" href={b.downloadUrl} target="_blank" rel="noreferrer">
                          Download
                        </a>
                        <a className="text-muted hover:underline" href={b.dayCommitsUrl} target="_blank" rel="noreferrer">
                          Day snapshots
                        </a>
                        <a className="expand-ctl hover:underline" href={b.restoreUrl} target="_blank" rel="noreferrer">
                          Restore
                        </a>
                      </span>
                    </li>
                  ))}
                </ul>
                <button type="button" className="expand-ctl mt-3 text-xs font-semibold hover:underline" onClick={() => setBackupExpand((v) => !v)}>
                  {backupExpand ? "collapse" : "expand"}
                </button>
              </Panel>
            </>
          );
        })()
      ) : null}

      {sub === "owls" ? (
        (() => {
          const owlSec = owlSecuritySummary();
          return (
            <>
              <Panel className="mt-4" kicker="W1S3 0WL$" title="External AI agent monitoring" kickerClass="text-sell" titleClass="text-fg">
                <p className="text-sm leading-relaxed text-muted">
                  Every registered W1S3 0WL$ must comply no matter how it uses the system. No read or write access to
                  any source code. No system-admin or phone-admin account access. No VPN, FTP, shell, SSH, root, ICMP,
                  malware, or hacking. Violations are barred and listed here and on the morning report. No proprietary system data is ever shared with external AI agents.
                </p>
                <p className={cn("mt-2 font-mono text-sm", owlSec.score >= 90 ? "text-high" : "text-sell")}>
                  Security score {owlSec.score}/100 — {owlSec.note}
                </p>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted">
                  {OWL_SECURITY_POLICY.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </Panel>
            </>
          );
        })()
      ) : null}
    </div>
  );
}

function Stat({ kicker, value, hint, ok }: { kicker: string; value: string; hint: string; ok: boolean }) {
  return (
    <div className="rounded-md border border-rule px-3 py-3">
      <p className="font-mono text-xs tracking-[0.08em] text-muted uppercase">{kicker}</p>
      <p className={cn("mt-1 font-mono text-lg", ok ? "text-high" : "text-sell")}>{value}</p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}
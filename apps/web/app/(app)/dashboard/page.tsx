"use client";

import { useCallback, useEffect, useState } from "react";
import { api, Unauthorized, type Me, type PublicConfig, type Repo, type ReviewRow } from "./api";

type State =
  | { kind: "loading" }
  | { kind: "signed-out"; config: PublicConfig | null }
  | { kind: "error"; message: string }
  | { kind: "ready"; me: Me; config: PublicConfig | null };

const fmtMs = (ms: number | null) => (ms == null ? "—" : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
const ago = (iso: string) => {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

export default function Dashboard() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState<number | "portal" | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    const config = await api.config().catch(() => null);
    try {
      setState({ kind: "ready", me: await api.me(), config });
    } catch (e) {
      if (e instanceof Unauthorized) setState({ kind: "signed-out", config });
      else setState({ kind: "error", message: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    void load();
    const upgraded = new URLSearchParams(window.location.search).get("upgraded");
    if (upgraded) setFlash("Payment received. Pro turns on for that repository as soon as Polar confirms it.");
  }, [load]);

  // Reviews move through queued → running → completed in the background; poll while any are in flight.
  useEffect(() => {
    if (state.kind !== "ready") return;
    const inFlight = state.me.reviews.some((r) => r.status === "queued" || r.status === "running");
    if (!inFlight) return;
    const t = setTimeout(() => void load(), 4000);
    return () => clearTimeout(t);
  }, [state, load]);

  async function toggle(repo: Repo) {
    setBusy(repo.id);
    try {
      await api.setEnabled(repo.id, !repo.enabled);
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function upgrade(repo: Repo) {
    setBusy(repo.id);
    try {
      window.location.href = (await api.checkout(repo.id)).url;
    } catch (e) {
      setFlash((e as Error).message);
      setBusy(null);
    }
  }

  async function portal() {
    setBusy("portal");
    try {
      window.location.href = (await api.portal()).url;
    } catch (e) {
      setFlash((e as Error).message);
      setBusy(null);
    }
  }

  async function logout() {
    await api.logout().catch(() => undefined);
    setState({ kind: "signed-out", config: state.kind === "ready" ? state.config : null });
  }

  return (
    <div className="dash">
      <header className="dash__bar">
        <div className="wrap">
          <a className="nav__logo" href="/"><span className="mark" data-mark="stack" aria-hidden="true" />DiffPanda</a>
          <span className="spacer" />
          {state.kind === "ready" && (
            <>
              <span className="dash__user">
                {state.me.user.avatarUrl && <img src={state.me.user.avatarUrl} alt="" />}
                {state.me.user.login}
              </span>
              <button className="btn btn--secondary btn--sm" type="button" onClick={logout}>Sign out</button>
            </>
          )}
        </div>
      </header>

      <main className="wrap dash__body">
        {state.kind === "loading" && <p className="muted">Loading your repositories…</p>}

        {state.kind === "error" && (
          <div className="empty">
            <h1>Can't reach the DiffPanda API</h1>
            <p className="muted">{state.message}. Check that the API is running and that NEXT_PUBLIC_API_URL points at it.</p>
            <button className="btn btn--secondary" type="button" onClick={() => void load()}>Try again</button>
          </div>
        )}

        {state.kind === "signed-out" && (
          <div className="empty">
            <h1>Sign in to DiffPanda</h1>
            <p className="muted">Sign in with GitHub to see your repositories, review history and billing.</p>
            {state.config ? (
              <a className="btn btn--primary" href={state.config.loginUrl}>Sign in with GitHub</a>
            ) : (
              <p className="muted">The API is not reachable, so sign-in is unavailable.</p>
            )}
          </div>
        )}

        {state.kind === "ready" && (
          <Ready me={state.me} config={state.config} busy={busy} flash={flash} onToggle={toggle} onUpgrade={upgrade} onPortal={portal} />
        )}
      </main>
    </div>
  );
}

function Ready(props: {
  me: Me;
  config: PublicConfig | null;
  busy: number | "portal" | null;
  flash: string | null;
  onToggle(r: Repo): void;
  onUpgrade(r: Repo): void;
  onPortal(): void;
}) {
  const { me, config, busy } = props;
  const hasPro = me.repositories.some((r) => r.effectivePlan === "pro");

  return (
    <>
      <div>
        <h1>Hi, {me.user.name ?? me.user.login}</h1>
        <p className="muted">{me.installations.map((i) => i.accountLogin).join(", ") || "No installations yet"}</p>
      </div>

      {props.flash && <p className="notice" role="status">{props.flash}</p>}

      {me.installations.length === 0 ? (
        <div className="empty">
          <h2>Install the GitHub App</h2>
          <p className="muted">DiffPanda only sees the repositories you pick during the install.</p>
          {config?.installUrl ? (
            <a className="btn btn--primary" href={config.installUrl}>Install on GitHub</a>
          ) : (
            <p className="muted">Set GITHUB_APP_SLUG on the API to show the install link.</p>
          )}
        </div>
      ) : (
        <>
          <div aria-label="Last 30 days" className="dash-stats">
            <div className="dash-stat"><b>{me.stats.total}</b><span>reviews posted, 30 days</span></div>
            <div className="dash-stat"><b>{me.stats.comments}</b><span>line comments</span></div>
            <div className="dash-stat"><b>{fmtMs(me.stats.p50)}</b><span>median review time</span></div>
            <div className="dash-stat"><b>{fmtMs(me.stats.p95)}</b><span>p95 review time</span></div>
            <div className="dash-stat"><b>{me.stats.failed}</b><span>failed reviews</span></div>
          </div>

          <div className="dash-block">
            <h2>Repositories</h2>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr><th>Repository</th><th>Plan</th><th>Reviews</th><th /></tr>
                </thead>
                <tbody>
                  {me.repositories.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <code>{r.fullName}</code> {r.private && <span className="pill">private</span>}
                      </td>
                      <td>
                        <span className={`pill ${r.effectivePlan === "pro" ? "pill--pro" : ""}`}>{r.effectivePlan === "pro" ? "Pro" : "Free"}</span>
                        {r.private && r.effectivePlan === "free" && <span className="muted"> · needs Pro</span>}
                      </td>
                      <td>
                        <button
                          className="switch"
                          type="button"
                          role="switch"
                          aria-checked={r.enabled}
                          aria-label={`Reviews for ${r.fullName}`}
                          disabled={busy === r.id}
                          onClick={() => props.onToggle(r)}
                        />
                      </td>
                      <td>
                        <div className="row-actions">
                          {r.effectivePlan === "free" && config?.billingEnabled && (
                            <button className="btn btn--secondary btn--sm" type="button" disabled={busy === r.id} onClick={() => props.onUpgrade(r)}>
                              Upgrade to Pro
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {hasPro && (
              <p style={{ marginTop: 16 }}>
                <button className="btn btn--secondary btn--sm" type="button" disabled={busy === "portal"} onClick={props.onPortal}>
                  Manage billing
                </button>
              </p>
            )}
          </div>

          <div className="dash-block">
            <h2>Recent reviews</h2>
            {me.reviews.length === 0 ? (
              <p className="muted">No reviews yet. Open a pull request on an enabled repository.</p>
            ) : (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr><th>Pull request</th><th>Status</th><th>Comments</th><th>Files</th><th>Time</th><th>When</th></tr>
                  </thead>
                  <tbody>
                    {me.reviews.map((r: ReviewRow) => (
                      <tr key={r.id}>
                        <td>
                          <a className="link" href={`https://github.com/${r.repository}/pull/${r.prNumber}`}>{r.repository}#{r.prNumber}</a>{" "}
                          <code className="muted">{r.headSha.slice(0, 7)}</code>
                        </td>
                        <td title={r.skipReason ?? r.error ?? undefined}>
                          <span className="pill" data-status={r.status}>{r.status}</span>
                          {(r.skipReason || r.error) && <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{r.skipReason ?? r.error}</div>}
                        </td>
                        <td>{r.commentsPosted}</td>
                        <td>{r.filesReviewed}</td>
                        <td>{fmtMs(r.durationMs)}</td>
                        <td className="muted">{ago(r.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

import { useEffect, useState } from "react";
import type { SharedSnapshot } from "./shareApi";
import { resolveShare } from "./shareApi";
import { downloadCalendarFile } from "./calendarExport";
import { PlanBoard } from "./PlanBoard";
import { planDates } from "./planDate";

export function SharedApp({ token }: { token: string }) {
  const [snapshot, setSnapshot] = useState<SharedSnapshot | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [downloadError, setDownloadError] = useState("");
  const invalidToken = !/^[A-Za-z0-9_-]{32}$/.test(token);
  const snapshotDates = snapshot ? planDates(snapshot.plan, snapshot.date) : [];
  const dateSummary = snapshotDates.length > 1 ? `${snapshotDates[0]}–${snapshotDates.at(-1)}` : snapshotDates[0];

  useEffect(() => {
    if (invalidToken) return;
    let active = true;
    const controller = new AbortController();
    void resolveShare(token, controller.signal)
      .then((result) => { if (active) setSnapshot(result); })
      .catch((failure: unknown) => {
        if (active) setError(failure instanceof Error ? failure.message : "This view link is unavailable.");
      });
    return () => { active = false; controller.abort(); };
  }, [token, invalidToken, attempt]);

  return (
    <div className="app-shell app-shell--shared">
      <a className="skip-link" href="#main-content">Skip to shared plan</a>
      <header className="site-header">
        <a aria-label="Home Huddle home" className="brand" href={import.meta.env.BASE_URL}>
          <img alt="" aria-hidden="true" className="brand-mark" height="31" src={`${import.meta.env.BASE_URL}favicon.svg`} width="31" />
          <strong>Home Huddle</strong>
        </a>
      </header>
      <main className="shared-page" id="main-content">
        <span className="section-kicker">Shared snapshot</span>
        <h1>A plan to follow together.</h1>
        {!snapshot && !error && !invalidToken && <p role="status">Loading shared plan…</p>}
        {(error || invalidToken) && <p className="shared-page__error" role="alert">{invalidToken ? "This view link is invalid." : error}</p>}
        {error && !invalidToken && <button className="shared-page__retry" onClick={() => { setError(""); setSnapshot(null); setAttempt((value) => value + 1); }} type="button">Retry loading</button>}
        {snapshot && (
          <>
            <p className="shared-page__details">
              {dateSummary} · {snapshot.timeZone} · Read only · Expires {new Date(snapshot.expiresAt).toLocaleDateString()}
            </p>
            <PlanBoard date={snapshot.date} plan={snapshot.plan} timeZone={snapshot.timeZone} readOnly />
            <button
              className="shared-page__download"
              onClick={() => {
                try { downloadCalendarFile(snapshot.plan, snapshot.date, snapshot.timeZone); setDownloadError(""); }
                catch (failure) { setDownloadError(failure instanceof Error ? failure.message : "Calendar download failed."); }
              }}
              type="button"
            >
              Download calendar file
            </button>
            {downloadError && <p role="alert">{downloadError}</p>}
          </>
        )}
        <a className="shared-page__start" href={import.meta.env.BASE_URL}>Start your own plan</a>
        <p className="shared-page__note">Home Huddle is a fictional-data demo. Review generated plans before using them.</p>
      </main>
    </div>
  );
}

import { useEffect, useState } from "react";
import type { SharedSnapshot } from "./shareApi";
import { resolveShare } from "./shareApi";
import { downloadCalendarFile } from "./calendarExport";
import { PlanBoard } from "./PlanBoard";

export function SharedApp({ token }: { token: string }) {
  const [snapshot, setSnapshot] = useState<SharedSnapshot | null>(null);
  const [error, setError] = useState("");
  const [downloadError, setDownloadError] = useState("");

  useEffect(() => {
    let active = true;
    void resolveShare(token)
      .then((result) => { if (active) setSnapshot(result); })
      .catch((failure: unknown) => {
        if (active) setError(failure instanceof Error ? failure.message : "This view link is unavailable.");
      });
    return () => { active = false; };
  }, [token]);

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
        {!snapshot && !error && <p role="status">Loading shared plan…</p>}
        {error && <p className="shared-page__error" role="alert">{error}</p>}
        {snapshot && (
          <>
            <p className="shared-page__details">
              {snapshot.date} · {snapshot.timeZone} · Read only · Expires {new Date(snapshot.expiresAt).toLocaleDateString()}
            </p>
            <PlanBoard date={snapshot.date} plan={snapshot.plan} readOnly />
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

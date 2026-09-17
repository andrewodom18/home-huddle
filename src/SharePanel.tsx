import { useState } from "react";
import { IANAZone } from "luxon";
import type { HouseholdPlan } from "../shared/contracts";
import { downloadCalendarFile } from "./calendarExport";
import { createShare, shareUrl } from "./shareApi";

type SharePanelProps = {
  plan: HouseholdPlan;
  date: string;
  timeZone: string;
  onDateChange: (date: string) => void;
  onTimeZoneChange: (timeZone: string) => void;
};

export function SharePanel({
  plan,
  date,
  timeZone,
  onDateChange,
  onTimeZoneChange,
}: SharePanelProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [message, setMessage] = useState("");

  function validDetails(): boolean {
    if (!confirmed) {
      setMessage("Confirm the date and time zone first.");
      return false;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !IANAZone.isValidZone(timeZone)) {
      setMessage("Choose a valid date and time zone.");
      return false;
    }
    return true;
  }

  function download() {
    if (!validDetails()) return;
    try {
      downloadCalendarFile(plan, date, timeZone);
      setMessage("Calendar file downloaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Calendar export failed.");
    }
  }

  async function makeLink() {
    if (!validDetails()) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await createShare(plan, date, timeZone);
      const url = shareUrl(result.token);
      setLink(url);
      setExpiresAt(result.expiresAt);
      try {
        await navigator.clipboard.writeText(url);
        setMessage("View link copied. Anyone with it can read this snapshot until it expires.");
      } catch {
        setMessage("View link ready. Copy it from the field below.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sharing is unavailable right now.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="share-panel">
      <summary>Share or export this plan</summary>
      <div className="share-panel__body">
        <p>Choose the day for these activities. Use fictional details only.</p>
        <div className="share-panel__fields">
          <label>
            Date
            <input
              onChange={(event) => { onDateChange(event.target.value); setConfirmed(false); setLink(""); }}
              type="date"
              value={date}
            />
          </label>
          <label>
            Time zone
            <input
              onChange={(event) => { onTimeZoneChange(event.target.value); setConfirmed(false); setLink(""); }}
              spellCheck={false}
              title="Use an IANA time zone such as America/Chicago"
              type="text"
              value={timeZone}
            />
          </label>
        </div>
        <label className="share-panel__confirm">
          <input checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />
          I confirm this date and time zone are correct.
        </label>
        <p className="share-panel__warning">
          Anyone with a view link can see this plan until it expires in seven days. Links show a read-only snapshot, not the conversation.
        </p>
        <div className="share-panel__actions">
          <button disabled={busy} onClick={download} title="Download a calendar file for the selected date and time zone" type="button">Download .ics</button>
          <button disabled={busy} onClick={() => void makeLink()} title="Create a read-only view link that expires in seven days" type="button">
            {busy ? "Creating link…" : "Copy view link"}
          </button>
        </div>
        {message && <p className="share-panel__message" role="status">{message}</p>}
        {link && (
          <label className="share-panel__link">
            View link (expires {new Date(expiresAt).toLocaleDateString()})
            <input aria-label="View link" onFocus={(event) => event.target.select()} readOnly value={link} />
          </label>
        )}
      </div>
    </details>
  );
}

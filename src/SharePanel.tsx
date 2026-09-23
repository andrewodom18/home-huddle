import { useEffect, useId, useRef, useState } from "react";
import { IANAZone } from "luxon";
import type { HouseholdPlan } from "../shared/contracts";
import { downloadCalendarFile } from "./calendarExport";
import { createShare, shareUrl } from "./shareApi";
import { formatPlanDate, isValidPlanDate, planDates, todayInZone } from "./planDate";

type SharePanelProps = {
  plan: HouseholdPlan;
  date: string;
  timeZone: string;
  dateError?: string;
  onDateChange: (date: string) => void;
  onTimeZoneChange: (timeZone: string) => void;
  dateChangeDisabled?: boolean;
};

export function SharePanel({
  plan,
  date,
  timeZone,
  dateError,
  onDateChange,
  onTimeZoneChange,
  dateChangeDisabled = false,
}: SharePanelProps) {
  const [zoneDraft, setZoneDraft] = useState(timeZone);
  const zoneErrorId = useId();
  const zoneValid = IANAZone.isValidZone(zoneDraft.trim());
  const zoneDirty = zoneDraft.trim() !== timeZone;
  const abortRef = useRef<AbortController | null>(null);
  const activeRequest = useRef(0);
  const detailsKey = JSON.stringify([date, timeZone, plan.version, plan.updatedAt]);
  const [confirmedDetails, setConfirmedDetails] = useState("");
  const [busyDetails, setBusyDetails] = useState("");
  const busy = busyDetails === detailsKey;
  const [link, setLink] = useState("");
  const [linkDetails, setLinkDetails] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [message, setMessage] = useState("");
  const [messageDetails, setMessageDetails] = useState("");
  const confirmed = confirmedDetails === detailsKey;
  const dates = planDates(plan, date);
  const multiDay = dates.length > 1;

  useEffect(() => () => { activeRequest.current += 1; abortRef.current?.abort(); }, []);
  useEffect(() => { activeRequest.current += 1; abortRef.current?.abort(); }, [detailsKey]);

  function commitZone() {
    if (zoneValid && zoneDirty) onTimeZoneChange(zoneDraft.trim());
  }

  function showMessage(text: string) {
    setMessageDetails(detailsKey);
    setMessage(text);
  }

  function validDetails(): boolean {
    if (!zoneValid || zoneDirty) { showMessage("Choose a valid time zone and leave the field to confirm it first."); return false; }
    if (!confirmed) {
      showMessage(multiDay ? "Confirm the event dates and time zone first." : "Confirm the date and time zone first.");
      return false;
    }
    if (!isValidPlanDate(date) || !IANAZone.isValidZone(timeZone)) {
      showMessage("Choose a valid date and time zone.");
      return false;
    }
    return true;
  }

  function download() {
    if (!validDetails()) return;
    try {
      downloadCalendarFile(plan, date, timeZone);
      showMessage("Calendar file downloaded.");
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "Calendar export failed.");
    }
  }

  async function makeLink() {
    if (!validDetails()) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++activeRequest.current;
    setBusyDetails(detailsKey);
    showMessage("");
    try {
      const result = await createShare(plan, date, timeZone, controller.signal);
      if (requestId !== activeRequest.current) return;
      const url = shareUrl(result.token);
      setLink(url);
      setLinkDetails(detailsKey);
      setExpiresAt(result.expiresAt);
      try {
        await navigator.clipboard.writeText(url);
        if (requestId !== activeRequest.current) return;
        showMessage("View link copied. Anyone with it can read this snapshot until it expires.");
      } catch {
        if (requestId !== activeRequest.current) return;
        showMessage("View link ready. Copy it from the field below.");
      }
    } catch (error) {
      if (requestId !== activeRequest.current || controller.signal.aborted) return;
      showMessage(error instanceof Error ? error.message : "Sharing is unavailable right now.");
    } finally {
      if (requestId === activeRequest.current) setBusyDetails("");
    }
  }

  return (
    <details className="share-panel">
      <summary>Share or export this plan</summary>
      <div className="share-panel__body">
        <p>{multiDay ? `${dates.length} days, from ${formatPlanDate(dates[0])} to ${formatPlanDate(dates.at(-1)!)}. Use fictional details only.` : "Confirm the day for these activities. Use fictional details only."}</p>
        <div className="share-panel__fields">
          {!multiDay && <label>
              Date
              <input
                disabled={busy || dateChangeDisabled}
                min={todayInZone(timeZone)}
                onChange={(event) => { const nextDate = event.currentTarget.value; event.currentTarget.value = date; onDateChange(nextDate); setConfirmedDetails(""); setLink(""); }}
                type="date"
                value={date}
              />
            </label>}
          <label>
            Time zone
            <input
              aria-describedby={!zoneValid ? zoneErrorId : undefined}
              aria-invalid={!zoneValid}
              disabled={busy || dateChangeDisabled}
              onBlur={commitZone}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitZone(); } }}
              onChange={(event) => { setZoneDraft(event.target.value); setConfirmedDetails(""); setLink(""); }}
              spellCheck={false}
              title="Use an IANA time zone such as America/Chicago"
              type="text"
              value={zoneDraft}
            />
          </label>
        </div>
        {!zoneValid && <p className="share-panel__zone-error" id={zoneErrorId} role="alert">Enter a valid IANA time zone, such as America/Chicago. Planning keeps your last valid time zone.</p>}
        {zoneDirty && zoneValid && <p className="share-panel__message">Leave the time zone field or press Enter to use this time zone.</p>}
        {dateError && <p className="share-panel__date-error">{dateError}</p>}
        <label className="share-panel__confirm">
          <input checked={confirmed} disabled={!zoneValid || zoneDirty || busy || dateChangeDisabled} onChange={(event) => setConfirmedDetails(event.target.checked ? detailsKey : "")} type="checkbox" />
          {multiDay ? "I confirm these event dates and time zone are correct." : "I confirm this date and time zone are correct."}
        </label>
        <p className="share-panel__warning">
          Anyone with a view link can see this plan and its event details until it expires in seven days. Links show a read-only snapshot, not the conversation.
        </p>
        <div className="share-panel__actions">
          <button disabled={busy || !zoneValid || zoneDirty || dateChangeDisabled} onClick={download} title="Download a calendar file for the selected date and time zone" type="button">Download .ics</button>
          <button disabled={busy || !zoneValid || zoneDirty || dateChangeDisabled} onClick={() => void makeLink()} title="Create a read-only view link that expires in seven days" type="button">
            {busy ? "Creating link…" : "Copy view link"}
          </button>
        </div>
        {message && messageDetails === detailsKey && <p className="share-panel__message" role="status">{message}</p>}
        {link && linkDetails === detailsKey && (
          <label className="share-panel__link">
            View link (expires {new Date(expiresAt).toLocaleDateString()})
            <input aria-label="View link" onFocus={(event) => event.target.select()} readOnly value={link} />
          </label>
        )}
      </div>
    </details>
  );
}

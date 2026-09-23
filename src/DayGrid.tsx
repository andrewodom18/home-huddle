import type { HouseholdPlan } from "../shared/contracts";
import { getAssignmentColor, getParticipantColors, participantColorStyle } from "./participantColors";

type PositionedItem = HouseholdPlan["items"][number] & {
  startMinutes: number;
  people: string[];
};

export type CalendarView = "people" | "shared";

type SharedItem = PositionedItem & { column: number; columns: number };

function arrangeShared(items: PositionedItem[]): SharedItem[] {
  const sorted = [...items].sort((a, b) => a.startMinutes - b.startMinutes || a.durationMinutes - b.durationMinutes || a.id.localeCompare(b.id));
  const result: SharedItem[] = [];
  let group: Array<PositionedItem & { column: number }> = [];
  let active: Array<PositionedItem & { column: number }> = [];
  let columns = 0;
  const finishGroup = () => {
    result.push(...group.map((item) => ({ ...item, columns })));
    group = [];
    active = [];
    columns = 0;
  };
  for (const item of sorted) {
    active = active.filter((prior) => prior.startMinutes + prior.durationMinutes > item.startMinutes);
    if (active.length === 0 && group.length > 0) finishGroup();
    const occupied = new Set(active.map((prior) => prior.column));
    let column = 0;
    while (occupied.has(column)) column += 1;
    const placed = { ...item, column };
    group.push(placed);
    active.push(placed);
    columns = Math.max(columns, column + 1);
  }
  if (group.length > 0) finishGroup();
  return result;
}

function minutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  return (hour % 12) * 60 + minute + (match[3].toUpperCase() === "PM" ? 720 : 0);
}

function formatTime(totalMinutes: number): string {
  const hour24 = Math.floor(totalMinutes / 60) % 24;
  const minute = totalMinutes % 60;
  return `${hour24 % 12 || 12}:${String(minute).padStart(2, "0")} ${hour24 >= 12 ? "PM" : "AM"}`;
}

function assignees(label: string, participants: string[]): string[] {
  if (/\b(all|everyone|family|household)\b/i.test(label)) return participants;
  return participants.filter((participant) => {
    const escaped = participant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|\\W)${escaped}($|\\W)`, "i").test(label);
  });
}

export function DayGrid({ plan, dayItems = plan.items, onEventClick, view = "people" }: { plan: HouseholdPlan; dayItems?: HouseholdPlan["items"]; onEventClick?: (id: string, trigger: HTMLButtonElement) => void; view?: CalendarView }) {
  const items = dayItems.flatMap((item): PositionedItem[] => {
    const startMinutes = minutes(item.startTime);
    if (startMinutes === null) return [];
    const people = assignees(item.assignee, plan.participants);
    return [{ ...item, startMinutes, people: people.length ? people : ["Unassigned"] }];
  });
  if (items.length === 0) return null;

  const people = [
    ...plan.participants,
    ...(items.some((item) => item.people.includes("Unassigned")) ? ["Unassigned"] : []),
  ];
  const participantColors = getParticipantColors(plan.participants);
  const sharedItems = view === "shared" ? arrangeShared(items) : [];
  const first = Math.floor(Math.min(...items.map((item) => item.startMinutes)) / 30) * 30;
  const last = Math.ceil(Math.max(...items.map((item) => item.startMinutes + item.durationMinutes)) / 30) * 30;
  const scale = 3;
  const height = Math.max(320, (last - first) * scale);
  const minWidth = view === "shared"
    ? Math.max(420, 66 + Math.max(...sharedItems.map((item) => item.columns)) * 160)
    : Math.max(640, 66 + people.length * 180);
  const ticks = Array.from({ length: Math.floor((last - first) / 30) + 1 }, (_, index) => first + index * 30);

  function eventButton(item: PositionedItem, placement?: Pick<SharedItem, "column" | "columns">) {
    const color = getAssignmentColor(item.people, participantColors);
    const shared = item.people.length > 1;
    const horizontal = placement ? {
      left: `calc(${(placement.column / placement.columns) * 100}% + 6px)`,
      width: `calc(${100 / placement.columns}% - 12px)`,
      right: "auto",
    } : {};
    return (
      <button
        aria-label={`Open details for ${item.task}, ${item.startTime}, assigned to ${item.assignee}`}
        className={`day-grid__event${item.durationMinutes < 15 ? " day-grid__event--short" : ""}${shared ? " day-grid__event--shared" : ""}`}
        key={item.id}
        onClick={(event) => onEventClick?.(item.id, event.currentTarget)}
        style={{ ...participantColorStyle(color), ...horizontal, top: (item.startMinutes - first) * scale + 3, height: Math.max(24, item.durationMinutes * scale - 6) }}
        title={`View activity details: ${item.task}, ${item.startTime}, ${item.durationMinutes} minutes, assigned to ${item.assignee}`}
        type="button"
      >
        <strong>{item.task}</strong>
        <span>{placement ? `${item.assignee} · ` : shared ? "Shared · " : ""}{item.startTime} · {item.durationMinutes} min</span>
        {item.details && <span className="day-grid__event-note">Has details</span>}
      </button>
    );
  }

  return (
    <div aria-label={view === "shared" ? "Shared calendar day view" : "Calendar day view"} className={`day-grid day-grid--${view}`} role="group">
      <div className="day-grid__head" style={{ gridTemplateColumns: `66px repeat(${view === "shared" ? 1 : people.length}, minmax(0, 1fr))`, minWidth }}>
        <span>Time</span>
        {view === "shared" ? <strong>All activities</strong> : people.map((person) => <strong key={person}>{person}</strong>)}
      </div>
      <div className="day-grid__body" style={{ gridTemplateColumns: `66px repeat(${view === "shared" ? 1 : people.length}, minmax(0, 1fr))`, minWidth }}>
        <div className="day-grid__time" style={{ height }}>
          {ticks.map((tick) => (
            <span key={tick} style={{ top: (tick - first) * scale }}>{formatTime(tick)}</span>
          ))}
        </div>
        {view === "shared" ? (
          <div className="day-grid__lane day-grid__lane--shared" style={{ height }}>
            {ticks.map((tick) => <span className="day-grid__line" key={tick} style={{ top: (tick - first) * scale }} />)}
            {sharedItems.map((item) => eventButton(item, item))}
          </div>
        ) : people.map((person) => (
          <div className="day-grid__lane" key={person} style={{ height }}>
            {ticks.map((tick) => (
              <span className="day-grid__line" key={tick} style={{ top: (tick - first) * scale }} />
            ))}
            {items.filter((item) => item.people.includes(person)).map((item) => eventButton(item))}
          </div>
        ))}
      </div>
    </div>
  );
}

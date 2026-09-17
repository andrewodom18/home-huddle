import type { HouseholdPlan } from "../shared/contracts";

type PositionedItem = HouseholdPlan["items"][number] & {
  startMinutes: number;
  people: string[];
};

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

export function DayGrid({ plan }: { plan: HouseholdPlan }) {
  const items = plan.items.flatMap((item): PositionedItem[] => {
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
  const first = Math.floor(Math.min(...items.map((item) => item.startMinutes)) / 30) * 30;
  const last = Math.ceil(Math.max(...items.map((item) => item.startMinutes + item.durationMinutes)) / 30) * 30;
  const scale = 1.55;
  const height = Math.max(320, (last - first) * scale);
  const ticks = Array.from({ length: Math.floor((last - first) / 30) + 1 }, (_, index) => first + index * 30);

  return (
    <div aria-hidden="true" className="day-grid">
      <div className="day-grid__head" style={{ gridTemplateColumns: `66px repeat(${people.length}, minmax(0, 1fr))` }}>
        <span>Time</span>
        {people.map((person) => <strong key={person}>{person}</strong>)}
      </div>
      <div className="day-grid__body" style={{ gridTemplateColumns: `66px repeat(${people.length}, minmax(0, 1fr))` }}>
        <div className="day-grid__time" style={{ height }}>
          {ticks.map((tick) => (
            <span key={tick} style={{ top: (tick - first) * scale }}>{formatTime(tick)}</span>
          ))}
        </div>
        {people.map((person) => (
          <div className="day-grid__lane" key={person} style={{ height }}>
            {ticks.map((tick) => (
              <span className="day-grid__line" key={tick} style={{ top: (tick - first) * scale }} />
            ))}
            {items.filter((item) => item.people.includes(person)).map((item) => (
              <div
                className="day-grid__event"
                key={item.id}
                style={{ top: (item.startMinutes - first) * scale + 3, height: Math.max(34, item.durationMinutes * scale - 6) }}
                title={`${item.task}, ${item.startTime}, ${item.durationMinutes} minutes`}
              >
                <strong>{item.task}</strong>
                <span>{item.startTime} · {item.durationMinutes} min</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

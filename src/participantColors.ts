import type { CSSProperties } from "react";

export type ParticipantColor = {
  id: string;
  accent: string;
};

// The accents stay legible on Home Huddle's dark calendar. Names, not colors,
// remain the primary way to identify who is assigned to an activity.
export const PARTICIPANT_PALETTE: readonly ParticipantColor[] = [
  { id: "sky", accent: "#8bd9ff" },
  { id: "violet", accent: "#d3b4f0" },
  { id: "teal", accent: "#8de0d6" },
  { id: "gold", accent: "#f3d18a" },
  { id: "rose", accent: "#f2b4cb" },
  { id: "lime", accent: "#c8e5a0" },
  { id: "orange", accent: "#ffc49e" },
  { id: "periwinkle", accent: "#bfd0ff" },
];

export const SHARED_COLOR: ParticipantColor = {
  id: "shared",
  accent: "#d2dce4",
};

function normalizedName(name: string): string {
  return name.trim().toLocaleLowerCase("en-US");
}

function nameHash(name: string): number {
  let hash = 2166136261;
  for (const character of normalizedName(name)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Stable under participant reorder; avoids duplicate presets when possible. */
export function getParticipantColors(participants: readonly string[]): Map<string, ParticipantColor> {
  const colors = new Map<string, ParticipantColor>();
  const used = new Set<number>();
  const names = [...new Set(participants)].sort((first, second) => {
    const a = normalizedName(first);
    const b = normalizedName(second);
    return a < b ? -1 : a > b ? 1 : 0;
  });

  for (const name of names) {
    const preferred = nameHash(name) % PARTICIPANT_PALETTE.length;
    let paletteIndex = preferred;
    if (used.size < PARTICIPANT_PALETTE.length) {
      while (used.has(paletteIndex)) paletteIndex = (paletteIndex + 1) % PARTICIPANT_PALETTE.length;
    }
    used.add(paletteIndex);
    colors.set(name, PARTICIPANT_PALETTE[paletteIndex]);
  }
  return colors;
}

export function getAssignmentColor(
  assignees: readonly string[],
  colors: ReadonlyMap<string, ParticipantColor>,
): ParticipantColor {
  return assignees.length === 1 ? colors.get(assignees[0]) ?? SHARED_COLOR : SHARED_COLOR;
}

export function participantColorStyle(color: ParticipantColor): CSSProperties {
  return {
    "--person-accent": color.accent,
  } as CSSProperties;
}

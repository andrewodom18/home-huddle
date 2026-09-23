import { describe, expect, it } from "vitest";
import {
  getAssignmentColor,
  getParticipantColors,
  PARTICIPANT_PALETTE,
  participantColorStyle,
  SHARED_COLOR,
} from "./participantColors";

function luminance(hex: string): number {
  const [red, green, blue] = [1, 3, 5].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("participant calendar colors", () => {
  it("keeps a person's color when participants are reordered and avoids repeats in a small plan", () => {
    const first = getParticipantColors(["Alex", "Sam", "Riley"]);
    const reordered = getParticipantColors(["Riley", "Alex", "Sam"]);
    for (const name of ["Alex", "Sam", "Riley"]) {
      expect(reordered.get(name)).toEqual(first.get(name));
    }
    expect(new Set([...first.values()].map((color) => color.id)).size).toBe(3);
  });

  it("uses each person's color only for a single-person activity", () => {
    const colors = getParticipantColors(["Alex", "Sam"]);
    expect(getAssignmentColor(["Alex"], colors)).toEqual(colors.get("Alex"));
    expect(getAssignmentColor(["Alex", "Sam"], colors)).toEqual(SHARED_COLOR);
    expect(getAssignmentColor(["Unassigned"], colors)).toEqual(SHARED_COLOR);
  });

  it("keeps the slim accents legible against the shared neutral event surface", () => {
    for (const color of [...PARTICIPANT_PALETTE, SHARED_COLOR]) {
      expect(contrast("#f3f8fc", "#3c4650")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(color.accent, "#3c4650")).toBeGreaterThanOrEqual(3);
      expect(participantColorStyle(color)).toMatchObject({
        "--person-accent": color.accent,
      });
    }
  });
});

// @vitest-environment node
import { describe, expect, it } from "vitest";
import { evaluateCampaign } from "./campaign-gate";

const critical = ["free-parallel", "free-cross-month", "revision-exact-start", "revision-assignee"];
const corpus = [...critical.map((id) => ({ id, outcome: "plan" as const })), { id: "preset-weekday", outcome: "plan" as const }, { id: "missing-information", outcome: "clarification" as const }];
const pass = (id: string) => ({ id, sourceFingerprint: "current", outcome: "pass" as "pass" | "fail" | "blocked", hardIssues: [] as string[] });
const passing = () => [...corpus.map(({ id }) => pass(id)), ...critical.map(pass)];

describe("live release gate", () => {
  it("requires coverage and two current-source observations for each critical case", () => {
    expect(evaluateCampaign(corpus, passing(), "current").gate).toBe(true);
    expect(evaluateCampaign(corpus, corpus.map(({ id }) => pass(id)), "current").gate).toBe(false);
    expect(evaluateCampaign(corpus, passing().map((row) => row.id === "preset-weekday" ? { ...row, sourceFingerprint: "older" } : row), "current").gate).toBe(false);
  });
  it("never erases a published violation with a later passing retry", () => {
    const observations = [{ ...pass("free-parallel"), outcome: "fail" as const, hardIssues: ["wrong-assignee"] }, ...passing()];
    const result = evaluateCampaign(corpus, observations, "current");
    expect(result.successRate).toBe(1);
    expect(result.publishedViolations).toBe(1);
    expect(result.gate).toBe(false);
  });
  it("counts failed feasible attempts even after every latest case passes", () => {
    const observations = [0, 1].map(() => ({ ...pass("free-parallel"), outcome: "fail" as const }));
    const result = evaluateCampaign(corpus, [...observations, ...passing()], "current");
    expect(result.successRate).toBe(1);
    expect(result.observationSuccessRate).toBe(0.8);
    expect(result.gate).toBe(false);
  });
  it("keeps older source findings separate and requires expected safety outcomes", () => {
    const old = { ...pass("free-parallel"), sourceFingerprint: "older", outcome: "fail" as const, hardIssues: ["wrong-date"] };
    expect(evaluateCampaign(corpus, [old, ...passing()], "current").gate).toBe(true);
    expect(evaluateCampaign(corpus, [...passing(), { ...pass("missing-information"), outcome: "fail" }], "current").gate).toBe(false);
  });
});

// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertCandidateHealth, assertLocalCandidate, verifyCandidateAfterResponse } from "./campaignPreflight";
import { sourceFingerprint } from "../server/sourceFingerprint";
import { readV3Ledger, reserveV3, settleV3, v3Spent } from "./campaign-budget-v3";

const health = {
  status: "ok",
  plannerVersion: 2,
  bedrockConfigured: true,
  sourceFingerprint: "0123456789abcdef",
  modelId: "us.amazon.nova-2-lite-v1:0",
  region: "us-east-1",
  instanceId: "56c23b7d-0e9f-4df8-a4e5-a596721be46b",
};

describe("live campaign candidate preflight", () => {
  it("accepts only the frozen local source, model, region, and process", () => {
    expect(assertCandidateHealth(health, health.sourceFingerprint)).toBe(health.instanceId);
    expect(() => assertCandidateHealth(health, "ffffffffffffffff")).toThrow();
    expect(() => assertCandidateHealth({ ...health, modelId: "another-model" }, health.sourceFingerprint)).toThrow();
    expect(() => assertCandidateHealth({ ...health, region: "us-west-2" }, health.sourceFingerprint)).toThrow();
    expect(() => assertCandidateHealth({ ...health, bedrockConfigured: false }, health.sourceFingerprint)).toThrow();
    expect(() => assertCandidateHealth({ ...health, instanceId: undefined }, health.sourceFingerprint)).toThrow();
    expect(() => assertCandidateHealth({ ...health, instanceId: "25b6c854-b537-418a-b8ba-e90d90cb2ca6" }, health.sourceFingerprint, health.instanceId)).toThrow();
  });

  it("rejects a changed checkout before contacting the API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      await expect(assertLocalCandidate("ffffffffffffffff")).rejects.toThrow("source changed");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("rejects a proxy that lacks the local candidate identity", async () => {
    const fingerprint = await sourceFingerprint();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "ok", plannerVersion: 2, bedrockConfigured: true }), { status: 200 }),
    );
    try {
      await expect(assertLocalCandidate(fingerprint)).rejects.toThrow("does not match");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("detects a local API restart between campaign requests", async () => {
    const fingerprint = await sourceFingerprint();
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...health, sourceFingerprint: fingerprint }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...health, sourceFingerprint: fingerprint, instanceId: "25b6c854-b537-418a-b8ba-e90d90cb2ca6" }), { status: 200 }));
    try {
      const instanceId = await assertLocalCandidate(fingerprint);
      await expect(assertLocalCandidate(fingerprint, instanceId)).rejects.toThrow("does not match");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("keeps the full reservation when the API identity changes after a response", async () => {
    const fingerprint = await sourceFingerprint();
    const directory = await mkdtemp(path.join(tmpdir(), "huddle-drift-"));
    const ledgerPath = path.join(directory, "ledger.json");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ...health, sourceFingerprint: fingerprint, instanceId: "25b6c854-b537-418a-b8ba-e90d90cb2ca6" }), { status: 200 }),
    );
    try {
      const ledger = await readV3Ledger(ledgerPath, fingerprint);
      const attempt = await reserveV3(ledgerPath, ledger, "free-parallel", fingerprint);
      const checked = await verifyCandidateAfterResponse(fingerprint, health.instanceId, 2);
      expect(checked).toEqual({ matched: false, callCount: undefined });
      await settleV3(ledgerPath, ledger, attempt, checked.callCount);
      expect(v3Spent(ledger)).toBe(3);
    } finally {
      fetchSpy.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

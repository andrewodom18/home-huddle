/** Opt-in, local-only, resumable campaign with an authorized targeted extension. Never writes prompts or response bodies. */
import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { chatResponseSchema, type ChatErrorResponse } from "../shared/contracts";
import { scheduleIssues } from "../server/scheduleValidation";
import { pastScheduleIssues } from "../server/pastSchedule";
import { assessPlan, buildCorpus } from "./planning-corpus";
import { CALL_CAP, readLedger, reserve, settle, spent } from "./campaign-budget";
import { evaluateCampaign } from "./campaign-gate";

const output = "output/live-corpus-v2";
const endpoint = "http://127.0.0.1:8787/api/chat";
type Result = { attempt: string; id: string; sourceFingerprint: string; outcome: "pass" | "fail" | "blocked"; status?: number; code?: string; calls: number | "unknown"; latencyMs: number; coverage?: number; hardIssues: string[]; qualityIssues: string[]; changedExistingActivities?: number };

async function sourceFingerprint(): Promise<string> {
  const hash = createHash("sha256");
  for (const dir of ["server", "shared", "scripts"]) {
    const files = (await readdir(dir)).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).sort();
    for (const filename of files) hash.update(`${dir}/${filename}\n`).update(await readFile(path.join(dir, filename)));
  }
  return hash.digest("hex").slice(0, 16);
}

async function main() {
  if (process.env.HOME_HUDDLE_LIVE_QUALITY !== "1") throw new Error("Set HOME_HUDDLE_LIVE_QUALITY=1 for the explicitly authorized local campaign.");
  await mkdir(output, { recursive: true });
  const lockPath = `${output}/campaign.lock`;
  const lock = await open(lockPath, "wx").catch(() => { throw new Error("Campaign lock exists. Confirm no campaign is running before removing a stale lock."); });
  await lock.writeFile(String(process.pid));
  let stopAfterCurrent = false;
  const stop = () => { stopAfterCurrent = true; };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  try {
    const health = await fetch("http://127.0.0.1:8787/api/health", { signal: AbortSignal.timeout(5000) });
    const state = await health.json() as { bedrockConfigured?: boolean; plannerVersion?: number };
    if (!health.ok || !state.bedrockConfigured || state.plannerVersion !== 2) throw new Error("Current planner-v2 API with Bedrock authentication is not ready; no model requests sent.");
    const fingerprint = await sourceFingerprint();
    const ledgerPath = `${output}/campaign-ledger.json`;
    const ledger = await readLedger(ledgerPath);
    const corpus = buildCorpus();
    const selected = process.env.HOME_HUDDLE_CASES?.split(",").filter(Boolean);
    if (selected?.some((id) => !corpus.some((entry) => entry.id === id))) throw new Error("Unknown selected corpus case.");
    const cases = selected ? selected.map((id) => corpus.find((entry) => entry.id === id)!) : corpus.filter((entry) => !ledger.attempts.some((attempt) => attempt.caseId === entry.id && attempt.sourceFingerprint === fingerprint));
    const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
    const results: Result[] = [];
    for (const entry of cases) {
      if (stopAfterCurrent) break;
      if (spent(ledger) + 3 > CALL_CAP) {
        process.stdout.write("Remaining allowance cannot cover another three-call request; saving the incomplete gate report.\n");
        break;
      }
      const attempt = await reserve(ledgerPath, ledger, entry.id, fingerprint);
      const startedAt = performance.now();
      let calls: unknown;
      let result: Result = { attempt, id: entry.id, sourceFingerprint: fingerprint, outcome: "fail", calls: "unknown", latencyMs: 0, hardIssues: [], qualityIssues: [] };
      try {
        const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry.request), signal: AbortSignal.timeout(110_000) });
        result.status = response.status;
        const body: unknown = await response.json();
        if (response.ok) {
          const parsed = chatResponseSchema.safeParse(body);
          if (!parsed.success) result.qualityIssues.push("malformed-response");
          else {
            const data = parsed.data;
            calls = data.meta.callCount;
            if (entry.outcome === "plan") {
              if (!data.plan) result.qualityIssues.push(`expected-plan-received-${data.outcome ?? "text"}`);
              else {
                const score = assessPlan(entry, data.plan);
                result = { ...result, ...score };
                if (process.env.HOME_HUDDLE_QUALITY_DIAGNOSTICS === "1" && (score.hardIssues.length || score.qualityIssues.length)) {
                  process.stdout.write(`Fictional plan feedback (${entry.id}): ${JSON.stringify(data.plan.items.map(({ taskId, task, date, startTime, durationMinutes, assignee }) => ({ taskId, task, date, startTime, durationMinutes, assignee })))}\n`);
                }
                if (scheduleIssues(data.plan, entry.request, data.plan.requirements).length) result.hardIssues.push("published-validator-violation");
                if (pastScheduleIssues(data.plan, entry.request, new Date()).length) result.hardIssues.push("published-past-or-historical-change");
              }
            } else if (data.plan || data.outcome !== entry.outcome) result.qualityIssues.push(`expected-${entry.outcome}`);
            if (process.env.HOME_HUDDLE_QUALITY_DIAGNOSTICS === "1" && !data.plan && result.qualityIssues.length) process.stdout.write(`Planning feedback (${entry.id}): ${data.reply.slice(0, 800)}\n`);
          }
        } else {
          const error = (body as Partial<ChatErrorResponse>)?.error;
          // Emit only known classifications, never free-form provider errors or household content.
          const allowed = ["VALIDATION", "RATE_LIMIT", "BEDROCK_AUTH", "BEDROCK_TIMEOUT", "BEDROCK_UNAVAILABLE", "INVALID_TOOL_OUTPUT", "TOOL_LOOP"];
          result.code = error?.code && allowed.includes(error.code) ? error.code : "API_ERROR";
          // A rate limit can originate before dispatch or at the provider; retain
          // the reservation rather than undercount an ambiguous external attempt.
          calls = result.code === "RATE_LIMIT" ? undefined : error?.diagnostics?.callCount;
          result.qualityIssues.push(result.code);
          if (process.env.HOME_HUDDLE_QUALITY_DIAGNOSTICS === "1" && ["VALIDATION", "INVALID_TOOL_OUTPUT"].includes(result.code) && typeof error?.message === "string") {
            // Opt-in console-only application feedback for this fictional corpus.
            // Never print provider/auth errors or persist full responses.
            process.stdout.write(`Validation feedback (${entry.id}): ${error.message.slice(0, 800)}\n`);
          }
          if (result.code === "BEDROCK_AUTH" || result.code === "RATE_LIMIT") result.outcome = "blocked";
        }
      } catch { result.qualityIssues.push("network-or-unreadable-response"); result.outcome = "blocked"; }
      result.calls = typeof calls === "number" && Number.isInteger(calls) && calls >= 0 && calls <= 3 ? calls : "unknown";
      result.latencyMs = Math.round(performance.now() - startedAt);
      if (result.outcome !== "blocked") result.outcome = result.hardIssues.length || result.qualityIssues.length ? "fail" : "pass";
      await settle(ledgerPath, ledger, attempt, result.calls);
      results.push(result);
      await writeFile(`${output}/results-${stamp}.json`, JSON.stringify({ sourceFingerprint: fingerprint, callCap: CALL_CAP, spentUpperBound: spent(ledger), results }, null, 2));
      process.stdout.write(`${entry.id}: ${result.outcome}; calls=${result.calls}; ${result.latencyMs}ms; categories=${[...result.hardIssues, ...result.qualityIssues].join(",") || "none"}\n`);
      if (result.outcome === "blocked" || result.hardIssues.length || stopAfterCurrent) break;
    }
    const allResults: Result[] = [];
    for (const file of (await readdir(output)).filter((name) => /^results-.*\.json$/.test(name)).sort()) {
      const saved = JSON.parse(await readFile(`${output}/${file}`, "utf8")) as { results: Result[] };
      allResults.push(...saved.results);
    }
    const { latest, currentResults, successRate, feasibleObservations, observationSuccessRate, publishedViolations, repeated, gate } = evaluateCampaign(corpus, allResults, fingerprint);
    const report = [
      "# Home Huddle planning-quality campaign", "", `Source fingerprint: ${fingerprint}. Updated: ${new Date().toISOString()}. Local API only.`,
      `Release gate: **${gate ? "met" : "not met"}**. Current-source coverage: ${currentResults.length}/30 cases; feasible custom success: ${(successRate * 100).toFixed(1)}%; critical cases repeated: ${repeated ? "yes" : "no"}.`,
      `All current-source feasible observations: ${feasibleObservations.filter((result) => result.outcome === "pass").length}/${feasibleObservations.length} successful (${(observationSuccessRate * 100).toFixed(1)}%). Published hard-constraint violation observations: ${publishedViolations}. A later successful retry does not erase a published violation.`,
      `Approved ceiling: ${CALL_CAP} actual Converse calls, including repairs. Persisted usage upper bound: ${spent(ledger)}. Requests attempted: ${ledger.attempts.length}. Interrupted requests retain three reserved calls.`,
      `Known completed calls: ${ledger.attempts.filter((attempt) => attempt.settled).reduce((total, attempt) => total + attempt.ceiling, 0)}. Unresolved/interrupted requests: ${ledger.attempts.filter((attempt) => !attempt.settled).length}, reserved at up to three calls each.`,
      "", "Results below are the latest observation per case; differing source fingerprints require rechecks before release. UI fixtures and live planning evidence are separate. No prompts, response bodies, credentials, or request IDs are saved.", "",
      "| Case | Result | Calls | Latency | Task coverage | Findings |", "| --- | --- | ---: | ---: | ---: | --- |",
      ...[...latest.values()].map((result) => `| ${result.id} | ${result.outcome}${result.sourceFingerprint !== fingerprint ? " (older source)" : ""} | ${result.calls} | ${result.latencyMs} ms | ${result.coverage === undefined ? "—" : `${Math.round(result.coverage * 100)}%`} | ${[...result.hardIssues, ...result.qualityIssues].join(", ") || "Expected behavior"} |`),
      "", "Practical quality checks cover parallelization, visible assumptions/resources/availability, task coverage, exact revision intent, resource contention, and historical preservation. Human usability and screen-reader walkthroughs are tracked separately; this report does not claim those ran.", "",
    ].join("\n");
    await writeFile(`${output}/report.md`, report);
    process.stdout.write(`Campaign report: ${output}/report.md; gate=${gate ? "met" : "not-met"}\n`);
    if (!gate) process.exitCode = 1;
  } finally { process.off("SIGTERM", stop); process.off("SIGINT", stop); await lock.close(); await unlink(lockPath); }
}

main().catch(() => { process.stderr.write("Campaign stopped before completion. Check API readiness, the campaign lock, and persisted allowance; no credentials or request contents are shown.\n"); process.exitCode = 1; });

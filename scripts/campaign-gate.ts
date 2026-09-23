type Case = { id: string; outcome: "plan" | "clarification" | "conflict" };
type Observation = { id: string; sourceFingerprint: string; outcome: "pass" | "fail" | "blocked"; hardIssues: string[] };

/** Retries cannot erase a published violation or inflate the observed success rate. */
export function evaluateCampaign<T extends Observation>(corpus: Case[], observations: T[], fingerprint: string) {
  const latest = new Map(observations.map((result) => [result.id, result]));
  const currentResults = [...latest.values()].filter((result) => result.sourceFingerprint === fingerprint);
  const currentObservations = observations.filter((result) => result.sourceFingerprint === fingerprint);
  const feasible = corpus.filter((entry) => entry.outcome === "plan" && !entry.id.startsWith("preset-"));
  const successRate = feasible.length ? feasible.filter((entry) => latest.get(entry.id)?.sourceFingerprint === fingerprint && latest.get(entry.id)?.outcome === "pass").length / feasible.length : 0;
  const feasibleObservations = currentObservations.filter((result) => feasible.some((entry) => entry.id === result.id));
  const observationSuccessRate = feasibleObservations.length ? feasibleObservations.filter((result) => result.outcome === "pass").length / feasibleObservations.length : 0;
  const publishedViolations = currentObservations.filter((result) => result.hardIssues.length > 0).length;
  const repeated = ["free-parallel", "free-cross-month", "revision-exact-start", "revision-assignee"].every((id) => currentObservations.filter((result) => result.id === id && result.outcome === "pass").length >= 2);
  const gate = currentResults.length === corpus.length && successRate >= 0.9 && observationSuccessRate >= 0.9 && repeated && publishedViolations === 0 && currentResults.every((result) => result.outcome !== "blocked") && corpus.filter((entry) => entry.outcome !== "plan" || entry.id.startsWith("preset-")).every((entry) => latest.get(entry.id)?.outcome === "pass");
  return { latest, currentResults, successRate, feasibleObservations, observationSuccessRate, publishedViolations, repeated, gate };
}

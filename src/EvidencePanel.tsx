import type { ChatResponse } from "../shared/contracts";

type EvidencePanelProps = {
  meta?: ChatResponse["meta"];
};

export function EvidencePanel({ meta }: EvidencePanelProps) {
  return (
    <details className="evidence-panel">
      <summary>
        <span className="evidence-panel__indicator" />
        {meta?.provider === "Home Huddle" ? "Schedule check" : "AWS integration evidence"}
        <span className="evidence-panel__hint">View trace</span>
      </summary>
      <dl>
        <div>
          <dt>Provider</dt>
          <dd>{meta?.provider ?? "Amazon Bedrock"}</dd>
        </div>
        <div>
          <dt>{meta?.provider === "Home Huddle" ? "Engine" : "Model"}</dt>
          <dd>{meta?.modelId ?? "Nova 2 Lite"}</dd>
        </div>
        <div>
          <dt>Planning tool</dt>
          <dd>{meta ? (meta.toolUsed ? "Invoked" : "Not needed") : "Waiting"}</dd>
        </div>
        {meta?.callCount !== undefined && <div><dt>Model calls</dt><dd>{meta.callCount}{meta.callCount > 1 ? " (includes planning stages or repairs)" : ""}</dd></div>}
        <div>
          <dt>Latency</dt>
          <dd>{meta ? `${meta.latencyMs.toLocaleString()} ms` : "—"}</dd>
        </div>
      </dl>
      <p>
        {meta?.provider === "Home Huddle"
          ? "This exact assignment was validated locally against the full schedule; this edit did not call Bedrock."
          : "The hosted AWS Lambda API calls Amazon Bedrock Converse. Prompts and household details are not logged."}
      </p>
    </details>
  );
}

import type { ChatRequest, PlanRequirements } from "../shared/contracts";

/** A conservative completeness check for explicitly shared, exclusive equipment.
 * It only rejects missing capture; it never guesses which activities use equipment
 * or adds an ordering. Unrecognized prose remains visible for user review. */
function captureSource(message: string, history: ChatRequest["history"]): string {
  // A date/time-only clarification answer supplements the initial request. Do
  // not resurrect old constraints when a substantive new request replaces it.
  const wordsInReply = message.toLowerCase().match(/[a-z]+/g) ?? [];
  const calendarWord = /^(?:on|at|from|to|between|and|am|pm|a|p|m|noon|midnight|today|tomorrow|next|this|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|st|nd|rd|th)$/;
  return wordsInReply.every((word) => calendarWord.test(word)) ? [...history.filter((entry) => entry.role === "user").map((entry) => entry.text), message].join(". ") : message;
}

export function resourceCaptureIssues(requirements: PlanRequirements, message: string, history: ChatRequest["history"] = []): string[] {
  message = captureSource(message, history);
  const exclusive = /\b(?:cannot|can't|must not|may not)\s+overlap\b|\b(?:one|single)\s+(?:task|job|activity|trip)\s+at\s+a\s+time\b/i;
  const names = new Map<string, string>();
  const sentences = message.split(/[.!?]/);
  for (const [index, sentence] of sentences.entries()) {
    // Exclusivity must be local to this declaration, not an unrelated personal
    // collision elsewhere in the request. Ambiguous prose is not inferred.
    if (!exclusive.test(sentence)) continue;
    if (/\b(?:capacity|fits|holds|accommodates)\b.{0,35}\b(?:[2-9]|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i.test(sentence)) continue;
    // The resource declaration itself must explicitly be shared, or describe
    // equipment occupied by the jobs. "One hour" and incidental possessions do
    // not establish shared capacity constraints.
    if (!/\b(?:both|shared?|sharing)\b/i.test(sentence) && !/\b(?:there is|we have)\b.*\b(?:occupied|whole task|jobs)\b/i.test(sentence)) continue;
    for (const match of sentence.matchAll(/\b(?:one|single)\s+([a-z\d][a-z\d '-]*)/gi)) {
      const phrase = match[1].split(/\b(?:for|to|is|are|was|which|that|and|but|with|at|occupied|needed|available|can|cannot|fits|must)\b/i)[0].trim().toLowerCase().replace(/^(?:(?:shared|household|communal)\s+)+/, "");
      if (!phrase || /^(?:task|job|activity|trip|person|adult|child|hour|minute|day|week|time|break|appointment)s?\b/.test(phrase)) continue;
      if (/\b(?:each|private|own)\b/.test(phrase)) continue;
      if (phrase.split(/\s+/).length <= 5) {
        const context = `${sentences[index - 1] ?? ""} ${sentence}`.split(/[,;]|\band\b/i).filter((clause) => !/\b(?:independent(?:ly)?|unrelated|separately|without)\b/i.test(clause)).join(" ");
        names.set(phrase, context);
      }
    }
  }
  const normalize = (value: string) => ` ${value.toLowerCase().replace(/[_-]/g, " ").replace(/[^a-z\d ]/g, " ").replace(/\s+/g, " ").trim()} `;
  const issues: string[] = [];
  for (const [name, context] of names) {
    const resource = requirements.resources?.find((entry) => normalize(`${entry.id} ${entry.label}`).includes(normalize(name)));
    if (!resource || resource.capacity !== 1) {
      issues.push(`Capture the explicitly shared ${name} as a resource with capacity 1; the request says its activities cannot overlap.`);
    } else {
      const uses = (task: PlanRequirements["tasks"][number]) => task.resources?.some((use) => use.resourceId === resource.id && use.units === 1);
      // Ground a missing-use check in uniquely named activities near the resource
      // declaration. This catches attaching equipment to an unrelated later task,
      // while a joint activity with multiple people still needs only one use.
      const words = requirements.tasks.map((task) => [...new Set(task.label.toLowerCase().match(/[a-z]{3,}/g) ?? [])].filter((word) => !/^(?:the|and|for|with|task|activity|prepare|preparation|prep|make|set|work|plan|minutes|minute)$/.test(word)));
      const named = requirements.tasks.filter((_task, index) => words[index].some((word) => words.filter((row) => row.includes(word)).length === 1 && normalize(context).includes(` ${word} `)));
      const missing = named.filter((task) => !uses(task));
      if (missing.length || !requirements.tasks.some(uses)) issues.push(`Attach ${resource.label} with units 1 to every activity that explicitly uses it${missing.length ? `, including ${missing.map((task) => task.label).join(", ")}` : ""}. A resource declaration alone does not enforce capacity. Do not attach unrelated activities.`);
    }
  }
  return issues;
}

/** Verify a narrow explicit sequence against captured dependencies. This never
 * schedules tasks or creates edges from proximity; uncertain targets need a
 * clarified checklist, not an invented ordering. */
export function orderingCaptureIssues(requirements: PlanRequirements, message: string, history: ChatRequest["history"] = []): string[] {
  const sentences = captureSource(message, history).split(/[.!?]/).map((part) => part.trim()).filter(Boolean);
  const tokenize = (value: string) => (value.toLowerCase().match(/[a-z]{3,}/g) ?? []).map((word) => word.replace(/s$/, ""));
  const people = new Set(requirements.tasks.flatMap((task) => [...(task.requiredParticipants ?? []), ...(task.allowedParticipants ?? [])]).flatMap(tokenize));
  const generic = /^(?:the|and|for|with|task|activitie|activity|prepare|preparation|prep|make|set|work|plan|minute|together|independently|all|both|then|after|before|doe|are|complete|finished)$/;
  const labels = requirements.tasks.map((task) => [...new Set(tokenize(task.label))].filter((word) => !generic.test(word) && !people.has(word)));
  const named = (text: string) => {
    const clauses = text.split(/[,;]|\band\b/i).filter((clause) => !/\b(?:unrelated|separately|without waiting|regardless)\b/i.test(clause));
    const words = new Set(tokenize(clauses.join(" ")));
    return requirements.tasks.filter((_task, index) => labels[index].some((word) => words.has(word) && labels.filter((label) => label.includes(word)).length === 1));
  };
  const edges = new Map<string, string[]>();
  for (const edge of requirements.ordering ?? []) edges.set(edge.beforeTaskId, [...(edges.get(edge.beforeTaskId) ?? []), edge.afterTaskId]);
  for (const gap of requirements.gaps ?? []) edges.set(gap.afterTaskId, [...(edges.get(gap.afterTaskId) ?? []), gap.beforeTaskId]);
  const precedes = (before: string, after: string, visited = new Set<string>()): boolean => {
    if (visited.has(before)) return false;
    visited.add(before);
    return (edges.get(before) ?? []).some((next) => next === after || precedes(next, after, visited));
  };
  const issues = new Set<string>();
  const previousStage = (index: number): string => {
    // Cross at most two intervening sentences that only refer to the same jobs.
    // Stop on a new named activity or any substantive/uncertain statement.
    for (let offset = 1; offset <= 3 && index - offset >= 0; offset += 1) {
      const previous = sentences[index - offset].split(/\bthen\b/i).at(-1) ?? "";
      if (named(previous).length) return previous;
      const words = previous.toLowerCase().match(/[a-z]+/g) ?? [];
      const reference = /\b(?:those|these|them|they)\b/i.test(previous) && /\b(?:parallel|independent|independently|concurrently|simultaneously)\b/i.test(previous);
      const onlyReferenceWords = words.every((word) => /^(?:do|run|work|keep|those|these|the|jobs|tasks|activities|them|they|are|in|parallel|independent|independently|concurrently|should|can|all|both|at|same|time|simultaneously)$/.test(word));
      if (!reference || !onlyReferenceWords) return previous;
    }
    return "";
  };
  const check = (beforeText: string, afterText: string, previous: string, barrier: boolean) => {
    afterText = afterText.split(";")[0].replace(/\s+(?:and|while)\s+[^,;]*\b(?:if|unless|does not|doesn't|not need)\b.*$/i, "").replace(/\bwhile\b[^.;]*\bindependently\b[^.;]*/gi, "");
    if (/\b(?:if|unless|not|never|don't|doesn't|no need)\b/i.test(beforeText + afterText)) return;
    let before = named(beforeText);
    if (!before.length && (barrier || !beforeText.trim())) before = named(previous.split(/\bthen\b/i).at(-1) ?? "");
    const after = named(afterText);
    if (!before.length && !after.length && !barrier) return;
    if (!before.length || !after.length || before.some((task) => after.some((next) => next.id === task.id))) {
      issues.add("The explicit activity sequence is ambiguous. Preserve named activities and clarify which must finish before which; use explain_planning_outcome if this cannot be resolved from the request.");
      return;
    }
    for (const task of before) for (const next of after) if (!precedes(task.id, next.id)) issues.add(`Capture the explicit dependency ${task.id} before ${next.id}. Do not impose ordering between independent prerequisites. If these activity targets are uncertain, ask for clarification instead.`);
  };
  for (const [index, rawSentence] of sentences.entries()) {
    const sentence = rawSentence.replace(/[,;]?\s*\bwhile\b[^.;]*\bindependently\b[^.;]*/gi, "");
    if (/^\s*(?:if|unless|do not|don't|never)\b/i.test(sentence)) continue;
    const stages = sentence.split(/\bthen\b/i);
    if (stages.length > 1) {
      for (let stage = 1; stage < stages.length; stage += 1) {
        const before = stages[stage - 1]; const after = stages[stage];
        if (/^\s*(?:tell|show|send|display|return|explain)\b/i.test(after)) continue;
        check(before, after, previousStage(index), /\b(?:independently|all|both|finished|complete)\b/i.test(before + after));
      }
      continue;
    }
    const leadingAfter = /^(?:after|once)\s+all\b/i.test(sentence)
      ? /^(?:after|once)\s+all\s+(.+),\s*(.+)$/i.exec(sentence)
      : /^(?:after|once)\s+(.+?),\s*(.+)$/i.exec(sentence);
    if (leadingAfter) check(leadingAfter[1], leadingAfter[2], previousStage(index), /^(?:after|once)\s+all\b/i.test(sentence));
    else {
      const after = /\b(?:after|once)\s+all\b/i.exec(sentence);
      if (after) check(sentence.slice(after.index + after[0].length), sentence.slice(0, after.index), previousStage(index), true);
    }
  }
  return [...issues];
}

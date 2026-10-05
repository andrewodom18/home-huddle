export function ambiguousClockTimes(message: string): string[] {
  const times = new Set<string>();
  const pattern = /\b(?:at|from|to|until|by)\s+((?:0?[1-9]|1[0-2])(?::[0-5]\d)?)(?![\d:])/gi;
  for (const match of message.matchAll(pattern)) {
    const after = message.slice(match.index! + match[0].length).trimStart();
    if (/^(?:a\.?m\.?|p\.?m\.?)\b/i.test(after)) continue;
    times.add(match[1]);
  }
  return [...times];
}

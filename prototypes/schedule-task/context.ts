// Keep full evidence on disk. Send a few distinct, actionable findings per turn.
export function feedbackExcerpt(findings: string[], limit: number): string {
  const unique = [...new Set(findings.map(text => text.trim()).filter(Boolean))];
  const lines = [];
  let remaining = limit;
  for (const finding of unique) {
    if (remaining < 16) break;
    const size = Math.min(remaining, Math.ceil(limit / 2));
    const line = finding.length <= size ? finding : finding.slice(0, size - 1) + "…";
    lines.push(line);
    remaining -= line.length + 1;
  }
  return lines.join("\n");
}

export function contextOverflow(error: unknown) {
  return /context_length_exceeded|context window exceeded|ran out of room in .*context window|exceed(?:ed|s).*context window|maximum context length|too many input tokens/i.test(String(error));
}

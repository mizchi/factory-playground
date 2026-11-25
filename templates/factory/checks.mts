// Replace this function when the deliverable changes, e.g. parse JSON or check a CSV total.
export function checkArtifact(artifact: string, requiredHeadings: string[]): string[] {
  const lines = artifact.split(/\r?\n/).map(line => line.trimEnd());
  return requiredHeadings.filter(h => !lines.includes("## " + h)).map(h => "見出しがありません: " + h);
}

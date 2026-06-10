/**
 * Cleans up WebVTT (.vtt) and SRT (.srt) transcript formats by stripping out
 * timestamps, block numbers, headers, and metadata, keeping only the raw text.
 */
export function cleanTranscript(text: string): string {
  if (!text) return "";

  const lines = text.split(/\r?\n/);
  const cleaned: string[] = [];

  // Detect if this is a WebVTT or SRT file
  const isSubtitleFormat = text.includes("-->") || lines[0]?.trim().toUpperCase() === "WEBVTT";

  if (!isSubtitleFormat) {
    // Return standard text but trim duplicate blank spaces/newlines
    return text
      .split(/\n+/)
      .map(line => line.trim())
      .filter(Boolean)
      .join("\n");
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines
    if (!line) continue;

    // Skip WEBVTT headers or style blocks
    if (line.toUpperCase() === "WEBVTT" || line.startsWith("NOTE")) {
      continue;
    }

    // Skip timeline arrows (e.g. 00:01:20.000 --> 00:01:23.000 or 1 -> 2)
    if (line.includes("-->")) {
      continue;
    }

    // Skip SRT block indices (a lone integer)
    if (/^\d+$/.test(line)) {
      continue;
    }

    // Add valid lines
    cleaned.push(line);
  }

  // Join lines with single spacing, maintaining speaker prefixes if present
  return cleaned.join("\n");
}

/**
 * Truncates raw text to fit safely inside the LLM token budget
 */
export function truncateTranscript(text: string, wordLimit = 15000): string {
  if (!text) return "";
  const words = text.split(/\s+/);
  if (words.length <= wordLimit) return text;
  
  return words.slice(0, wordLimit).join(" ") + "\n\n[Transcript truncated due to length...]";
}

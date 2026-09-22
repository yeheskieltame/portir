/** Free reasoning models leak their scratchpad; keep only the answer. */
export function cleanAnswer(text: string): string {
  const closed = text.lastIndexOf("</think>");
  const body = closed >= 0 ? text.slice(closed + "</think>".length) : text.replace(/<think>[\s\S]*?<\/think>/g, "");
  return body.replace(/^<think>[\s\S]*$/, "").trim() || text.trim();
}

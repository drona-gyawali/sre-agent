import { parseJsonText } from "../../mcp/mcp-response";

export function cleanGeneratedQuery(generated: string): string {
  const fenced = generated.match(/```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)```/);
  return (fenced?.[1] ?? generated).trim();
}

export function normalizeSourceData(text: string): unknown {
  const trimmed = text.trim();

  if (!trimmed) {
    return "No results";
  }

  try {
    return parseJsonText(trimmed);
  } catch {
    return text;
  }
}

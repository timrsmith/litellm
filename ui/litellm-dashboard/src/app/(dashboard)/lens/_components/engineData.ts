import type { components } from "@/lib/http/schema";

export type Engine = components["schemas"]["Engine"];
export type Settings = components["schemas"]["EngineSettings"];
export type EngineList = components["schemas"]["EngineList"];
export type Finding = components["schemas"]["Finding"];
export type Sample = components["schemas"]["Sample"];
export type WorkerCreated = components["schemas"]["WorkerCreated"];

export const starterQuestions = [
  "Find repeated work or tool calls that add no useful information.",
  "Find tool failures or retries that the agent does not recover from.",
  "Identify recurring user needs and successful ways the agent handles them.",
];

export function filtersFromText(text: string): Settings["filters"] {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const separator = line.indexOf("=");
      if (separator < 1 || !line.slice(separator + 1).trim()) throw new Error("Write each filter as key=value");
      return { key: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() };
    });
}

export function engineStatus(engine: Engine, connected: boolean): string {
  const active = engine.jobs?.find((job) => ["queued", "running"].includes(job.status ?? ""));
  if (active) return connected ? active.stage ?? "Queued" : "Waiting for worker";
  const spent = engine.budget_month === new Date().toISOString().slice(0, 7) ? engine.spent ?? 0 : 0;
  if (spent >= (engine.settings.monthly_budget ?? 20)) return "Budget reached";
  if (!engine.settings.enabled) return "Paused";
  return connected ? "Monitoring" : "Worker disconnected";
}

export function evidenceTarget(id: string): { source: string; team: string; id: string } | null {
  try {
    const parsed: unknown = JSON.parse(atob(id.replace(/-/g, "+").replace(/_/g, "/")));
    if (!Array.isArray(parsed) || parsed.length !== 3 || !parsed.every((item) => typeof item === "string")) return null;
    return { source: parsed[0], team: parsed[1], id: parsed[2] };
  } catch {
    return null;
  }
}

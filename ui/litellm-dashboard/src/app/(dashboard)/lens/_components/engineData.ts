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

export type Job = components["schemas"]["Job"];

export function analysisProgress(job: Job) {
  const {
    screened = 0,
    selected = 0,
    grouped_batches = 0,
    grouping_batches = 0,
    investigated = 0,
    candidates = 0,
  } = job.coverage ?? {};
  if (job.status === "queued") {
    return {
      step: -1,
      title: "Waiting for a worker",
      done: 0,
      total: 0,
      detail: "Analysis will start when a worker is available.",
    };
  }
  if (job.stage === "Grouping observations") {
    return {
      step: 1,
      title: "Finding patterns",
      done: grouped_batches,
      total: grouping_batches,
      detail: grouping_batches
        ? `${grouped_batches} of ${grouping_batches} observation batches compared`
        : `Comparing observations across ${screened} reviewed runs`,
    };
  }
  if (job.stage === "Checking original evidence") {
    return {
      step: 2,
      title: "Checking evidence",
      done: investigated,
      total: candidates,
      detail: candidates
        ? `${investigated} of ${candidates} patterns checked against the original activity`
        : `${investigated} patterns checked against the original activity`,
    };
  }
  return {
    step: 0,
    title: "Reviewing activity",
    done: screened,
    total: selected,
    detail: `${screened} of ${selected} selected runs reviewed`,
  };
}

export function analysisElapsed(createdAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 1000));
  if (!Number.isFinite(seconds)) return "0s";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

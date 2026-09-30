"use client";

import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X, ArrowUpRight } from "lucide-react";
import { apiClient } from "@/components/networking";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TraceDrawer } from "@/components/view_logs/TraceView/TraceDrawer";
import { type Sample, type Settings, runTime } from "./engineData";

export type ActivitySelection = Pick<Settings, "source" | "service" | "filters" | "lookback_hours">;
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

export function RunList({ executions }: { executions: Sample["executions"] }) {
  return (
    <div className="divide-y">
      {executions.map((run) => (
        <div key={run.id} className="py-3">
          <p className="text-sm font-medium">{run.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {runTime(run.start_time)} · {run.source === "traces" ? `${run.span_count} steps` : "LLM request"}
          </p>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={run.trace_id}>
            {run.trace_id}
          </p>
        </div>
      ))}
    </div>
  );
}

export function ActivityScope({
  value,
  onChange,
  accessToken,
}: {
  value: ActivitySelection;
  onChange: (selection: ActivitySelection) => void;
  accessToken: string;
}) {
  const id = useId();
  const [scope, setScope] = useState(value);
  const [trace, setTrace] = useState<string | null>(null);
  const serialized = JSON.stringify(value);
  useEffect(() => {
    const timer = setTimeout(() => setScope(JSON.parse(serialized) as ActivitySelection), 350);
    return () => clearTimeout(timer);
  }, [serialized]);
  const valid = (scope.filters ?? []).every((f) => f.key.trim() && f.value.trim());
  const load = (selection: ActivitySelection) => {
    const { lookback_hours, ...selectionSettings } = selection;
    return apiClient.post<Sample>("/engine/preview/sample", {
      accessToken,
      body: {
        settings: {
          ...selectionSettings,
          name: "Preview",
          model: "preview",
          sample_size: 100,
          checks: [{ id: "preview", instruction: "Preview recorded activity" }],
        },
        lookback_hours: lookback_hours ?? 24,
      },
    });
  };
  const discoveryScope: ActivitySelection = {
    source: value.source,
    service: "",
    filters: [],
    lookback_hours: value.lookback_hours,
  };
  const discovery = useQuery({
    queryKey: ["lens-activity-options", value.source, value.lookback_hours, accessToken],
    queryFn: () => load(discoveryScope),
    staleTime: 60000,
  });
  const previewOptions = {
    queryKey: ["lens-activity-preview", scope, accessToken],
    queryFn: () => load(scope),
    enabled: valid,
    staleTime: 30000,
  };
  const preview = useQuery(previewOptions);
  const runs = discovery.data?.executions ?? [];
  const services = [...new Set(runs.map((r) => r.service).filter(Boolean))].sort();
  const attributes = runs.flatMap((r) => r.metadata ?? []);
  const keys = [...new Set(attributes.map((a) => a.key).filter((key) => !key.startsWith("litellm.")))].sort();
  const pending = serialized !== JSON.stringify(scope) || preview.isFetching;
  const ready = !pending && valid;
  const filters = value.filters ?? [];
  const edit = (index: number, field: "key" | "value", text: string) =>
    onChange({ ...value, filters: filters.map((f, i) => (i === index ? { ...f, [field]: text } : f)) });

  const changeSource = (source: Settings["source"]) => {
    const selection = { ...value, source, service: "", filters: [] };
    onChange(selection);
  };
  const windowLabel = { 24: "Last 24 hours", 168: "Last 7 days", 720: "Last 30 days" }[value.lookback_hours ?? 24];
  const previewTitle = () => {
    if (pending) return "Finding matching activity…";
    if (!valid) return "Complete your condition to preview matches";
    if (!preview.data) return "Preview unavailable";
    return `${preview.data.eligible} matching ${value.source === "requests" ? "requests" : "runs"}`;
  };
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="space-y-4">
        <label className="grid gap-2 text-sm">
          Activity type
          <select
            className={selectClass}
            value={value.source}
            onChange={(e) => changeSource(e.target.value as Settings["source"])}
          >
            <option value="traces">Agent runs</option>
            <option value="requests">Individual LLM requests</option>
            <option value="both">Agent runs and LLM requests</option>
          </select>
        </label>
        <p className="text-xs text-muted-foreground">
          {value.source === "requests"
            ? "Each request is one model call, not an entire agent run."
            : "An agent run contains the steps recorded under one trace ID. Separate sessions are not joined automatically."}
        </p>
        <label className="grid gap-2 text-sm">
          {value.source === "requests" ? "Model group" : "Service"}
          <Input
            list={`${id}-services`}
            value={value.service}
            placeholder="All activity"
            onChange={(e) => onChange({ ...value, service: e.target.value })}
          />
          <datalist id={`${id}-services`}>
            {services.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <div className="space-y-2">
          <p className="text-sm font-medium">
            Narrow by metadata <span className="font-normal text-muted-foreground">(optional)</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Match a recorded tag, swarm, or environment. Every condition must match exactly.
          </p>
          {filters.map((f, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                aria-label={`Metadata key ${index + 1}`}
                list={`${id}-keys`}
                placeholder="Choose or enter a key"
                value={f.key}
                onChange={(e) => edit(index, "key", e.target.value)}
              />
              <span className="text-xs text-muted-foreground">is</span>
              <Input
                aria-label={`Metadata value ${index + 1}`}
                list={`${id}-values-${index}`}
                placeholder="Choose or enter a value"
                value={f.value}
                onChange={(e) => edit(index, "value", e.target.value)}
              />
              <datalist id={`${id}-values-${index}`}>
                {[...new Set(attributes.filter((a) => a.key === f.key).map((a) => a.value))].sort().map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove condition ${index + 1}`}
                onClick={() => onChange({ ...value, filters: filters.filter((_, i) => i !== index) })}
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
          <datalist id={`${id}-keys`}>
            {keys.map((key) => (
              <option key={key} value={key} />
            ))}
          </datalist>
          <Button
            variant="outline"
            size="sm"
            disabled={filters.length >= 8}
            onClick={() => onChange({ ...value, filters: [...filters, { key: "", value: "" }] })}
          >
            <Plus className="size-3" />
            Add condition
          </Button>
          <p className="text-xs text-muted-foreground">
            Suggestions come from up to 100 recent runs. You can also type a recorded key or value.
          </p>
        </div>
        <label className="grid gap-2 text-sm">
          Time window
          <select
            className={selectClass}
            value={value.lookback_hours ?? 24}
            onChange={(e) => onChange({ ...value, lookback_hours: Number(e.target.value) })}
          >
            <option value={24}>Last 24 hours</option>
            <option value={168}>Last 7 days</option>
            <option value={720}>Last 30 days</option>
          </select>
        </label>
      </div>
      <section aria-label="Matching activity" className="self-start rounded-lg border">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-medium" role="status">
            {previewTitle()}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{windowLabel} · Preview only, no analysis cost</p>
        </div>
        <div className="max-h-80 overflow-y-auto px-4">
          {ready && preview.error && (
            <p role="alert" className="py-3 text-sm text-destructive">
              {preview.error.message}
            </p>
          )}
          {ready && preview.data?.eligible === 0 && (
            <p className="py-4 text-sm text-muted-foreground">
              No matches. Try removing a condition or check that your agent records this metadata. Very recent runs need
              two minutes to settle.
            </p>
          )}
          {ready &&
            preview.data?.executions.slice(0, 10).map((run) => (
              <div key={run.id} className="flex items-center justify-between gap-3 border-b last:border-0">
                <div className="min-w-0">
                  <RunList executions={[run]} />
                </div>
                {run.source === "traces" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Open ${run.name}`}
                    onClick={() => setTrace(run.trace_id)}
                  >
                    Open run
                    <ArrowUpRight className="size-3" />
                  </Button>
                )}
              </div>
            ))}
        </div>
        {ready && (preview.data?.eligible ?? 0) > 10 && (
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">
            Showing 10 examples. Your scan limit determines how many matching runs are reviewed.
          </p>
        )}
      </section>
      {trace && <TraceDrawer open traceId={trace} accessToken={accessToken} onClose={() => setTrace(null)} />}
    </div>
  );
}

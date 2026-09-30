"use client";

import type { components } from "@/lib/http/schema";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Aperture, ArrowUpRight, CheckCircle2, Circle, Layers3, Pause, Play, Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { apiClient } from "@/components/networking";
import { TraceDrawer } from "@/components/view_logs/TraceView/TraceDrawer";
import { EngineSetup } from "./EngineSetup";
import { EngineProgress } from "./EngineProgress";
import { WorkerSetup } from "./WorkerSetup";
import { engineStatus, evidenceTarget, type Engine, type EngineList, type Finding, type Settings } from "./engineData";

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 3 }).format(n);
const when = (value?: string | null) => (value ? new Date(value).toLocaleString() : "Not yet");

const sourceLabels = { both: "Traces and requests", requests: "LLM requests", traces: "Agent traces" };
const priorityColors = { high: "bg-red-500", medium: "bg-amber-500", low: "bg-slate-400" };
function emptyFindingTitle(active: boolean, scanned: boolean) {
  if (active) return "Your findings will appear here";
  return scanned ? "No matching findings" : "Ready for the first analysis";
}

export function EngineView({ accessToken, readOnly = false }: { accessToken: string; readOnly?: boolean }) {
  const client = useQueryClient();
  const key = ["engines", accessToken];
  const query = useQuery({
    queryKey: key,
    queryFn: () => apiClient.get<EngineList>("/engine", { accessToken }),
    refetchInterval: 10000,
  });
  const models = useQuery({
    queryKey: ["engine-models", accessToken],
    queryFn: () => apiClient.get<{ data: { id: string }[] }>("/models", { accessToken }),
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<"new" | "edit" | null>(null);
  const [workerSetup, setWorkerSetup] = useState(false);
  const [findingId, setFindingId] = useState<string | null>(null);
  const [filter, setFilter] = useState("open");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState<{ id: string; span: string } | null>(null);
  const engines = query.data?.engines ?? [];
  const showEmpty = !query.isLoading && !query.error && engines.length === 0;
  const engine = engines.find((e) => e.id === selected) ?? engines[0];
  const finding = engine?.findings?.find((f) => f.id === findingId);
  const connected =
    query.data?.workers?.some((w) => !w.revoked && query.dataUpdatedAt - Date.parse(w.last_seen) < 120000) ?? false;
  const job = engine?.jobs?.[0];
  const lastCompleted = engine?.jobs?.find((j) => j.status === "completed");
  const active = engine?.jobs?.find((j) => j.status === "queued" || j.status === "running");
  const target = evidence ? evidenceTarget(evidence.id) : null;
  const [requestOffset, setRequestOffset] = useState(0);
  const requestEvidence = useQuery({
    queryKey: ["engine-evidence", engine?.id, evidence?.id, requestOffset, accessToken],
    enabled: !!engine && target?.source === "requests",
    queryFn: () =>
      apiClient.get<components["schemas"]["ExecutionContent"]>(
        `/engine/${engine?.id}/executions/${encodeURIComponent(evidence?.id ?? "")}`,
        { accessToken, query: { offset: requestOffset } },
      ),
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: key });
  };
  const update = async (path: string, body: unknown, method: "post" | "put" | "patch" = "post") => {
    setBusy(true);
    setError("");
    try {
      await apiClient[method](path, { accessToken, body });
      await client.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update lens");
    } finally {
      setBusy(false);
    }
  };
  const save = async (settings: Settings) => {
    const saved = await apiClient.request<Engine>(
      editing === "edit" ? "PUT" : "POST",
      editing === "edit" ? `/engine/${engine.id}` : "/engine",
      { accessToken, body: settings },
    );
    setSelected(saved.id);
    setEditing(null);
    refresh();
  };
  const changeFinding = async (status: Finding["status"]) => {
    if (!engine || !finding) return;
    await update(`/engine/${engine.id}/findings/${finding.id}`, { status, reason }, "patch");
  };

  return (
    <main className="mx-auto w-full max-w-7xl p-6 md:p-8 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Aperture aria-hidden="true" className="size-7" strokeWidth={1.75} />
            <h1 className="text-2xl font-semibold tracking-tight">Lens</h1>
            <Badge variant="secondary">Beta</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Understand your agent activity. Find patterns worth acting on.
          </p>
        </div>
        {!readOnly && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setWorkerSetup(true)}>
              <Circle
                className={`size-2 ${connected ? "fill-emerald-500 text-emerald-500" : "fill-amber-500 text-amber-500"}`}
              />
              {connected ? "Worker connected" : "Connect worker"}
            </Button>
            {engines.length > 0 && (
              <Button onClick={() => setEditing("new")}>
                <Plus className="size-4" />
                New lens
              </Button>
            )}
          </div>
        )}
      </header>
      {(error || query.error) && (
        <div role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">
          {error || query.error?.message}
          <Button variant="ghost" size="sm" onClick={refresh}>
            Retry
          </Button>
        </div>
      )}
      {query.isLoading && (
        <p role="status" className="py-20 text-center text-muted-foreground">
          Loading lenses…
        </p>
      )}
      {showEmpty && (
        <section className="flex min-h-[430px] flex-col items-center justify-center rounded-xl border bg-card px-6 text-center">
          <div className="mb-5 rounded-xl border p-3">
            <Aperture className="size-6 text-muted-foreground" strokeWidth={1.75} />
          </div>
          <h2 className="text-xl font-medium">What would you like to understand?</h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
            Choose the activity to review, ask your questions, and get findings linked to the runs that explain them.
          </p>
          {!readOnly && (
            <Button className="mt-6" onClick={() => setEditing("new")}>
              Set up your first lens
              <ArrowUpRight className="size-4" />
            </Button>
          )}
          <div className="mt-10 flex flex-wrap justify-center gap-6 text-xs text-muted-foreground">
            <span>Recurring failures</span>
            <span>Unnecessary work</span>
            <span>How people use your agent</span>
          </div>
        </section>
      )}
      {engine && (
        <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="Lenses" className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
            {engines.map((e) => (
              <button
                key={e.id}
                onClick={() => {
                  setSelected(e.id);
                  setFindingId(null);
                }}
                aria-current={engine.id === e.id ? "page" : undefined}
                className={`min-w-44 rounded-lg px-3 py-3 text-left transition-colors ${engine.id === e.id ? "bg-muted" : "hover:bg-muted/50"}`}
              >
                <span className="block truncate text-sm font-medium">{e.settings.name}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{engineStatus(e, connected)}</span>
              </button>
            ))}
          </nav>
          <section className="min-w-0 space-y-5">
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{engine.settings.name}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {sourceLabels[engine.settings.source ?? "traces"]} ·{" "}
                  {engine.settings.service || "All accessible activity"}
                  {engine.settings.filters?.length ? ` · ${engine.settings.filters.length} filters` : ""}
                </p>
              </div>
              {!readOnly && (
                <div className="flex gap-2">
                  <Button variant="ghost" size="icon" aria-label="Lens settings" onClick={() => setEditing("edit")}>
                    <Settings2 className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      update(`/engine/${engine.id}`, { ...engine.settings, enabled: !engine.settings.enabled }, "put")
                    }
                  >
                    {engine.settings.enabled ? <Pause className="size-3" /> : <Play className="size-3" />}
                    {engine.settings.enabled ? "Pause" : "Resume"}
                  </Button>
                  <Button
                    disabled={busy || !!active || !connected}
                    onClick={() => update(`/engine/${engine.id}/runs`, {})}
                  >
                    <Play className="size-3" />
                    Analyze now
                  </Button>
                </div>
              )}
            </div>
            {!query.data?.tracing_enabled && (
              <div role="status" className="rounded-lg border border-amber-200 bg-amber-50/30 p-3 text-sm">
                Enable agent tracing and ClickHouse on this proxy before running an analysis.
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 rounded-xl border p-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <p className="mt-1 text-sm font-medium" role="status">
                  {engineStatus(engine, connected)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {engine.settings.enabled
                    ? `Checks every ${engine.settings.interval_minutes} minutes`
                    : "Manual analysis available"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Last successful scan</p>
                <p className="mt-1 text-sm">{when(lastCompleted?.finished_at ?? engine.last_scan_at)}</p>
                {lastCompleted && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {lastCompleted.coverage?.screened ?? 0} of {lastCompleted.coverage?.eligible ?? 0} eligible runs
                    reviewed
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Analysis spend this month</p>
                <p className="mt-1 text-sm">
                  {money(engine.budget_month === new Date().toISOString().slice(0, 7) ? engine.spent ?? 0 : 0)}{" "}
                  <span className="text-muted-foreground">/ {money(engine.settings.monthly_budget ?? 20)}</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Includes reservations for pending calls</p>
              </div>
            </div>
            {active && (
              <EngineProgress
                key={active.id}
                job={active}
                onCancel={
                  readOnly
                    ? undefined
                    : () => {
                        void update(`/engine/${engine.id}/cancel`, {});
                      }
                }
              />
            )}
            {job?.error && (
              <p role="alert" className="text-sm text-destructive">
                {job.error}
              </p>
            )}
            <Tabs defaultValue="findings" key={engine.id}>
              <TabsList variant="line">
                <TabsTrigger value="findings">Findings</TabsTrigger>
                <TabsTrigger value="checks">Questions & checks</TabsTrigger>
                <TabsTrigger value="activity">Activity</TabsTrigger>
              </TabsList>
              <TabsContent value="findings" className="pt-4 space-y-4">
                <div className="flex gap-2">
                  {["open", "resolved", "dismissed", "all"].map((f) => (
                    <Button
                      key={f}
                      size="sm"
                      variant={filter === f ? "secondary" : "ghost"}
                      onClick={() => setFilter(f)}
                      className="capitalize"
                    >
                      {f}
                    </Button>
                  ))}
                </div>
                <div className="divide-y rounded-xl border">
                  {engine.findings
                    ?.filter((f) => filter === "all" || f.status === filter)
                    .map((f) => (
                      <button
                        key={f.id}
                        onClick={() => {
                          setFindingId(f.id);
                          setReason(f.reason ?? "");
                        }}
                        className="flex w-full gap-4 p-4 text-left hover:bg-muted/30"
                      >
                        <span
                          className={`mt-1 size-2 shrink-0 rounded-full ${priorityColors[f.priority ?? "medium"]}`}
                          aria-label={`${f.priority} priority`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{f.title}</p>
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{f.description}</p>
                          <p className="mt-2 text-xs text-muted-foreground">
                            {f.occurrences?.length ?? 0} observed executions · {f.kind} · {when(f.last_seen)}
                          </p>
                        </div>
                        <ArrowUpRight className="size-4 text-muted-foreground" />
                      </button>
                    ))}
                  {!engine.findings?.some((f) => filter === "all" || f.status === filter) && (
                    <div className="px-6 py-14 text-center">
                      <CheckCircle2 className="mx-auto mb-3 size-5 text-muted-foreground" />
                      <p className="text-sm font-medium">{emptyFindingTitle(!!active, !!engine.last_scan_at)}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {active
                          ? "Lens is reviewing the selected activity."
                          : "Findings reflect the runs analyzed, not a guarantee about all activity."}
                      </p>
                    </div>
                  )}
                </div>
              </TabsContent>
              <TabsContent value="checks" className="pt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">What this lens looks for in your runs</p>
                  {!readOnly && (
                    <Button variant="outline" size="sm" onClick={() => setEditing("edit")}>
                      Edit questions
                    </Button>
                  )}
                </div>
                {engine.settings.context && (
                  <div className="rounded-lg bg-muted/40 p-4">
                    <p className="text-xs font-medium">Agent context</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm">{engine.settings.context}</p>
                  </div>
                )}
                {engine.settings.checks.map((c) => (
                  <div key={c.id} className="flex items-start gap-3 rounded-lg border p-4">
                    <Layers3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <p className="text-sm flex-1">{c.instruction}</p>
                    {!readOnly && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          update(
                            `/engine/${engine.id}`,
                            {
                              ...engine.settings,
                              checks: engine.settings.checks.map((q) =>
                                q.id === c.id ? { ...q, enabled: !q.enabled } : q,
                              ),
                            },
                            "put",
                          )
                        }
                      >
                        {c.enabled ? "Disable" : "Enable"}
                      </Button>
                    )}
                  </div>
                ))}
                {!readOnly && (
                  <Button
                    variant="outline"
                    disabled={!!active || !connected}
                    onClick={() => update(`/engine/${engine.id}/runs`, { lookback_hours: 24 })}
                  >
                    Recheck the last 24 hours
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">
                  Changes apply to future scans. Rechecking history uses your analysis budget.
                </p>
              </TabsContent>
              <TabsContent value="activity" className="pt-4 space-y-3">
                {engine.jobs?.map((j) => (
                  <div key={j.id} className="rounded-lg border p-4">
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="font-medium">{j.stage}</span>
                      <span>{money(j.cost ?? 0)}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {when(j.created_at)} · Settings version {j.revision}
                    </p>
                    <p className="mt-3 text-sm">
                      {j.coverage?.screened ?? 0} reviewed / {j.coverage?.eligible ?? 0} eligible ·{" "}
                      {j.coverage?.investigated ?? 0} patterns investigated
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {j.coverage?.partial ?? 0} partial executions · {j.coverage?.unassessable ?? 0} could not be
                      assessed
                    </p>
                    {j.error && <p className="mt-2 text-sm text-destructive">{j.error}</p>}
                  </div>
                ))}
              </TabsContent>
            </Tabs>
          </section>
        </div>
      )}
      {editing && (
        <EngineSetup
          initial={editing === "edit" ? engine?.settings : undefined}
          models={models.data?.data.map((m) => m.id) ?? []}
          accessToken={accessToken}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
      {workerSetup && (
        <WorkerSetup
          accessToken={accessToken}
          workers={query.data?.workers ?? []}
          onClose={() => setWorkerSetup(false)}
          onChanged={refresh}
        />
      )}
      <Sheet
        open={!!finding}
        onOpenChange={(open) => {
          if (!open) setFindingId(null);
        }}
      >
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          {finding && (
            <>
              <SheetHeader>
                <SheetTitle>{finding.title}</SheetTitle>
                <SheetDescription>
                  {finding.priority} priority · {finding.status} · {finding.occurrences?.length ?? 0} observed
                  executions
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-6 p-4">
                <p className="text-sm leading-6 whitespace-pre-wrap">{finding.description}</p>
                {finding.suggestion && (
                  <div className="rounded-lg bg-muted/40 p-4">
                    <p className="text-sm font-medium">Suggested next step</p>
                    <p className="mt-2 text-sm leading-6">{finding.suggestion}</p>
                  </div>
                )}
                <div>
                  <p className="mb-3 text-sm font-medium">Evidence</p>
                  <div className="space-y-3">
                    {finding.evidence.map((e, i) => (
                      <div key={`${e.execution_id}-${e.span_id}-${i}`} className="rounded-lg border p-3">
                        <blockquote className="text-sm whitespace-pre-wrap break-words">{e.quote}</blockquote>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-2"
                          onClick={() => {
                            setRequestOffset(0);
                            setEvidence({ id: e.execution_id, span: e.span_id });
                          }}
                        >
                          {evidenceTarget(e.execution_id)?.source === "traces" ? "Open trace" : "Open request"}
                          <ArrowUpRight className="size-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
                {!readOnly && (
                  <div className="space-y-3 border-t pt-4">
                    <label className="grid gap-2 text-sm">
                      Feedback (optional)
                      <Textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="What should Lens know about this finding?"
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={busy}
                        onClick={() => changeFinding(finding.status === "resolved" ? "open" : "resolved")}
                      >
                        {finding.status === "resolved" ? "Reopen" : "Resolve"}
                      </Button>
                      <Button disabled={busy} variant="outline" onClick={() => changeFinding("dismissed")}>
                        Dismiss
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      {engine && target?.source === "traces" && (
        <TraceDrawer
          open={!!evidence}
          traceId={target.id}
          initialSpanId={evidence?.span}
          accessToken={accessToken}
          onClose={() => setEvidence(null)}
        />
      )}
      <Sheet
        open={target?.source === "requests"}
        onOpenChange={(open) => {
          if (!open) setEvidence(null);
        }}
      >
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Request evidence</SheetTitle>
            <SheetDescription>Original logged input and output</SheetDescription>
          </SheetHeader>
          <div className="p-4 space-y-3">
            {requestEvidence.isLoading && <p role="status">Loading request…</p>}
            {requestEvidence.error && <p role="alert">{requestEvidence.error.message}</p>}
            {requestEvidence.data?.parts.map((p) => (
              <pre className="whitespace-pre-wrap break-words text-xs" key={p.span_id}>
                {p.content}
              </pre>
            ))}
            {requestEvidence.data?.parts.length === 0 && <p>Request was not found or is past retention</p>}
            <div className="flex gap-2">
              {requestOffset > 0 && (
                <Button variant="outline" onClick={() => setRequestOffset(requestOffset - 8000)}>
                  Previous section
                </Button>
              )}
              {requestEvidence.data?.parts.some((p) => p.truncated) && (
                <Button variant="outline" onClick={() => setRequestOffset(requestOffset + 8000)}>
                  Next section
                </Button>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </main>
  );
}

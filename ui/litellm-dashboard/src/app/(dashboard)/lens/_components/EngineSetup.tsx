"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { apiClient } from "@/components/networking";
import { filtersFromText, starterQuestions, type Sample, type Settings } from "./engineData";

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

export function EngineSetup({
  initial,
  models,
  accessToken,
  onClose,
  onSave,
}: {
  initial?: Settings;
  models: string[];
  accessToken: string;
  onClose: () => void;
  onSave: (settings: Settings) => Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initial?.name ?? "");
  const [source, setSource] = useState<Settings["source"]>(initial?.source ?? "traces");
  const [service, setService] = useState(initial?.service ?? "");
  const [filters, setFilters] = useState(initial?.filters?.map((f) => `${f.key}=${f.value}`).join("\n") ?? "");
  const [context, setContext] = useState(initial?.context ?? "");
  const [questions, setQuestions] = useState(
    initial?.checks.map((c) => c.instruction).join("\n") ?? starterQuestions.join("\n"),
  );
  const [model, setModel] = useState(initial?.model ?? models[0] ?? "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [budget, setBudget] = useState(initial?.monthly_budget ?? 20);
  const [sampleSize, setSampleSize] = useState(initial?.sample_size ?? 100);
  const [interval, setInterval] = useState(initial?.interval_minutes ?? 15);
  const [preview, setPreview] = useState<Sample | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const settings = (): Settings => ({
    name: name.trim(),
    source,
    service: service.trim(),
    context,
    filters: filtersFromText(filters),
    model,
    enabled,
    monthly_budget: budget,
    sample_size: sampleSize,
    interval_minutes: interval,
    checks: questions
      .split("\n")
      .filter((q) => q.trim())
      .map((instruction) => {
        const previous = initial?.checks.find((c) => c.instruction === instruction.trim());
        return previous ?? { id: crypto.randomUUID(), instruction: instruction.trim(), enabled: true };
      }),
  });
  const execute = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };
  const next = () => {
    try {
      filtersFromText(filters);
      if (!name.trim()) throw new Error("Give this lens a name");
      if (step === 1 && !questions.trim()) throw new Error("Add at least one question");
      setError("");
      setStep(step + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check your settings");
    }
  };

  const saveLabel = () => {
    if (busy) return "Saving…";
    if (initial) return "Save changes";
    return enabled ? "Start monitoring" : "Run analysis";
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit lens" : "Set up a lens"}</DialogTitle>
          <DialogDescription>
            {
              [
                "Choose the activity you want to understand",
                "Tell Lens what matters to you",
                "Choose when to analyze and how much to spend",
              ][step]
            }
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2" aria-label={`Step ${step + 1} of 3`}>
          {["Activity", "Questions", "Monitoring"].map((label, i) => (
            <div
              key={label}
              className={`flex-1 border-t-2 pt-2 text-xs ${i <= step ? "border-foreground text-foreground" : "border-border text-muted-foreground"}`}
            >
              {i + 1}. {label}
            </div>
          ))}
        </div>
        <div className="space-y-4">
          {step === 0 && (
            <>
              <label className="grid gap-2 text-sm">
                Name
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Research quality"
                  maxLength={100}
                />
              </label>
              <label className="grid gap-2 text-sm">
                Review
                <select
                  className={selectClass}
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value as Settings["source"]);
                    setPreview(null);
                  }}
                >
                  <option value="traces">Agent traces</option>
                  <option value="requests">LLM request logs</option>
                  <option value="both">Agent traces and request logs</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm">
                Service or model group{" "}
                <span className="text-xs text-muted-foreground">
                  Optional. Leave blank to include all accessible activity.
                </span>
                <Input
                  value={service}
                  onChange={(e) => {
                    setService(e.target.value);
                    setPreview(null);
                  }}
                  placeholder="All services"
                />
              </label>
              <label className="grid gap-2 text-sm">
                Metadata filters{" "}
                <span className="text-xs text-muted-foreground">
                  Optional. One key=value per line. All filters must match. Use tag=value for request tags.
                </span>
                <Textarea
                  value={filters}
                  onChange={(e) => {
                    setFilters(e.target.value);
                    setPreview(null);
                  }}
                  placeholder={"environment=production\nswarm=research"}
                  rows={3}
                />
              </label>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  execute(async () => {
                    const data = await apiClient.post<Sample>("/engine/preview/sample", {
                      accessToken,
                      body: {
                        settings: { ...settings(), name: name.trim() || "Preview", model: model || "preview" },
                        lookback_hours: 24,
                      },
                    });
                    setPreview(data);
                  })
                }
              >
                {busy ? "Checking…" : "Preview matching runs"}
              </Button>
              {preview && (
                <div className="rounded-lg border p-3 text-sm" role="status">
                  <p>{preview.eligible} matching executions in the last 24 hours</p>
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {preview.executions.slice(0, 3).map((e) => (
                      <li key={e.id}>
                        {e.name} · {e.span_count} steps
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          {step === 1 && (
            <>
              <label className="grid gap-2 text-sm">
                What does a good run look like?
                <Textarea
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  rows={3}
                  placeholder="Our swarm researches a question and produces a cited report that incorporates the fact-checker's corrections."
                />
              </label>
              <label className="grid gap-2 text-sm">
                Questions & checks
                <Textarea value={questions} onChange={(e) => setQuestions(e.target.value)} rows={7} />
              </label>
              <p className="text-xs text-muted-foreground">
                One instruction per line. Ask about usage patterns, successful behavior, or a specific problem. Findings
                include evidence from your runs.
              </p>
            </>
          )}
          {step === 2 && (
            <>
              <label className="grid gap-2 text-sm">
                Analysis model
                <select className={selectClass} value={model} onChange={(e) => setModel(e.target.value)}>
                  <option value="">Choose a model</option>
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-muted-foreground">
                Trace content is sent to this model through LiteLLM. Choose a model approved for your data.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <label className="grid gap-2 text-sm">
                  Monthly limit (USD)
                  <Input
                    type="number"
                    min="0.01"
                    step="1"
                    value={budget}
                    onChange={(e) => setBudget(Number(e.target.value))}
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  Runs per scan
                  <Input
                    type="number"
                    min="1"
                    max="500"
                    value={sampleSize}
                    onChange={(e) => setSampleSize(Number(e.target.value))}
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Keep
                monitoring in the background
              </label>
              {enabled && (
                <label className="grid gap-2 text-sm">
                  Check for activity
                  <select
                    className={selectClass}
                    value={interval}
                    onChange={(e) => setInterval(Number(e.target.value))}
                  >
                    <option value={15}>Every 15 minutes</option>
                    <option value={60}>Every hour</option>
                    <option value={1440}>Every day</option>
                  </select>
                </label>
              )}
              <div className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
                {initial
                  ? "Changes apply to future scans. You can recheck recent runs from the lens page."
                  : "The first scan reviews the last 24 hours. You can leave this page while it runs."}{" "}
                Larger workloads are sampled; coverage is shown with every scan.
              </div>
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => (step ? setStep(step - 1) : onClose())}>
            {step ? "Back" : "Cancel"}
          </Button>
          {step < 2 ? (
            <Button onClick={next}>Continue</Button>
          ) : (
            <Button disabled={busy || !model || budget <= 0} onClick={() => execute(() => onSave(settings()))}>
              {saveLabel()}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

# Lens worker

Lens reviews recorded activity and saves evidence-linked findings in the LiteLLM dashboard under Observability, Lens

## Start a worker

Use a LiteLLM proxy built from this branch with PostgreSQL, agent tracing (`general_settings.tracing: {store: clickhouse}`), and ClickHouse configured through `CLICKHOUSE_URL`. Enable the ClickHouse callback and request/response logging to analyze LLM requests. Lens can only inspect content you actually retain

In Lens, click **Connect worker**, then **Create worker credential**. Save the credential in a secret manager or a local environment file readable only by the operator. It is shown once

```dotenv
LITELLM_URL=https://your-litellm-proxy.example
LENS_WORKER_TOKEN=your-worker-credential
```

From this checkout, on the same host or another server:

```bash
docker compose --env-file /path/to/lens.env -f deploy/lens/compose.yaml up -d --build
```

The worker needs outbound HTTPS access to LiteLLM. It needs no inbound ports, provider keys, direct database access, or GPU. The proxy calls your selected model through its configured router; trace content reaches that model provider. Use a model with JSON output support and known token prices. One worker handles one scan at a time and can serve multiple lenses. For more throughput, start another worker with a separate credential

V1 setup, manual runs, feedback, and worker credentials are restricted to proxy administrators. Admin viewers can inspect results. Worker credentials can serve the administrator’s lenses. Revoke it in the connection dialog when retiring a worker. Redeploy the worker alongside proxy upgrades so their API versions match

## Configure a lens

Choose traces, requests, or both. Leave service and filters blank for all activity your account can access. Filters are exact, top-level key/value matches, combined with AND. Trace filters match span or resource attributes on the same span. Request filters match logged metadata; `tag=value` matches request tags. `swarm=research` works only if your instrumentation records that attribute

Write a few questions, give context about a successful run, choose a model, and set the monthly limit and sample size. Creation queues the first scan over the last 24 hours. Background checks default to every 15 minutes. **Analyze now** checks activity since the last successful scan; **Recheck the last 24 hours** revisits recent history. The runs API accepts `lookback_hours` from 1 to 720 for other historical windows

Pausing stops future scheduled scans; cancel the active scan separately if needed. Closing the browser does not stop the worker. Configuration edits apply to the next scan. A running scan retains its settings and selected execution IDs across retries

## What a scan does

The proxy selects newly received or updated executions with a two-minute settling period and a five-minute overlap. Older rows without receipt timestamps use execution end time. Overlapping scans do not increment a finding's occurrence count for the same execution ID

A trace is spans sharing a trace ID within one team, not an automatically reconstructed conversation session. Requests are individual LLM calls. When both sources are enabled, requests correlated to a recorded span by response ID are excluded to reduce double counting

The worker screens a deterministic sample, at most the configured 1–500 executions. For each execution it reads up to 160 spans, with 8,000 characters per span section, and splits these into model calls. It groups the observations, then investigates at most 10 candidate patterns using up to five model turns each. The investigator can read more original content from the selected executions. It has no shell, browsing, code-editing, or production-action tools

Both the worker and proxy validate quoted evidence. Findings retain exact quotes and open the source trace or request. Resolve a finding after a fix, or dismiss it with a reason. A resolved finding reopens when new execution IDs support the same pattern; dismissed findings remain dismissed

Coverage distinguishes eligible, sampled, reviewed, partial, and unassessable executions. Findings describe observations in the sample, not population-wide success rates or proven causes. A root span does not prove that a trace contains every expected span. Long, missing, redacted, or expired content limits the conclusions

## Operations and limits

PostgreSQL stores configurations, findings and the latest 50 jobs. Workers claim jobs with optimistic concurrency and a five-minute lease, renewed every 30 seconds. A disconnected job can be reclaimed up to three times. Cancellation stops subsequent work; a model call already in flight may finish and incur cost

Before every model call, Lens reserves a conservative amount against the monthly lens budget. Successful calls reconcile to reported cost where pricing is available. Interrupted calls retain their reservation because the provider may have charged. A scan stops when the next reservation would exceed the limit, so it can stop with some budget remaining. Lens budgets are separate from virtual-key budgets; analysis calls use the proxy router directly

V1 requires ClickHouse for both sources. It does not reconstruct sessions from unrelated trace IDs, guarantee exhaustive reviews, cache all per-execution observations across scans, or automatically fix agent code. Trace contents can change as late spans arrive, even though a job's selected IDs are fixed. Findings should be reviewed by a person before acting on them

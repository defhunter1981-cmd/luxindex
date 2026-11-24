# Apify CheapAPI run investigation

Status: **open — root cause unconfirmed**
Scope: `cheapapi~google-shopping-scraper` via
`POST /v2/actors/cheapapi~google-shopping-scraper/run-sync-get-dataset-items`
Safety: `APIFY_ENABLED=false`. No live runs were executed during this
investigation. Everything below is derived from the recorded run metadata,
request construction in code, and Apify's documented sync-run semantics.

---

## 1. Reported observation

| Field | Value |
| --- | --- |
| Actor | `cheapapi~google-shopping-scraper` |
| Run ID | `Nz3z95wuw1sXOxoGd` |
| Terminal status | `FAILED` |
| Wall-clock duration | ≈ 2 s |
| Billed cost | ≈ $0.000131 |
| Dataset items | 0 |
| Provider result in LuxeIndex | `ok:false`, zero items, fallback to curated baseline |

The run **started and billed**, then failed almost immediately. It did not hang
(timeouts are configured at 120 s) and it was not rejected at the gate (a
gate rejection produces `skipped:true` with `usageMetadata.estimatedCostUsd = 0`
and no billing).

## 2. What the code actually sends

`buildApifyActorInput()` (`lib/providers/apifyProvider.js`) produces:

```json
{
  "mode": "search",
  "searchTerms": ["<query>"],
  "country": "IN",
  "language": "en",
  "maxProductsPerSearch": 5,
  "maxPages": 1,
  "sortBy": "relevance",
  "offersForTopProducts": 0,
  "includeSponsored": false,
  "includeCarousels": false,
  "monitorPrices": false
}
```

Request URL adds `timeout` (10–300 s) and `maxTotalChargeUsd` (≤ $0.05,
derived from the budget ledger) as query parameters. Authentication is a
`Authorization: Bearer <APIFY_API_TOKEN>` header — never a query parameter.

## 3. Failure-path analysis (pre-fix)

Before this change, `classifyProviderError()` mapped error text in this order:
timeout → captcha → auth → rate-limit → invalid-JSON → **`includes("empty")`
→ `EMPTY_RESULTS`** → `PROVIDER_UNAVAILABLE`.

Consequences:

1. **A failed run could be counted as a healthy negative.** Any status message
   containing the word "empty" (e.g. "dataset empty", "no items, empty result")
   was classified `EMPTY_RESULTS`. `settleApifyRunSlot()` and
   `recordProviderFailure()` both treat `EMPTY_RESULTS` as a *successful* call:
   the failure streak resets, the circuit breaker never opens, and the budget
   ledger records `requestsSucceeded += 1`. A genuinely broken Actor would
   therefore stay "healthy" indefinitely.
2. **Actor failures lacked actionable context.** Only the human-readable
   `error.message` was surfaced. The run ID, terminal status, and exit code were
   discarded, so an operator could not correlate a failure with an Apify console
   run without manually searching by timestamp.
3. **An empty dataset with failure metadata was indistinguishable** from a real
   empty result. Both returned `ok:true`, `errorType:"EMPTY_RESULTS"`.

## 4. Hypotheses (ordered, none confirmed)

| # | Hypothesis | Evidence for | Evidence against | How to confirm |
| --- | --- | --- | --- | --- |
| H1 | Actor input schema mismatch — the Actor expects different field names or enum values than `buildApifyActorInput()` emits, and rejects the input at start. | Failure in ~2 s with near-zero cost is typical of immediate input validation. | The same payload shape is used by the mocked contract tests; no schema snapshot of the published Actor input exists in the repo. | Fetch the Actor's input schema (`GET /v2/acts/cheapapi~google-shopping-scraper` → `inputSchema`) and diff against `buildApifyActorInput()`. |
| H2 | Upstream Google Shopping anti-bot / blocking on the Apify worker's egress IP. | Google Shopping is aggressively bot-protected; a 2 s failure is plausible if the first request is challenged. | A CAPTCHA block usually surfaces a specific message; we do not have the run log to check. | Inspect the run log (`GET /v2/actor-runs/Nz3z95wuw1sXOxoGd/log`). |
| H3 | Actor-side runtime error (crash, missing dependency, Actor version drift). | CheapAPI Actors are third-party and can be updated without notice; a crash right after start matches. | Unknown — no log access. | Run log + Actor version pinned at run time. |
| H4 | `maxTotalChargeUsd` cap too low for the Actor's minimum charge. | The cap is set to ≤ $0.05 from the ledger; if the Actor enforces a higher minimum it may abort. | Actual billed cost was $0.000131, i.e. far below any plausible minimum. | Check Apify docs for the Actor's minimum charge and the run's `chargedAmount`. |
| H5 | Account/plan restriction (e.g. Actor requires a paid plan or a specific proxy group). | Immediate failure with trivial billing is consistent with a platform-level refusal after start. | Auth failures are normally rejected before a run is created and are not billed. | Apify console → run detail → error banner. |

## 5. Unknowns (explicitly not guessed)

- The exact `statusMessage` / exit code of run `Nz3z95wuw1sXOxoGd` — **not
  available** without reading the run log, which was not accessed.
- Whether the Actor's input schema matches `buildApifyActorInput()` today.
- Whether the failure is deterministic (same query) or transient.
- Whether the zero items were due to the failure itself or to a genuinely empty
  result set that was then reported as a failure.
- The Actor version that executed.

These require either the Apify console/run log or a single authorized live run.
**No live run was performed.**

## 6. Changes made (defensive, no behavior change for healthy runs)

### `lib/search/quotaManager.js`

- Added `ERROR_TYPES.ACTOR_RUN_FAILED`.
- `classifyProviderError()` now detects Actor run failures **before** the
  generic `"empty"` substring match, using:
  - structured signals: `error.type ∈ {actor-run-failed, actor_run_failed}` or
    `error.status ∈ {FAILED, ABORTED, TIMED-OUT, TIMED_OUT}`;
  - message signals: `actor-run-failed`, `actor run failed`,
    `actor run did not finish`, `run did not succeed`,
    `actor execution failed`.
- `ACTOR_RUN_FAILED` is a real failure: it increments the failure streak and can
  open the circuit after the configured threshold, unlike `EMPTY_RESULTS`.

### `lib/providers/apifyProvider.js`

- Added `extractApifyRunMetadata(payload, headers)` which pulls only
  non-secret identifiers — `runId`, `status`, `exitCode`, `statusMessage` — from
  `error.*`, `run.*`, `actorRun.*`, `data.run.*`, `meta.*`, or the
  `x-apify-actor-run-*` response headers.
- Failure responses now include `runMetadata` at the top level and inside
  `usageMetadata`, and append a compact suffix such as
  `[run Nz3z95wuw1sXOxoGd, status FAILED, exit 1]` to `errorMessage`.
- The empty-dataset branch now checks run status first: an empty dataset from a
  `FAILED`/`ABORTED`/`TIMED-OUT` run returns `ok:false` +
  `ACTOR_RUN_FAILED` and is settled as a failure; a successful run with an empty
  dataset still returns `ok:true` + `EMPTY_RESULTS` (unchanged).
- All `statusMessage` values pass through `redactSecrets()`; the API token is
  never included in metadata, messages, or diagnostics.

### Tests

`scripts/test-multi-provider.mjs` §16 gained three scenarios (now 23 total):

1. `classifyProviderError` taxonomy: genuine empty → `EMPTY_RESULTS`;
   "actor run failed … dataset empty" → `ACTOR_RUN_FAILED`; structured
   `error.type` / `error.status` → `ACTOR_RUN_FAILED`.
2. A mocked HTTP 200 payload with `error.type:"actor-run-failed"` and the words
   "dataset empty" returns `ok:false`, `ACTOR_RUN_FAILED`, surfaces
   `runMetadata`, records the failure in diagnostics, and does not leak the
   token.
3. A mocked HTTP 200 payload with `run.status:"FAILED"` and `items: []` returns
   `ok:false` + `ACTOR_RUN_FAILED` (empty-branch guard).

## 7. Recommended next step (requires authorization)

1. Read the run log and `chargedAmount` for `Nz3z95wuw1sXOxoGd` in the Apify
   console (read-only, no spend).
2. Diff the published input schema against `buildApifyActorInput()`.
3. Only if 1–2 are inconclusive, perform **one** authorized live run with
   `APIFY_ENABLED=true`, a single query, `maxProductsPerSearch=1`, and the
   existing budget cap, then immediately set `APIFY_ENABLED=false` again.

Until then, Apify remains a **controlled fallback** with fail-closed budget
protection and concurrency limits, and `APIFY_ENABLED` stays `false`.

# Sprint 1 pilot study

Measures how accurate, how stable, how fast and how expensive the existing
Technical Credit detector is on a small labelled dataset. The prompts and
detection logic are not changed. The runner reuses the production path:
`buildContextFromSource` → `createUserPrompt` → one `callClaude` per heuristic,
in parallel, as `analyseForTC` does.

This file is the pre-registration. The dataset, labels, metrics and hypotheses
below were committed before the first billed run, and the results of every run
are committed under `study/runs/`.

## Running it

```bash
npm ci
export ANTHROPIC_API_KEY=...        # or put it in the repo-root .env
npm run pilot -- run                # 6 items × 5 repeats × 8 heuristics = 240 calls
npm run pilot -- report study/runs/<run-id>   # re-score a run offline
npx jest src/study                  # offline unit tests, no API calls
```

| Option / variable | Default             | Meaning                                          |
| ----------------- | ------------------- | ------------------------------------------------ |
| `--repeats`       | 5                   | Analyses per item                                |
| `--concurrency`   | 2                   | Analyses in flight (each makes 8 parallel calls) |
| `--items`         | all                 | Comma-separated item ids                         |
| `--out`           | `study/runs/<time>` | Output directory                                 |
| `TC_MODEL`        | `claude-sonnet-4-6` | Model, resolved by `src/utils/claude.ts`         |
| `TC_TEMPERATURE`  | `0`                 | Temperature (`none` omits it)                    |

Each run writes `config.json` (model, temperature, commit, items, repeats),
`calls.jsonl` (one line per call: verdict, error, latency, returned model,
tokens), `analyses.jsonl` (wall-clock time per analysis), `results.json` and
`results.md`. Token usage is captured through `setClaudeCallListener`, so cost
is measured, not estimated.

## Scope

Three GoF pattern pairs, the plan's fallback scope. Each pair has a **credit**
twin, where the pattern pays off, and a **no-credit** twin, a look-alike where
it does not.

| Pair     | Credit twin (primary category)                                                    | No-credit twin                                                    |
| -------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| strategy | `QuoteService` picks an injected `RateRule` from a property (configurability)     | Same shape, but one `RateRule` built inline with `new`, no config |
| adapter  | `EmailNotifier` implements a domain `Notifier` over a vendor client (abstraction) | `EmailSender` forwards vendor calls one-for-one, no interface     |
| observer | `StockLevels` with runtime subscribe/unsubscribe of listeners (modularity)        | Same shape, but one listener hard-wired with `new`                |

The analysed construct (the anchor) is the public class in each file. Only the
anchor's source, its imports and its tree-sitter metrics reach the model, as in
the extension.

### Leak reduction

- No comments in any item, and a single neutral package (`app`). Domain-named
  packages are a modularity signal in the current prompts.
- Neutral type names: no `Strategy`, `Adapter`, `Observer`, `Builder` or
  similar suffixes, which the abstraction prompt rewards directly.
- Twins match in size: anchors within 30% of each other's line count (checked by
  `src/study/labels.test.ts`). Two of three no-credit twins keep the pattern's
  structure (interface plus implementation), so the detector cannot win by
  spotting an interface.

## Labels

One `label.json` per item, validated by `src/study/labels.ts`. Labels have three
dimensions, so the dataset survives the upstream move from 8 TC categories to
GoF categories and patterns (cielbellerose/TechnicalCredit#145):

1. **`tc`**: item-level yes/no. This is the twin contrast and does not depend
   on the taxonomy.
2. **`categories`**: `yes`, `no` or `unsure` for **every** one of the 8 current
   categories. A construct can carry several kinds of credit, so scoring a
   single category would count correct secondary firings as false positives.
   `unsure` pairs are excluded from precision and recall.
3. **`designPatterns`**: the GoF patterns the anchor structurally plays a central
   role in, whether or not they pay off. This is the PR #145 taxonomy. It also
   drives the pattern-presence baseline.

Labels were written by one person (the study author) before any run, from the
code and the category definitions in `src/prompts/heuristics/`, and each label
records a rationale.

## Metrics

Unit of analysis: the **(item, category) pair**, 6 × 8 = 48 pairs. For each pair,
the detector's answer is the majority vote of `is_tc_candidate` across repeats
for that category's call. Ties and pairs where every call errored are unscored.

- **Flip rate (headline):** share of pairs with at least 2 valid votes whose
  repeats disagree. Also reported at item level.
- **Pooled precision, recall, F1, accuracy (headline):** over all scored pairs.
  Per-category results are shown as raw counts only; with one positive item
  per category, percentages would not mean much.
- **Item-level accuracy:** an item is predicted TC when any category fires
  (majority across repeats). This matches what the user sees: any annotation at
  all.
- **Primary-category hit:** on credit twins, did the call for the labelled
  primary category fire?
- **Twin discrimination:** per pair, the primary category fires on the credit
  twin and not on its no-credit twin.
- **Mean categories firing per analysis:** credit vs. no-credit twins.
- **Category drift:** share of fired answers whose `category` field differs
  from the heuristic that was asked.
- **Cost** (measured tokens × list price, `src/study/pricing.ts`), **latency**
  (p50/p95 per analysis), and the **error rate**.

### Baselines

| Baseline                | Level | Prediction                                    |
| ----------------------- | ----- | --------------------------------------------- |
| Always yes / always no  | pair  | Every category fires / none fires             |
| Always yes / always no  | item  | Every item is TC / none is                    |
| Pattern-presence oracle | item  | TC exactly when `designPatterns` is non-empty |

The pattern-presence oracle is a perfect pattern detector. Beating it means the
detector separates credit from mere pattern use, which the plan calls the core
question ("pattern detection is not credit detection").

## Hypotheses (pre-registered)

Thresholds are fixed in `evaluateHypotheses` (`src/study/metrics.ts`) and
evaluated mechanically for every run.

| ID  | Hypothesis                                                                                  |
| --- | ------------------------------------------------------------------------------------------- |
| H1  | Flip rate is below 5% of (item, category) pairs (doc target)                                |
| H2  | The primary category fires on at least 2 of 3 credit twins                                  |
| H3  | In at least 2 of 3 pairs, the credit twin's primary fires and the no-credit twin's does not |
| H4  | Pooled pair-level F1 beats always-yes, and accuracy beats always-no                         |
| H5  | Item-level accuracy beats the pattern-presence oracle                                       |
| H6  | p95 latency per analysis is below 10 s (doc target)                                         |

## Threats to validity

- **Construction bias:** the same person wrote the twins and their labels. The
  dataset is synthetic and built to target labels. No second labeller was
  available for the pilot, so labeller agreement is not reported.
  Mitigations: labels and rationales were committed before the run, and
  ambiguous verdicts are labelled `unsure` instead of being forced.
- **Small n:** 6 items and 48 pairs. Results are indicative. Per-category
  numbers are counts, not estimates, and five categories have no positive item
  at all (only their false positives are observable).
- **Synthetic code:** short, clean classes may not transfer to real
  repositories. The previous manual run on iluwatar/java-design-patterns is
  anecdotal support only.
- **Size and structure confounds:** reduced but not removed. Credit twins still
  have more implementations in the same file. The model only sees the anchor
  class, though.
- **Temperature:** runs use the configured default (0). Flip rate at the API
  default temperature of 1 would likely be higher.
- **Model drift:** the model id the API returned is logged per call, and
  results are tied to the run date.
- **Taxonomy change:** PR #145 replaces the 8 categories with GoF categories.
  Pair-level results apply to today's detector. The item-level and twin
  results, and the `designPatterns` labels, carry over.

## Budget

At list price for `claude-sonnet-4-6` ($3 / $15 per million tokens), a call
costs about $0.01–0.02, so the full pilot (240 calls) is expected to cost
**under $5**. That is inside the plan's $11 estimate for a larger set. The run
report states the measured cost.

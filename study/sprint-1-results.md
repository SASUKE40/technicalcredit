# Sprint 1 pilot: results and interpretation

Two identical runs of the pilot described in [README.md](README.md), each with
`claude-sonnet-4-6` at temperature 0, 6 items × 5 repeats × 8 heuristics = 240
calls:

| Run                                                                                          | Commit                          | Cost  | Errors |
| -------------------------------------------------------------------------------------------- | ------------------------------- | ----- | ------ |
| [`2026-11-17-sonnet-4-6-5fedccc`](runs/2026-11-17-sonnet-4-6-5fedccc/results.md) (reference) | `5fedccc`                       | $1.66 | 0      |
| [`2026-11-17-sonnet-4-6`](runs/2026-11-17-sonnet-4-6/results.md)                             | pre-rebase `f48212d`, same code | $1.67 | 0      |

The reference run is the one on a commit in `main`. The earlier run is kept as
a replication. Every scored number matches between the two runs except the
ones noted below. Total pilot spend, including an 8-call smoke test, was
$3.40.

## Headline

| Metric                                    | Reference run        | Earlier run    | Target or baseline      |
| ----------------------------------------- | -------------------- | -------------- | ----------------------- |
| Pair-level flip rate                      | 2.1% (1 of 48 pairs) | 0.0%           | < 5% (H1)               |
| Item-level accuracy (does anything fire?) | 4/6                  | 4/6            | pattern oracle 4/6 (H5) |
| Pooled pair-level F1                      | 26.7%                | 26.7%          | always-yes 19.6% (H4)   |
| Pooled pair-level accuracy                | 76.1%                | 76.1%          | always-no 89.1% (H4)    |
| Primary category fires on credit twin     | 2/3                  | 2/3            | ≥ 2/3 (H2)              |
| Twin pairs discriminated                  | 2/3                  | 2/3            | ≥ 2/3 (H3)              |
| Fired answers naming another category     | 62.3%                | 63.6%          | —                       |
| Latency per analysis, p50 / p95           | 7.6 s / 9.1 s        | 7.9 s / 10.1 s | p95 < 10 s (H6)         |
| Cost per analysis (8 calls)               | $0.055               | $0.056         | —                       |

Pre-registered hypotheses on the reference run: **H1, H2, H3 and H6 pass; H4
and H5 fail.** H6 failed in the earlier run by 0.1 s, so latency sits right at
the target. Treat it as borderline, not as met.

## What this means

### 1. The detector is stable, and stability is not the problem

At temperature 0, 47 of 48 (item, category) verdicts were identical across 5
repeats, and across both runs (10 repeats). The one unstable verdict was
`api-stability` on the adapter credit twin (3 of 5 in one run, 5 of 5 in the
other). Because that was the only category firing on that item, the item-level
flip rate reads 16.7% (1 of 6 items). Temperature 0 reduces variance but does
not remove it.

### 2. It does not separate credit from pattern use

Item-level accuracy equals a perfect "is there a GoF pattern here?" oracle.
The two look-alikes that keep the pattern's shape, a one-implementation
strategy and a hard-wired observer, are both flagged as TC on every repeat.
The adapter look-alike, a plain forwarder with no interface, is correctly left
alone. So the signal today is closer to "this class uses interfaces" than to
"this design pays off". That was the plan's core concern, and the pilot
supports it.

The credit twins do draw more firing categories than the look-alikes (2.5 vs
1.0 per analysis). A threshold on that count, rather than "any category
fires", might separate them. That is an exploratory idea to test, not a
result.

### 3. Each heuristic call answers a different question from the one asked

This is the most actionable finding. Each call asks about one category, but
when a call fires, the `category` it reports is often another one:

| Heuristic asked   | Fired answers | Category the model reported            |
| ----------------- | ------------- | -------------------------------------- |
| `api-stability`   | 48            | `abstraction` 38, `configurability` 10 |
| `automation`      | 10            | `configurability` 10                   |
| `reusability`     | 10            | `configurability` 10                   |
| `configurability` | 10            | `configurability` 10                   |
| `modularity`      | 30            | `modularity` 30                        |

(Both runs combined. `abstraction`, `observability` and `compliance-readiness`
never fired.)

`analyseForTC` overwrites the reported category with the heuristic that was
asked (`src/analyse.ts`). So users see "api-stability" annotations whose
reasoning is about abstraction, and three different annotations on the
strategy class that all describe its configurability.

**Exploratory, not pre-registered:** scoring by the category the model
_reported_ instead of the one asked raises pooled F1 from 26.7% to 67% and
accuracy from 76.1% to 91.3%. That beats always-no (89.1%) in both runs. The
remaining errors are three false positives on the look-alikes (`abstraction`
on the strategy and observer twins, `modularity` on the strategy twin) and one
miss (`abstraction` on the strategy credit twin). That fits finding 2: the model
recognises the right kind of credit, but it still credits structure that has
no payoff.

### 4. Two prompts carry most of the pair-level errors

- **`abstraction` never fires**, including on the clear adapter. Its checklist
  needs a score of 2 or more from indicators such as interface-typed fields or
  constructor parameters (P2, P3), a suffix like `Adapter` or `Strategy` (P5),
  or an interface defined in the snippet (P1). Only the anchor class is sent,
  so the interface it implements is not in view. The leak-reduced items use
  neutral names, and the adapter's field is the concrete vendor client. On
  real code, P5 makes this prompt partly a naming detector.
- **`api-stability` fires on 5 of 6 items**, all of them false positives
  against the labels. It is a loose bullet list with no decision rule. Its
  first bullet ("methods returning interface or abstract types") overlaps the
  abstraction checklist. The reported categories show the model treats it as
  an abstraction question.

## Recommendations

1. **Stop discarding the model's category, or stop asking per category.** Either
   trust the reported `category` in `analyseForTC` (and deduplicate
   annotations per category), or make one call that returns every category
   that applies. The second option also needs one call per analysis instead of eight. Both are
   compatible with the GoF restructure in cielbellerose/TechnicalCredit#145,
   which already moves to "category → design pattern" output. Re-run this
   pilot on whichever option is chosen; the harness supports it unchanged at
   item level.
2. **Give every heuristic the same structure.** `abstraction` has a scored
   checklist and a decision rule, while `api-stability` has neither. Remove
   the name-suffix indicator (P5), and either send the implemented interface
   with the anchor or count `implements <interface>` as evidence.
3. **Add a payoff test to the prompts.** For example, "more than one
   implementation is reachable" or "the variation point is actually used".
   The look-alikes only fail on payoff, and that is what H5 measures.
4. **Log the model's reasoning per call.** `calls.jsonl` records verdicts and
   tokens but not the `reasoning` text. With it, the explanations above would
   be evidence rather than inference from the prompts. This is a small runner
   change.
5. **Keep temperature 0 as the default.** It is almost stable at no extra
   cost. A temperature 1 run would show how much the setting matters.

## Limits

These are the threats in [README.md](README.md#threats-to-validity), restated
for the numbers above:

- **Small sample:** 6 synthetic items and 46 scored pairs.
- **One labeller:** the study author built the items and labels.
- **Unobservable recall:** five categories have no positive item, so only
  their false positives can be seen.
- **Exploratory re-scoring:** the reported-category numbers were chosen after
  seeing the data.

## Still open

- **Second labeller:** an independent person labels the 6 items blind from
  [README.md](README.md#labels), and we report agreement (Cohen's κ per
  category and on `tc`). This needs a human.
- **Temperature 1 run** (optional): `TC_TEMPERATURE=1 npm run pilot -- run`,
  about $1.70.
- **Rationale logging** (recommendation 4), then a re-run so the
  interpretation can cite the model's reasoning directly.

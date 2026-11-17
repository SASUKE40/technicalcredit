# Pilot run 2026-11-17-sonnet-4-6-5fedccc

- Started: 2026-11-17T16:12:40.366Z
- Commit: 5fedccc
- Models (as returned by the API): claude-sonnet-4-6
- Requested model / temperature: claude-sonnet-4-6 / 0
- Items × repeats × heuristics: 6 × 5 × 8 = 240 calls (0 errors)
- Tokens: 276210 in / 55208 out (240 calls with usage)
- Cost: $1.66 total, $0.055 per analysis
- Latency per analysis: p50 7.6 s, p95 9.1 s, max 9.3 s

## Hypotheses (pre-registered)

| ID | Hypothesis | Observed | Result |
| --- | --- | --- | --- |
| H1 | Flip rate is below 5% of (item, category) pairs | 2.1% | PASS |
| H2 | The primary category fires (majority) on at least 2/3 of credit twins | 2/3 | PASS |
| H3 | In at least 2/3 of pairs the credit twin's primary category fires and the no-credit twin's does not | 2/3 | PASS |
| H4 | Pooled pair-level F1 beats always-yes and accuracy beats always-no | F1 26.7% vs 19.6%; accuracy 76.1% vs 89.1% | FAIL |
| H5 | Item-level TC accuracy beats the pattern-presence oracle (credit is not just pattern detection) | 66.7% vs 66.7% | FAIL |
| H6 | p95 latency per analysis is below 10 s | 9.1 s | PASS |

## Headline

- Pair-level flip rate: 2.1%; item-level flip rate: 16.7%
- Mean categories firing per analysis: credit 2.53, no-credit 1.00
- Fired answers whose `category` differs from the heuristic asked: 62.3%

## Item level (does any category fire?)

| Scorer | n | TP | FP | FN | TN | Precision | Recall | F1 | Accuracy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Detector (majority of repeats) | 6 | 3 | 2 | 0 | 1 | 60.0% | 100.0% | 75.0% | 66.7% |
| Always yes | 6 | 3 | 3 | 0 | 0 | 50.0% | 100.0% | 66.7% | 50.0% |
| Always no | 6 | 0 | 0 | 3 | 3 | n/a | 0.0% | n/a | 50.0% |
| Pattern-presence oracle | 6 | 3 | 2 | 0 | 1 | 60.0% | 100.0% | 75.0% | 66.7% |

| Item | Label | Per repeat | Majority | Mean categories fired |
| --- | --- | --- | --- | --- |
| adapter-credit | TC | N N Y Y Y | TC | 0.6 |
| adapter-no-credit | not TC | N N N N N | not TC | 0.0 |
| observer-credit | TC | Y Y Y Y Y | TC | 2.0 |
| observer-no-credit | not TC | Y Y Y Y Y | TC | 1.0 |
| strategy-credit | TC | Y Y Y Y Y | TC | 5.0 |
| strategy-no-credit | not TC | Y Y Y Y Y | TC | 2.0 |

## Pair level (item × category, majority vote; "unsure" labels excluded)

| Scorer | n | TP | FP | FN | TN | Precision | Recall | F1 | Accuracy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Detector | 46 | 2 | 8 | 3 | 33 | 20.0% | 40.0% | 26.7% | 76.1% |
| Always yes | 46 | 5 | 41 | 0 | 0 | 10.9% | 100.0% | 19.6% | 10.9% |
| Always no | 46 | 0 | 0 | 5 | 41 | n/a | 0.0% | n/a | 89.1% |

Per-category counts (too few items for per-category percentages to mean much):

| Scorer | n | TP | FP | FN | TN | Precision | Recall | F1 | Accuracy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| abstraction | 6 | 0 | 0 | 3 | 3 | n/a | 0.0% | n/a | 50.0% |
| modularity | 4 | 1 | 1 | 0 | 2 | 50.0% | 100.0% | 66.7% | 75.0% |
| api-stability | 6 | 0 | 5 | 0 | 1 | 0.0% | n/a | n/a | 16.7% |
| automation | 6 | 0 | 1 | 0 | 5 | 0.0% | n/a | n/a | 83.3% |
| configurability | 6 | 1 | 0 | 0 | 5 | 100.0% | 100.0% | 100.0% | 100.0% |
| observability | 6 | 0 | 0 | 0 | 6 | n/a | n/a | n/a | 100.0% |
| reusability | 6 | 0 | 1 | 0 | 5 | 0.0% | n/a | n/a | 83.3% |
| compliance-readiness | 6 | 0 | 0 | 0 | 6 | n/a | n/a | n/a | 100.0% |

## Votes per pair

Cell = label (Y/N/?) then fired/valid repeats.

| Item | abstraction | modularity | api-stability | automation | configurability | observability | reusability | compliance-readiness |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| adapter-credit | Y 0/5 | ? 0/5 | N 3/5 | N 0/5 | N 0/5 | N 0/5 | N 0/5 | N 0/5 |
| adapter-no-credit | N 0/5 | N 0/5 | N 0/5 | N 0/5 | N 0/5 | N 0/5 | N 0/5 | N 0/5 |
| observer-credit | Y 0/5 | Y 5/5 | N 5/5 | N 0/5 | N 0/5 | N 0/5 | N 0/5 | N 0/5 |
| observer-no-credit | N 0/5 | N 0/5 | N 5/5 | N 0/5 | N 0/5 | N 0/5 | N 0/5 | N 0/5 |
| strategy-credit | Y 0/5 | ? 5/5 | N 5/5 | N 5/5 | Y 5/5 | N 0/5 | N 5/5 | N 0/5 |
| strategy-no-credit | N 0/5 | N 5/5 | N 5/5 | N 0/5 | N 0/5 | N 0/5 | N 0/5 | N 0/5 |

## Primary category and twin discrimination

| Pair | Credit primary category | Primary fired on credit twin | Twin discriminated |
| --- | --- | --- | --- |
| adapter | abstraction | no | FAIL |
| observer | modularity | yes | PASS |
| strategy | configurability | yes | PASS |

# Independent synthetic checks

These checks were authored separately from the implementation. They exercise the public modules and CLI with fake recordings only. They are software checks, not validation of real people, assistive devices, or deployment accuracy.

Run from the project root with Node 20 or newer:

```sh
node review/independent-check.mjs
```

No packages, network, capture software, existing outputs, or accounts are needed. The helper imports project modules through relative paths, creates and removes a temporary working directory, and regenerates `independent-report.json`. The report contains relative source names and their SHA-256 digests, with no machine-specific paths.

The recorded run passed **23 checks**. It checks both identities' mixed-style enrollment, independently recomputed FAR/FRR denominators and numerators, actual opposite-profile swaps, frozen profile bytes, refusal to overwrite, event/manifest label noninterference, clock normalization, parser validation, canonical training/test leakage rejection, raw and cosmetically changed held-out duplication rejection, checksum enforcement, invalid capped thresholds, hand-authored external JSONL through `train`/`score`/`test`, missing-class rates, abstention accounting, and a source-only fresh-copy demonstration. It also checks the separate speed-matched mimic variants without pooling them into the main sample count.

The independent run used enrollment/calibration/test seeds **8111 / 9337 / 17291**, distinct from the default demonstration's **101 / 202 / 303**. All profiles and thresholds were written before the helper's first held-out evaluation. This reviewer changed no feature, threshold, scale, or generator constants.

| Observed synthetic metric | Independent seeds | Fresh-copy default run |
| --- | ---: | ---: |
| Stranger accepted | 0 / 32 | 0 / 32 |
| Owner rejected or abstained | 3 / 32 | 1 / 32 |
| Tired owner rejected or abstained | 1 / 32 | 0 / 32 |
| Toy mimic accepted | 0 / 32 | 0 / 32 |
| Alpha owner opened beta profile | 0 / 64 | 0 / 64 |
| Beta owner opened alpha profile | 0 / 64 | 0 / 64 |

The independent hand-authored fixture contains both `onscreen` and `software` text sources and uses no shipped identity-generator parameters. Six recordings enroll, six calibrate, and a thirteenth is scored and evaluated through the CLI. That held-out recording was **rejected**; this check demonstrates the input/CLI contract, not successful recognition of a person. A separate sparse fixture abstains and counts as owner rejection.

The two seed sets still share the same invented generator family. Its personas are intentionally separable; its toy mimic only partly imitates trajectory shape/easing, and fatigue changes are limited. Zero observed accepts is not proof of zero false acceptance: the reported 95% Wilson upper bound for 0/32 is about 10.7%, even before considering that these are synthetic sessions rather than independent people. Sparse pointer/text workflows can abstain. The separate speed-matched trials are transformed versions of the same 32 mimic recordings, not additional independent observations. These limits remain unresolved by passing the software checks.

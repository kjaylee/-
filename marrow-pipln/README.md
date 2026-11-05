# Pipln input-profile prototype for Marrow

Marrow belongs to the requester; this independent prototype implementation is MIT-licensed.

Prepared by Pipln Workbench, an AI-operated development agent.

**A reproducible software experiment using fake data only. It is not validated human authentication and must not unlock real accounts.** Node 20 or newer is the only prerequisite. No packages, installation, network calls, capture software, audio or camera are used.

From a fresh copy, one command runs generation, training, calibration, tests, held-out scoring and both profile swaps:

```sh
node run.mjs demo
```

The command prints the synthetic metrics and the path to its new temporary output directory. Every run uses new output files; no existing frozen profile is overwritten. `example/` ships eight representative fake JSONL recordings (two styles × four labels), frozen profiles, hashes and the actual `report.json`. The generator recreates all full training/calibration/test fixtures in a new run; the complete generated dataset is not bundled. To reproduce into a new directory: `node run.mjs demo --out my-run`. To choose an independent test seed without changing enrollment/calibration: `node run.mjs demo --out another-run --test-seed 9173`.

## Method and its limits

The scorer consumes only ordinary pointer/click and text insertion/deletion events in [FORMAT.md](FORMAT.md). It does not use source/device/style labels, identity metadata, filenames, app names, actual text content or collection location. Click-delimited movements are resampled by arc length; geometric shape and relative timing, plus content-free correction/interval ratios, form a robust median/MAD enrollment profile. Uniform timing scale changes cancel. A profile trained on both synthetic styles is evaluated separately on standard mouse/keyboard and slow-pointer/software-inserted text, so recognizing the input style alone cannot pass the swap test.

Enrollment builds the center/spread. Owner-only calibration sets the threshold with the predeclared rule `q95(distance) * 1.10 + 0.05`. Calibration includes some synthetic slower sessions, but no held-out sessions, strangers or mimic labels. A calibration threshold reaching the capped score maximum of 10 is uninformative and refused. The complete threshold/profile is written and SHA-256-frozen before the first test score. Test cannot change it. If held-out errors are poor, report them; do not retune against that report. A sidecar checksum detects accidental changes, not a malicious person changing both files.

Insufficient or missing modalities abstain. Abstention counts as rejection in owner and tired-owner FRR. This is deliberately conservative: it can lock out someone whose usable signal is insufficient, and it does not establish equitable performance across disability, fatigue, eye gaze, switches, head mice or real dictation. The two fake styles are interoperability examples, not actual people or actual assistive devices. Motor parameters are intentionally separable invented families. The mimic copies input mode, mean motion duration, idle/click timing means and correction probability, while only partially imitating shape/easing; it is not an adaptive attacker. Event replay, forged recordings, copied complete distributions, or changed task geometry can defeat or confuse this method. There is no live trusted capture, liveness, replay defense or production security claim.

## Use your own correctly formatted recordings offline

```sh
node run.mjs train --enroll /data/my/enrollment --calibrate /data/my/calibration --out /data/new-profile.json
node run.mjs score --profile /data/new-profile.json --recording /data/new-session.jsonl
node run.mjs test --profile /data/new-profile.json --manifest /data/held-out.json --out /data/new-report.json
```

Directories recurse for `.jsonl`; repeated `--enroll`/`--calibrate` flags also accept individual files. At least six independent enrollment and six independent calibration recordings are required. Profiles and reports refuse overwrite. Copy the profile and adjacent `.sha256` file together. No subject labels or fixed path names are required. Any valid recording is parsed; one below coverage requirements returns abstention. Malformed inputs fail explicitly.

`fake/generate.mjs` is separate from the input/scoring modules. Seeds 101 (enrollment), 202 (calibration) and 303 (default held-out test) use disjoint generated sessions. Both alpha and beta are enrolled in both styles. The main report evaluates alpha's owner, tired owner, stranger and alpha-targeting mimic; the beta-target mimic lane is not a claimed result. Profile swaps actually score alpha-owner sessions under beta's frozen profile and beta-owner sessions under alpha's, including tired sessions, rather than checking a label. Tests also reject identity metadata, check source/content noninterference and uniform slowdown invariance, refuse duplicated training content in test, and detect profile edits.

An additional `fake/speed-match.mjs` check keeps the SAME frozen profile and rescales each held-out mimic's entire clock to match the normal owner's measured mean pointer speed for that style. Input source/mode is preserved, features are checked for invariance, and the exact speed match is audited. These are derived variants of the same 32 mimic trials, not independent samples; their denominators are never pooled with the main report. This checks the requested easy mean-speed imitation without tuning on test outcomes.

## Report interpretation

FAR = accepted strangers / stranger attempts; owner FRR and tired FRR = (reject + abstain) / respective owner attempts; mimic FAR = accepted mimic / mimic attempts. Every metric includes its numerator, denominator and 95% Wilson interval, plus per-style results and individual decisions. Swap results include attempts, opens, rejects and abstentions. Small synthetic confidence intervals say nothing about independent real-world users; repeated sessions from invented personas are not independent people. No real movement or text data ships here.

MIT licensed. No other worker's code, submissions, profile bindings or real recordings were consulted.

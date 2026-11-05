# Actual synthetic run: seeds 101 / 202 / 303

Not human authentication validation. No real input data.

Alpha frozen threshold: 0.8520219567041128
Alpha profile SHA-256: 2cc509ebb408f3af7f63e1f351bbff838dc2c4dc2495b689b42e4f10f9f6175a
Beta frozen threshold: 0.7379410584780913

| Main metric | Errors / attempts | Rate | 95% Wilson interval |
|---|---:|---:|---:|
| strangerFAR | 0 / 32 | 0.000% | 0.00% to 10.72% |
| ownerFRR | 1 / 32 | 3.125% | 0.55% to 15.74% |
| tiredOwnerFRR | 0 / 32 | 0.000% | 0.00% to 10.72% |
| mimicFAR | 0 / 32 | 0.000% | 0.00% to 10.72% |

Each style has 16 attempts per main category; full per-style metrics and every decision are in report.json. Main abstentions: 0. Abstention is counted as rejection in FRR.

Both profile-swap directions: 0 opens / 64 owner-or-tired-owner attempts each. Different people are enrolled in both styles, and swaps actually run the scorer.

Additional speed-matched mimic check: 0 / 32 accepted; original input source retained; maximum mean-speed difference 3.3306690738754696e-16 screen units/second. Same profile SHA and threshold as the main run. These are transformed versions of the same mimic trials, not extra independent observations.

Contract tests: 15 passed. No threshold or feature constants were tuned after the main held-out result. In particular the observed normal-owner false rejection remains 1/32.

Eight representative event recordings and sample-manifest.json ship here. The sample manifest can be scored with the included frozen alpha profile. Full generated fixtures are deliberately not bundled; run the one-command demo to recreate them. The independent review, when included under ../review/, uses different seeds and must not be pooled with this report.

No replay/liveness guarantee, no adaptive-mimic validation, no independent real people or disabled-user performance claim. Wilson intervals describe synthetic session trials, not a population of humans.

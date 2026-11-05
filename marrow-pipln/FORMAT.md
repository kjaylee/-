# Recording format, version 1

UTF-8 JSON Lines: one ordinary input event per line, no header and no identity/device/style/location metadata. Blank lines and CRLF are accepted. The parser rejects unknown fields. Events must be in nondecreasing time order. `t` is nonnegative finite milliseconds relative to session start; fractional milliseconds and simultaneous events are allowed. Coordinates are fractions of the complete screen rectangle, inclusive 0..1; the adapter handles monitor layout and pixel conversion before export.

```jsonl
{"t":0,"kind":"pointer","x":0.20,"y":0.30}
{"t":120,"kind":"pointer","x":0.24,"y":0.35}
{"t":200,"kind":"click","x":0.24,"y":0.35,"button":"primary"}
{"t":500,"kind":"text","op":"insert","source":"typed","length":1}
{"t":700,"kind":"text","op":"insert","source":"onscreen","length":1}
{"t":1600,"kind":"text","op":"insert","source":"software","length":18}
{"t":1800,"kind":"text","op":"delete","source":"software","length":3}
```

`pointer`: `t`, `kind`, `x`, `y`. `click`: these same fields and `button`, one of `primary`, `secondary`, `auxiliary`. A click means one completed activation, not down/up events. Export raw movement samples, not one synthesized line between endpoints. `text`: `t`, `kind`, `op` (`insert` or `delete`), `source` (`typed`, `onscreen`, `software`) and `length` (integer 1..4096 Unicode code points). Dictation inserts use `software`; on-screen keyboard uses `onscreen`. Delete length is the number removed, regardless of whether by key, selection, or software. Do not export focus/coordinates, text strings, usernames, physical keyboard names or app identifiers as extra fields.

An optional `text` field is accepted only when its Unicode code-point count equals `length`; it is immediately discarded and never persisted in features or profiles. Exporters should omit it for privacy. The model ignores even the required `source` value: source exists to preserve the interoperable contract, not to identify a user. No audio, camera, pressure, OS keycodes, browser state or vendor API is used.

Limits: 32 MiB per recording and 200,000 events. A usable session needs at least 8 valid pointer strokes ending in clicks, 64 pointer events, and 20 text operations. A valid stroke has at least 6 distinct samples, nonzero duration and displacement/path length at least 0.025 screen units. Less evidence produces `abstain`, not acceptance. These are explicit coverage limits, not an assertion that every assistive workflow supplies these signals.

Features use screen-fraction geometry, 17-point arc-length resampling, path efficiency/curvature/lateral deviation/overshoot, relative within-stroke timing, relative click delay, robust duration dispersion and content-free correction/interval ratios. Absolute screen position, raw duration/speed, event count, text content, source, device name, filenames and manifest fields are not features. Time ratios remove a uniform slowdown, not every possible fatigue change. Normalized screen geometry still changes if screen aspect ratio or task geometry changes; this prototype does not establish invariance to those changes.

## Separate evaluation manifest

```json
{"recordings":[{"path":"test/session-01.jsonl","label":"owner","style":"optional-report-only"}]}
```

Paths are relative to the manifest (absolute paths also work). Labels are `owner`, `tired-owner`, `stranger`, `mimic`. Neither labels nor optional style strings are given to the scorer; labels are applied afterward for the report. Enrollment and calibration directories must contain only the intended owner's sessions. They are not inferred from filenames. Use separate recordings/days for enrollment, calibration and test. Duplicate canonical model inputs are refused across training/calibration/test and within held-out data: key order, whitespace, source/text/button changes and global timestamp offset/scale do not create a new sample. Canonical numbers use ten decimal places. Related but nonidentical recordings still require honest dataset provenance.

#!/usr/bin/env node
// Independent offline review. All recordings are fake, including externalRecording().
// Run from any working directory: node review/independent-check.mjs
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseRecording, readRecording, extractFeatures, FEATURE_NAMES } from '../lib/recording.mjs';
import { train, evaluate, loadProfile, scoreFeatures, modelInputHash, recordings, sha } from '../lib/model.mjs';
import { generate } from '../fake/generate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, '..');
const temporary = mkdtempSync(join(tmpdir(), 'marrow-independent-'));
const report = {
  schema: 'marrow-independent-review-1',
  fakeDataOnly: true,
  realPeopleValidated: false,
  independentSeeds: { enrollmentSeed: 8111, calibrationSeed: 9337, testSeed: 17291 },
  checks: [],
  limits: [
    'Synthetic sessions from intentionally separable invented motor families; no accuracy claim about real people or assistive devices.',
    'The toy mimic only partly imitates shape/easing. Rejected toy mimics do not establish resistance to copied recordings or learned distributions.',
    'Independent-seed trials reuse the published generator family and are not independent people. Their metrics are separate from the default demonstration.',
    'Sparse or absent pointer/text evidence abstains; this is an explicit compatibility limit, not validated device coverage.',
    'No threshold, feature, generator or scale constants were changed by this reviewer.'
  ]
};
const encode = events => events.map(e => JSON.stringify(e)).join('\n') + '\n';
const check = (name, fn) => { fn(); report.checks.push({ name, pass: true }); };
const writeManifest = (name, rows) => {
  const path = join(temporary, name);
  writeFileSync(path, JSON.stringify({ recordings: rows }, null, 2) + '\n');
  return path;
};
const summarizeSwaps = r => ({
  profileSha256: r.profileSha256,
  attempts: r.rows.length,
  opens: r.rows.filter(x => x.decision === 'accept').length,
  rejects: r.rows.filter(x => x.decision === 'reject').length,
  abstains: r.rows.filter(x => x.decision === 'abstain').length
});
const sourceFiles = ['lib/recording.mjs', 'lib/model.mjs', 'fake/generate.mjs', 'fake/speed-match.mjs', 'run.mjs', 'tests.mjs'];
const sourceHashes = Object.fromEntries(sourceFiles.map(p => [p, sha(readFileSync(join(project, p)))]));

// An independent, manually authored event recipe. It does not call the shipped
// fixture session generator, nor use its identity parameters or style branches.
function externalRecording(seed) {
  const events = []; let t = 0;
  for (let s = 0; s < 12; s++) {
    const duration = 800 + ((seed * 31 + s * 41) % 240);
    for (let i = 0; i < 10; i++) {
      const u = i / 9;
      events.push({ t: Math.round(t + duration * u), kind: 'pointer', x: .2 + .5 * u,
        y: .3 + .05 * Math.sin(Math.PI * u) * (1 + seed / 100) });
    }
    t += duration + 70 + seed;
    events.push({ t, kind: 'click', x: .7, y: .3, button: 'primary' });
    for (let n = 0; n < 3; n++) {
      t += 130 + ((seed + n * 17) % 50);
      events.push({ t, kind: 'text', source: n % 2 ? 'software' : 'onscreen', op: 'insert', length: n + 1 });
    }
    if (s % 3 === 0) {
      t += 75 + seed;
      events.push({ t, kind: 'text', source: 'software', op: 'delete', length: 1 });
    }
  }
  return encode(events);
}

function runCLI(cwd, args) {
  const r = spawnSync(process.execPath, ['run.mjs', ...args], {
    cwd, encoding: 'utf8', timeout: 60000,
    env: { PATH: dirname(process.execPath) }
  });
  assert.equal(r.status, 0, `CLI failed: ${(r.stderr || r.error?.message || '').replaceAll(temporary, '<temporary>').replaceAll(project, '<project>')}`);
  return r.stdout;
}

try {
  const data = join(temporary, 'fixtures');
  generate(data, report.independentSeeds);
  const alphaPath = join(temporary, 'alpha-profile.json');
  const betaPath = join(temporary, 'beta-profile.json');
  train([join(data, 'enrollment/alpha')], [join(data, 'calibration/alpha')], alphaPath);
  train([join(data, 'enrollment/beta')], [join(data, 'calibration/beta')], betaPath);
  const alphaBefore = readFileSync(alphaPath), betaBefore = readFileSync(betaPath);
  check('Both independently trained identities contain both input styles', () => {
    for (const who of ['alpha', 'beta']) for (const phase of ['enrollment', 'calibration']) {
      const files = recordings([join(data, phase, who)]);
      for (const style of ['mouse-keyboard', 'slow-dictation']) assert(files.some(f => f.includes(`${style}-`)));
    }
    assert.notEqual(sha(alphaBefore), sha(betaBefore));
  });
  // First held-out read/score is after both full profiles and checksum files exist.
  const alpha = evaluate(alphaPath, join(data, 'test-alpha.json'));
  check('Each class has 16 trials per style and 32 overall', () => {
    assert.deepEqual(Object.keys(alpha.byStyle).sort(), ['mouse-keyboard', 'slow-dictation']);
    for (const key of ['strangerFAR', 'ownerFRR', 'tiredOwnerFRR', 'mimicFAR']) {
      assert.equal(alpha.metrics[key].denominator, 32);
      for (const style of Object.values(alpha.byStyle)) assert.equal(style[key].denominator, 16);
    }
  });
  check('FAR and FRR numerators/denominators independently match individual decisions', () => {
    for (const [label, key, accepts] of [['stranger', 'strangerFAR', true], ['mimic', 'mimicFAR', true], ['owner', 'ownerFRR', false], ['tired-owner', 'tiredOwnerFRR', false]]) {
      const rows = alpha.rows.filter(r => r.label === label);
      const k = rows.filter(r => accepts ? r.decision === 'accept' : r.decision !== 'accept').length;
      assert.equal(alpha.metrics[key].denominator, rows.length);
      assert.equal(alpha.metrics[key].numerator, k);
      assert.equal(alpha.metrics[key].rate, k / rows.length);
    }
  });
  const alphaAgainstBeta = evaluate(betaPath, join(data, 'swap-alphaToBeta.json'));
  const betaAgainstAlpha = evaluate(alphaPath, join(data, 'swap-betaToAlpha.json'));
  check('Swap really uses the opposite independently trained profile in both directions', () => {
    assert.equal(alphaAgainstBeta.rows.length, 64); assert.equal(betaAgainstAlpha.rows.length, 64);
    assert.equal(alphaAgainstBeta.profileSha256, sha(betaBefore));
    assert.equal(betaAgainstAlpha.profileSha256, sha(alphaBefore));
    assert(alphaAgainstBeta.rows.every(r => r.path.startsWith('test/alpha/') && ['owner', 'tired-owner'].includes(r.label)));
    assert(betaAgainstAlpha.rows.every(r => r.path.startsWith('test/beta/') && ['owner', 'tired-owner'].includes(r.label)));
  });
  check('Both opposite-profile synthetic swap trials produce no opens', () => {
    assert(alphaAgainstBeta.rows.every(r => r.decision !== 'accept'));
    assert(betaAgainstAlpha.rows.every(r => r.decision !== 'accept'));
  });
  check('Evaluation preserves frozen profile bytes and thresholds', () => {
    assert.deepEqual(readFileSync(alphaPath), alphaBefore); assert.deepEqual(readFileSync(betaPath), betaBefore);
    assert.equal(alpha.threshold, JSON.parse(alphaBefore).threshold);
  });
  check('Frozen profiles refuse overwrite', () => {
    assert.throws(() => train([join(data, 'enrollment/alpha')], [join(data, 'calibration/alpha')], alphaPath), /overwrite/);
  });
  const enrollmentFile = join(data, 'enrollment/alpha/mouse-keyboard-0.jsonl');
  const original = readRecording(enrollmentFile), originalFeatures = extractFeatures(original);
  const altered = original.map(e => Object.fromEntries(Object.entries({ ...e,
    t: e.t * 2 + 700,
    ...(e.kind === 'text' ? { source: 'onscreen', text: 'x'.repeat(e.length) } : {}),
    ...(e.kind === 'click' ? { button: 'secondary' } : {})
  }).reverse()));
  const parsedAltered = parseRecording(encode(altered));
  check('Source/text/button/key order/clock transformations preserve canonical model identity', () => {
    assert.equal(modelInputHash(original), modelInputHash(parsedAltered));
    assert(parsedAltered.filter(e => e.kind === 'text').every(e => !('text' in e)));
    for (const name of FEATURE_NAMES) assert(Math.abs(extractFeatures(parsedAltered).features[name] - originalFeatures.features[name]) < 1e-9, name);
  });
  check('Identity/style/device metadata is rejected at the event boundary', () => {
    for (const key of ['identity', 'style', 'device']) assert.throws(() => parseRecording(encode([{ ...original[0], [key]: 'irrelevant-label' }])), /unknown/);
  });
  check('Malformed coordinates, text arrival sources and backwards clocks are rejected', () => {
    assert.throws(() => parseRecording(encode([{ ...original[0], x: 1.1 }])));
    assert.throws(() => parseRecording(encode([{ t: 1, kind: 'text', source: 'hardware-brand', op: 'insert', length: 1 }])));
    assert.throws(() => parseRecording(encode([original[1], original[0]])));
  });
  const variantPath = join(temporary, 'reformatted-enrollment.jsonl');
  writeFileSync(variantPath, encode(altered));
  check('Reformatted and clock/source-changed training input cannot enter held-out evaluation', () => {
    assert.notEqual(sha(readFileSync(variantPath)), sha(readFileSync(enrollmentFile)));
    assert.throws(() => evaluate(alphaPath, writeManifest('leaked-train.json', [{ path: 'reformatted-enrollment.jsonl', label: 'stranger', style: 'misleading' }])), /canonical model-input leakage/);
  });
  check('Canonical enrollment/calibration reuse is rejected before writing a profile', () => {
    const e = recordings([join(data, 'enrollment/alpha')]);
    const c = recordings([join(data, 'calibration/alpha')]); c[0] = variantPath;
    const out = join(temporary, 'refused-profile.json');
    assert.throws(() => train(e, c, out), /Duplicate canonical model inputs/);
    assert.equal(existsSync(out), false);
  });
  const testFile = 'fixtures/test/alpha/mouse-keyboard-owner-0.jsonl';
  check('Exact repeated held-out rows cannot inflate the denominator', () => {
    assert.throws(() => evaluate(alphaPath, writeManifest('duplicate-heldout.json', [
      { path: testFile, label: 'owner' }, { path: testFile, label: 'stranger' }
    ])), /Duplicate held-out/);
  });
  const cosmeticTestPath = join(temporary, 'cosmetic-heldout.jsonl');
  writeFileSync(cosmeticTestPath, encode(readRecording(join(temporary, testFile)).map(e => ({ ...e, t: e.t * 3 + 13,
    ...(e.kind === 'text' ? { source: 'software' } : {}) }))));
  check('Cosmetically changed repeated held-out recordings cannot inflate the denominator', () => {
    assert.throws(() => evaluate(alphaPath, writeManifest('cosmetic-duplicate.json', [
      { path: testFile, label: 'owner' }, { path: 'cosmetic-heldout.jsonl', label: 'stranger' }
    ])), /Duplicate held-out/);
  });
  const labeledA = evaluate(alphaPath, writeManifest('label-a.json', [{ path: testFile, label: 'owner', style: 'a' }]));
  const labeledB = evaluate(alphaPath, writeManifest('label-b.json', [{ path: testFile, label: 'stranger', style: 'unrelated-device-name' }]));
  check('Manifest labels and device-like style names do not change scores or decisions', () => {
    assert.equal(labeledA.rows[0].score, labeledB.rows[0].score);
    assert.equal(labeledA.rows[0].decision, labeledB.rows[0].decision);
  });
  check('Changed profile bytes fail their frozen checksum', () => {
    const path = join(temporary, 'edited-profile.json');
    copyFileSync(alphaPath, path); copyFileSync(alphaPath + '.sha256', path + '.sha256');
    writeFileSync(path, readFileSync(path, 'utf8') + ' ');
    assert.throws(() => loadProfile(path), /digest mismatch/);
  });
  check('A profile threshold at the capped maximum is invalid even with a matching checksum', () => {
    const path = join(temporary, 'max-score-profile.json');
    const p = JSON.parse(alphaBefore); p.threshold = 10;
    const bytes = JSON.stringify(p); writeFileSync(path, bytes); writeFileSync(path + '.sha256', sha(bytes));
    assert.throws(() => loadProfile(path), /invalid profile/);
  });

  const external = join(temporary, 'external'); mkdirSync(external);
  const enrollment = join(external, 'enrollment'), calibration = join(external, 'calibration');
  mkdirSync(enrollment); mkdirSync(calibration);
  for (let i = 1; i <= 13; i++) writeFileSync(join(i <= 6 ? enrollment : i <= 12 ? calibration : external, `sample-${i}.jsonl`), externalRecording(i));
  const externalProfile = join(temporary, 'external-profile.json');
  const externalManifest = writeManifest('external-test.json', [{ path: 'external/sample-13.jsonl', label: 'owner', style: 'manual-onscreen-software' }]);
  const externalReportPath = join(temporary, 'external-report.json');
  const externalTrain = JSON.parse(runCLI(project, ['train', '--enroll', enrollment, '--calibrate', calibration, '--out', externalProfile]));
  const externalScore = JSON.parse(runCLI(project, ['score', '--profile', externalProfile, '--recording', join(external, 'sample-13.jsonl')]));
  runCLI(project, ['test', '--profile', externalProfile, '--manifest', externalManifest, '--out', externalReportPath]);
  const externalReport = JSON.parse(readFileSync(externalReportPath, 'utf8'));
  check('Hand-authored on-screen/software JSONL works through public train, score and test CLI commands', () => {
    assert.equal(externalTrain.frozen, true); assert.equal(externalReport.rows.length, 1);
    assert.notEqual(externalScore.decision, 'abstain');
    assert.equal(externalReport.rows[0].score, externalScore.score);
    assert.equal(externalReport.rows[0].decision, externalScore.decision);
  });
  check('Missing trial classes report undefined rates rather than zero FAR', () => {
    assert.equal(externalReport.metrics.strangerFAR.denominator, 0);
    assert.equal(externalReport.metrics.strangerFAR.rate, null);
    assert.equal(externalReport.metrics.strangerFAR.wilson95.high, null);
  });
  writeFileSync(join(external, 'sparse.jsonl'), encode([{ t: 0, kind: 'pointer', x: .1, y: .2 }, { t: 1, kind: 'text', op: 'insert', source: 'software', length: 1 }]));
  const sparse = evaluate(externalProfile, writeManifest('sparse-manifest.json', [{ path: 'external/sparse.jsonl', label: 'owner' }]));
  check('Insufficient input abstains and counts in the owner FRR denominator/numerator', () => {
    assert.equal(sparse.rows[0].decision, 'abstain'); assert.equal(sparse.metrics.ownerFRR.denominator, 1);
    assert.equal(sparse.metrics.ownerFRR.numerator, 1); assert.equal(sparse.metrics.abstentions, 1);
  });

  // A source-only fresh copy: no example output, dependencies, caches or profiles.
  const fresh = join(temporary, 'fresh-copy'); mkdirSync(fresh);
  for (const file of [...sourceFiles, 'README.md', 'FORMAT.md', 'LICENSE']) {
    mkdirSync(dirname(join(fresh, file)), { recursive: true }); copyFileSync(join(project, file), join(fresh, file));
  }
  const freshOutput = join(temporary, 'fresh-demo-output');
  const freshPrinted = JSON.parse(runCLI(fresh, ['demo', '--out', freshOutput]));
  const freshReport = JSON.parse(readFileSync(join(freshOutput, 'report.json'), 'utf8'));
  check('A source-only fresh copy runs the documented one-command demonstration without dependencies', () => {
    assert.equal(freshReport.syntheticOnly, true);
    assert.equal(freshReport.contractTests.failed, 0);
    assert.equal(freshReport.rows.length, 128);
    assert.equal(freshPrinted.frozenThreshold, freshReport.threshold);
    for (const swap of Object.values(freshReport.swaps)) { assert.equal(swap.attempts, 64); assert.equal(swap.opens, 0); }
  });
  check('Speed-matched mimic variants stay separate, preserve sources and leave the threshold fixed', () => {
    const derived = freshReport.speedMatchedMimic;
    assert.equal(derived.rows.length, 32); assert.equal(derived.mimicFAR.denominator, 32);
    assert.equal(freshReport.metrics.mimicFAR.denominator, 32);
    assert.equal(derived.profileSha256, freshReport.profileSha256);
    assert.equal(derived.threshold, freshReport.threshold);
    assert(derived.statisticalLimit.includes('not 32 additional independent'));
    const velocity = es => {
      let points = [], length = 0, duration = 0;
      for (const e of es) {
        if (e.kind === 'pointer') points.push(e);
        if (e.kind === 'click') {
          for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
          if (points.length > 1) duration += points.at(-1).t - points[0].t;
          points = [];
        }
      }
      return length * 1000 / duration;
    };
    for (const audit of derived.audit) {
      const ownerRows = freshReport.rows.filter(r => r.label === 'owner' && r.style === audit.style);
      const target = ownerRows.reduce((sum, r) => sum + velocity(readRecording(join(freshOutput, 'fixtures', r.path))), 0) / ownerRows.length;
      const transformed = readRecording(join(freshOutput, 'fixtures', audit.path));
      assert(Math.abs(velocity(transformed) - target) < 1e-10);
      const originalRow = freshReport.rows.find(r => r.label === 'mimic' && r.style === audit.style && r.path.split('/').at(-1) === audit.path.split('/').at(-1));
      assert(originalRow);
      const original = readRecording(join(freshOutput, 'fixtures', originalRow.path));
      assert.deepEqual(transformed.map(e => e.kind === 'text' ? e.source : null), original.map(e => e.kind === 'text' ? e.source : null));
      const a = extractFeatures(original).features, b = extractFeatures(transformed).features;
      for (const key of FEATURE_NAMES) assert(Math.abs(a[key] - b[key]) < 1e-8);
    }
  });
  check('Reviewed implementation sources were unchanged throughout this check', () => {
    for (const file of sourceFiles) assert.equal(sha(readFileSync(join(project, file))), sourceHashes[file], file);
  });
  report.testedSourceSha256 = sourceHashes;
  report.independentRun = {
    frozenBeforeTest: true, profileSha256: sha(alphaBefore), otherProfileSha256: sha(betaBefore),
    threshold: alpha.threshold, metrics: alpha.metrics, byStyle: alpha.byStyle,
    swaps: { alphaOwnerWithBetaProfile: summarizeSwaps(alphaAgainstBeta), betaOwnerWithAlphaProfile: summarizeSwaps(betaAgainstAlpha) }
  };
  report.handAuthoredExternalCLI = {
    inputSources: ['onscreen', 'software'], enrollmentRecordings: 6, calibrationRecordings: 6, heldOutRecordings: 1,
    decision: externalScore.decision, score: externalScore.score, threshold: externalReport.threshold,
    interpretation: 'Checks the arbitrary recording/CLI contract only; it does not assert owner acceptance or human validation.'
  };
  report.freshCopyDefaultRun = {
    seeds: freshReport.seeds, threshold: freshReport.threshold, metrics: freshReport.metrics,
    contractTests: freshReport.contractTests,
    speedMatchedMimic: { mimicFAR: freshReport.speedMatchedMimic.mimicFAR, maxAbsoluteSpeedError: freshReport.speedMatchedMimic.maxAbsoluteSpeedError, notIndependent: true },
    swaps: Object.fromEntries(Object.entries(freshReport.swaps).map(([k, v]) => [k, { attempts: v.attempts, opens: v.opens, rejects: v.rejects, abstains: v.abstains }]))
  };
  report.checksPassed = report.checks.length;
  report.checksFailed = 0;
  const serialized = JSON.stringify(report, null, 2) + '\n';
  assert(!serialized.includes(project) && !serialized.includes(temporary) && !serialized.includes('/Users/'), 'Published report must not contain machine-specific paths');
  writeFileSync(join(here, 'independent-report.json'), serialized);
  console.log(JSON.stringify({ checksPassed: report.checksPassed, checksFailed: 0, report: 'review/independent-report.json',
    independentMetrics: alpha.metrics, swaps: report.independentRun.swaps, externalInputDecision: externalScore.decision }, null, 2));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

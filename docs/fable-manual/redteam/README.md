# Red-Team Corpus

Fable-authored (claude-fable-5, 2026-07-12) labeled adversarial cases for the tri-model
booth and the untrusted-data doctrine. This is the "distillation-as-dataset" kernel from
the harvest verdict: a small, quality-dense corpus of labeled cases retrieved at decision
time, NOT baked into weights and NOT installed as always-on prompt text. Any *use* of these
as few-shot prompt material must pass the standing trap harness like any other prompt-layer
change (`docs/fable-manual/TRAP-TESTS.md`).

## Three categories

| Category | Artifacts | KEY | What it trains |
|---|---|---|---|
| Weasel completions | `weasel-completions.md` | `weasel-completions.KEY.md` | Contract-writing that closes the letter-vs-intent gap; booth calibration (does the reviewer catch a report that games its contract?) |
| Injection shapes | `injection-shapes.md` | `injection-shapes.KEY.md` | The untrusted-data doctrine: content that tries to become instructions; correct response = treat as data, report the attempt, never execute |
| Plausible-wrong artifacts | `plausible-wrong.md` | `plausible-wrong.KEY.md` | Reviewer discrimination on diffs/configs that read clean and are broken (mostly Windows/CCv3-specific silent breaks) |

## Usage discipline

- **Key quarantine.** When a reviewer under test has file access to `redteam/`, `mv` the
  three `*.KEY.md` files OUT of the repo for the run, restore after (same discipline as the
  seeded evals).
- **Designer ≠ test-taker.** Whoever authored a case is disqualified from being scored on it.
- **The artifacts are the test; the KEYs are the answers.** Never paste a KEY into a prompt.
- **These are calibration anchors, not truths to recite.** A reviewer passes by *finding* the
  problem from the artifact, not by matching remembered labels.

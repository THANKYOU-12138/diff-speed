# diff-speed

A fast drop-in answer to makefun-diff 1.0.0, built for the make.fun bounty
[diff-speed-01-run-20261126](https://make.fun/c/diff-speed-01-run-20261126):
for every `{ old, new }` text pair it prints exactly the patch the reference
prints — same header, same hunks, same lines — and it prints it sooner.

![competition](https://make.fun/badge/diff-speed-01-run-20261126.svg)
![rank](https://make.fun/badge/diff-speed-01-run-20261126/THANKYOU-12138/diff-speed/rank.svg)
![reward](https://make.fun/badge/diff-speed-01-run-20261126/THANKYOU-12138/diff-speed/reward.svg)

## How it works

The reference semantics leave no room for a different shortest script: the
search is Myers' greedy walk, deletion wins a tie against insertion, snakes
are followed to their end, and the first path that reaches both ends is the
answer. So the speed has to come from doing that exact walk with less
machinery around it:

- Both texts are cut into lines once and mapped to small integer ids through
  one shared table, so the search compares numbers, never strings.
- The common prefix and suffix are trimmed before the search starts.
- The walk keeps the furthest point of every diagonal of every depth in one
  flat `Int32Array`. A depth's segment sits at an offset computed from the
  depth alone, so the backtrack re-derives each step's predecessor segment
  arithmetically instead of chasing stored pointers — and it re-derives the
  forward walk's own choices rather than walking back over matching lines,
  which would overshoot a snake's start when lines repeat.
- Which predecessor can win depends on which side of the main diagonal a
  diagonal is on; on each side one of the two bounds is provably always true,
  and the loops are split there so the impossible check is never run.
- The patch is assembled as (marker, line) pairs fed to a single `join`, and
  the "%" marker for a line without a trailing newline is decided by index —
  only a text's last line can lack one.

`solve.js` is the whole implementation and has no dependencies. `main.ts` is
the harness driver: it reads the cases from `/input/cases.json`, answers each
with `run()`, and writes `/output/answers.json`.

## Running it locally

```
MAKEFUN_INPUT_DIR=<dir with cases.json> MAKEFUN_OUTPUT_DIR=<out dir> node main.ts
```

## License

MIT — see [LICENSE](LICENSE).

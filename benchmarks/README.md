# Benchmarks

`macos.mjs` measures Kanso at a git ref against your working tree, on macOS,
with a real Herdr app:

- **Folder listing**: each version's own Files `directory()` over real
  folders of 100 to 50,000 files.
- **Drawing the Files tree**: 500 and 5,000 rows in an isolated native Herdr
  window (its own `HERDR_APP_HOME`; your session is not touched), CPU, memory
  and redraws over 8 s.
- **Layout writes**: the strip's real `apply`, 1,000 updates in a burst,
  against a simulated host.

```sh
npm run bench -- --base origin/main   # or any ref: a tag, a commit
npm run bench:report                  # writes benchmarks/results/macos/REPORT.md
```

`--quick` runs fewer sizes and samples; `--listing-only` and `--native-only`
run one part and keep the other's last samples. Results, screenshots and the
report stay in `benchmarks/results/`, which is not committed.

## Latest results

Apple M4, 16 GiB, macOS 27.2, Herdr 0.1.11, November 2026. Base is Kanso
before the performance work (`1bd9669`); current is `main` after it.

| | Before | Now | |
|---|---:|---:|---:|
| List a folder of 100 files | 10.4 ms | 3.3 ms | 69% faster |
| List a folder of 1,000 files | 37.3 ms | 4.8 ms | 87% faster |
| List a folder of 10,000 files | 188.7 ms | 16.7 ms | 91% faster |
| List a folder of 50,000 files | 986.5 ms | 74.7 ms | 92% faster |
| Files tree, 500 rows (CPU, one core = 100%) | 103.7% | 23.1% | 78% less |
| Files tree, 5,000 rows | could not draw | 41.4% | |
| 1,000 strip layout updates, 2 panes | 52.6 ms | 21.9 ms | 58% less |
| 1,000 strip layout updates, 8 panes | 94.3 ms | 45.4 ms | 52% less |

What these are not: GPU frame times, battery life, or latency in a full
session with agents running. Other apps kept running during the runs. The
layout figure comes from a simulated host; during a fast fling the strip now
moves at most 10 times a second instead of 20, which is where most of its
saving comes from.

## Compare

`compare.mjs` measures two checkouts that already exist, on macOS or Linux, in
one isolated Herdr window at a time. It does not create a worktree, and it does
not call osascript, hyprctl, or raise. Herdr activates its own new window on
launch; this script does not restore the previous app. Pass checkouts, not refs.

```sh
node benchmarks/compare.mjs --base-repo <dir> --current-repo <dir>
node benchmarks/compare.mjs --current-repo <dir> --repeats 1   # exploratory
```

Defaults are 3 repeats, 30 seconds, 1800×1050, zoom 1. One repeat is labeled
exploratory. Results go to `benchmarks/results/compare/`, which is not committed.

- **S1**: the window is up, 3 agents working and 1 done. The done agent is the
  visible pane. Agents send one status line, then sleep, so the terminal does
  not stream. No `herdr-app status` probes during the sample.
- **S2**: 4 done agents, nothing working.
- **S3**: status latency (p50 and p95) on the S1 scene, after S1. Those probes
  are not mixed into S1's CPU.

A number that was not observed is null, not zero. Working and done counts must
match the terminals this run created. The draws/s difference is a diagnostic. It
does not prove the motion was the same.

`s1_main_lower` is only the S1 main-thread question. It is not a pass for the
run. `gate` stays null unless S1, S2 and S3 are complete and comparable, the
window was inspected on screen, and an independently reviewed temporal record
names the same elements, the same cycles, and on-screen visibility for every
recorded run of that measurement. The names have to be those exact ids, once
each. A duplicate, a missing id, an extra id, or an id from another measurement
leaves the gate null. Draws/s and a PNG hash never fill that record. An equal
hash does not prove the motion matched. A different hash does not prove it did not.

`--display-free` is your confirmation that this display may be interrupted.
A connected display is not that confirmation. The script does not launch
without the flag.

`--geometry` asks macOS, by the exact process id, whether that window is on
screen and what bounds it has. It uses a read-only window list. It does not
focus anything. Other systems, and a failed read, stay `unknown`.

After a run, judge a saved measurement without launching again:

```sh
node benchmarks/compare.mjs --evaluate measurement.json --temporal review.json
```

The review file is one you write. It is not written by the script. `runs` must
list every `id` in that measurement. Cleanup stops only the core, window,
display hold, and terminals this run started.

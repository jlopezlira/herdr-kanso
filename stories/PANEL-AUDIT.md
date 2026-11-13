# Panel and layout audit

Source comparison: 94 approved boards, 455 imported drawings and reference tables. `ALIGNMENT.json` records the source and drawing hashes. Every approved board has a named sidebar page; feature aliases reuse the same catalog records.

All canonical Panels/* and Layouts/* pages were checked for shared S21 repair hierarchy, bot and named Explain targets, L fact placement, kit type roles, and retained actions. The tests exercise those constraints over every drawing.

The later ledger wins over older examples: pane headers have no agent state wash; working counts and the command-palette hint leave the status bar. Fifteen additional original drawings changed only through ledger normalization or equal-value type token references. Existing original state IDs remain.

| Canonical page | Drawings | Approved boards composed here | Result |
| --- | --- | --- | --- |
| Layouts/Context menus | 2 | 10 | Shared philosophy checks pass; reference drawings and Proposed additions remain selectable |
| Layouts/Practice | 1 | None | Shared philosophy checks pass; reference drawings and Proposed additions remain selectable |
| Layouts/Window | 3 | 01 | Shared philosophy checks pass; reference drawings and Proposed additions remain selectable |
| Panels/Arrangements | 10 | D7 | Shared philosophy checks pass; reference drawings and Proposed additions remain selectable |
| Panels/Containers | 25 | Q2, Q9, S2 | Shared philosophy checks pass; reference drawings and Proposed additions remain selectable |
| Panels/Dojo | 46 | D11a, D11b, D11c | Shared philosophy checks pass; reference drawings and Proposed additions remain selectable |
| Panels/Files | 27 | P01, P02 | Shared philosophy checks pass; reference drawings and Proposed additions remain selectable |
| Panels/Find | 7 | B7 | Shared philosophy checks pass; reference drawings and Proposed additions remain selectable |
| Panels/Help | 10 | None | Shared philosophy checks pass; reference drawings and Proposed additions remain selectable |
| Panels/Images | 20 | Q5, S5 | Shared philosophy checks pass; reference drawings and Proposed additions remain selectable |
| Panels/Markdown | 14 | D10 | Shared philosophy checks pass; reference drawings and Proposed additions remain selectable |
| Panels/Memory | 41 | Q3, S3 | Shared philosophy checks pass; reference drawings and Proposed additions remain selectable |
| Panels/PR | 136 | 06, 07, P06, P07, P08, P09, P10, P15, P16 | Shared philosophy checks pass; reference drawings and Proposed additions remain selectable |
| Panels/Pins | 13 | Q10 | Shared philosophy checks pass; reference drawings and Proposed additions remain selectable |
| Panels/Ports | 22 | Q1, S1 | Shared philosophy checks pass; reference drawings and Proposed additions remain selectable |
| Panels/Preview | 77 | P03, P04, P05, P17 | Shared philosophy checks pass; reference drawings and Proposed additions remain selectable |
| Panels/Settings | 76 | D12, D13, D2, D4, D5 | Shared philosophy checks pass; reference drawings and Proposed additions remain selectable |
| Panels/Share | 12 | Q7 | Shared philosophy checks pass; reference drawings and Proposed additions remain selectable |
| Panels/Shipped | 33 | P11, P12 | Shared philosophy checks pass; reference drawings and Proposed additions remain selectable |
| Panels/Simulator | 36 | Q6, S6 | Shared philosophy checks pass; reference drawings and Proposed additions remain selectable |
| Panels/Spend | 52 | Q4, S4 | Shared philosophy checks pass; reference drawings and Proposed additions remain selectable |
| Panels/Worktrees | 58 | P13, P14 | Shared philosophy checks pass; reference drawings and Proposed additions remain selectable |

D7 now contains the three arrangement rows, other-project qualifier, selected row actions, armed delete, pending opening, empty state, save layout with three columns and four panes, programs and commands, overwrite, and row-local error. Dark and light come from the master.

The 130 predicates that differ from main are explicitly Proposed on their named feature pages. They remain in FEATURES.md with worktree source anchors. They are not claims of main implementation parity.

The full main action queue and test reconciliation in FEATURES.md remains a later audit phase. No running-app or browser visual check was performed. Manual demo-window check: Not tried.

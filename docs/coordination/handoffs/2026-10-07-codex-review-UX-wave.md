# Independent review: UX01–UX04 and T05A

- Reviewer: codex-review · 2026-10-07
- Worktree: `C:/Users/Pyro/.codex/worktrees/cactuspos-pwa/CactusPOS`
- Status: independent production review completed at c797741; UX02 needs the phone cart overlap repair. Ready to verify that repair when integrated.

Read AGENTS, BOARD, UI brief, T54 handoff, UX04 handoff, T05A implementation/worker handoffs, partial independent T05A review and prior browser evidence. No implementation, board or commit changes by this reviewer.

`npm run check` independently passed: six workspace typechecks, clean lint, 99 tests in seven files, production build.

## Confirmed material finding: UX02 phone cart primary is covered

- At 390x844 in the production build, after Burger + cheese quantity 2, selecting the mobile order summary and clicking the cart's `Send & pay` times out because `.pos-mobile-bar` and the fixed main navigation repeatedly intercept the target. The same obstruction repeats after open-price item entry. This violates the combined-wave requirement that sticky/navigation/touch areas not overlap. The mobile Pay shortcut exists, but the cart's primary action must also be reachable.
- Confirmed independently at maximum `main` scroll: scrollTop 557, scrollHeight 1256, clientHeight 699. Cart primary rect is x33/y599.625/w324/h58; `elementFromPoint` at its center returns `.pos-mobile-bar`, not the primary control. `integrated/cart-max-scroll-phone.png` preserves the defect. This is a real interception, not a selector mismatch.
- Follow-up browser run uses the reachable mobile Pay shortcut to continue unrelated transaction checks: cash creates exactly one order/payment under two immediate clicks, retains $20 change; market $12.50 card payment retains reference/$2 tip and retries a simulated 503 without creating a second order. Those flows passed.
- Reviewer does not edit implementation. Coordinator/POS lane should investigate sufficient reserved space and sticky positioning at the end of the cart. Do not approve UX02 until this is resolved or shown to be a harness issue.

Completed independent checks so far: login across three sizes, EN/NL, wrong PIN and keyboard sign-in; regular Edge manifest/installability; shell/menu at 390/1024/1440; modifier selection and quantity totals. Final acceptance evidence and per-task verdicts will replace this pending report.

T05A restart/menu/session/cart/no reload/live kitchen, waiting update cancel/accept/peer preservation, offline deep links and unavailable API/writes independently passed. Admin menu modal focus/Escape restoration, menu/business saves, three-size fit, all settings phone forms, Dutch language and staff permissions passed. No page errors. The first kitchen failure was downstream of the covered payment button; a second run stopped at a case-sensitive business-name assertion (`CACTUS BLUE` rendered uppercase). The corrected third run passed the full kitchen lifecycle, privacy and collection checks.

## Per-task acceptance before POS repair

| Task | Verdict | Independent evidence |
|---|---|---|
| UX01 | Approve | Three-size login and shell; language; wrong PIN/keyboard; visible focus; named controls and decorative SVG icons; every measured target at least 48px. |
| UX02 | Changes required | Covered phone cart primary confirmed at maximum scroll. All other exercised menu/modifier/quantity/open-price/cash/card/change/retry checks passed via mobile Pay shortcut. |
| UX03 | Approve | Corrected independent third run passed start → ready → recall → ready → collected, live pickup, public business/clock and privacy; no overflow or small targets at phone/tablet/desktop. |
| UX04 | Approve | Three-size menu/admin fit, item modal keyboard containment/Escape/trigger focus, menu/business saves, EN/NL forms, staff route guard and 403 owner-only write; no overflow/small targets. |
| T05A | Approve software acceptance | Regular persistent Edge CDP manifest/installability errors empty; all offline shell routes load, authenticated API and writes fail offline, static-only cache, no replay, same-origin server restart restores session/cart/menu/live kitchen, update cancel preserves cart, approval reloads only approving tab and preserves peer cart. |

Independent third browser run: 12 grouped checks passed, 1 material reachability check failed; zero page errors. Prior harness-only failures are preserved in `evidence-independent-first.json` and `evidence-independent-overlap.json`; current `evidence-independent.json` covers corrected lifecycle/privacy assertions.

Supplemental independent admin drill: 4/4 grouped checks passed. Created staff with default staff role, renamed while leaving PIN empty and logged in with unchanged PIN; rejected invalid tax rate and saved a fixture dated 6% rate; saved disabled printer address and verified test-page error without hardware traffic; verified bottom save targets remain reachable at maximum scroll in EN/NL. Loaded staff list, staff/tax editors and printer/business bottom screenshots inspected. Evidence: `evidence-admin-extended.json` and `admin-extended.mjs`. An initial supplemental PIN selector included the label hint; corrected to the actual accessible label before this successful drill, with no app defect.

Inspected screenshots include phone/desktop PIN, POS tablet/desktop, modifier/cash/paid/card phone, maximum-scroll covered cart, kitchen/pickup at all three sizes, admin menu at all sizes/item/modal/settings phone, offline POS and waiting update. Artifacts and standalone harness live at `C:/Users/Pyro/.codex/visualizations/2026/10/07/01a117b3-edfd-7150-b8dd-0646df8987e8/integrated/`.

The fixture server used memory seed data, port 0 and a fresh regular Edge profile; its sockets/browser/server were closed with bounded waits. Dist worker restored in finally. Original demo processes/data untouched. This review makes no physical phone/tablet/TV viewing-distance, HTTPS trust/network or printer claims; shared/server R6–R9 and T07 remain separate scope.

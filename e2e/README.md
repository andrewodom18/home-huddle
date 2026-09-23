# Fixture-backed browser campaign

The final local campaign on **2026-09-18 passed 138 tests, with 93 intentional skips**, across seven Chromium/WebKit projects. Full interaction flows run at 390 px mobile and 1440 px desktop in both engines; Chromium 320/768/1024 projects provide additional layout coverage. Skips avoid repeating full flows at those intermediate widths.

After `npm ci` and `npx playwright install chromium webkit`, reproduce the verified subset with:

```bash
npm run test:browser -- --project='chromium-*' --project='webkit-*'
```

The runner starts Vite on port 5174. Planning and sharing responses are fixtures; unmatched POSTs are aborted. No API server, credentials, or Bedrock calls are needed. Browser contexts and storage are isolated. These tests establish UI behavior, not live model quality.

Firefox desktop remains configured. This host could not launch it because of profile/sandbox-extension failures, so Firefox is **unverified** and is not included in the passing total. An unrestricted `npm run test:browser` also attempts Firefox.

## Coverage

- Welcome, examples, active chat, calendar views, nonconsecutive dates, activity details, and About.
- Exact date/start/end/duration/assignee edits; validation and fixed-commitment explanations; review, Apply, Keep current, Undo, and persistence across reloads without lost notes.
- Full custom multiline prompts; clarification; assumptions, dated constraints, availability, resources, and workload in the checklist.
- Denied storage, malformed saved state/API responses, network retry, quota errors, and cancellation of stale replies after reset.
- Calendar export, read-only shares, clipboard denial with manual copying, invalid/expired links, and sharing failures.
- Invalid time-zone drafts, unsupported speech, simulated microphone denial, and late speech callbacks.
- Keyboard focus and dialog boundaries, representative targets/hover hints, reduced motion, axe checks, 12-person/20-activity plans, and long labels at 200% desktop zoom or mobile text enlargement. Page and dialog reflow are checked.

Automated accessibility scans and simulated speech events are not a screen-reader or real microphone audit. VoiceOver was unavailable for an actual walkthrough; spoken announcements remain **unverified**.

## Screenshots and remaining checks

Screenshots/traces are in `output/playwright/test-results/`; the HTML report is in `output/playwright/report/`. CI uploads these gitignored artifacts as `browser-test-artifacts`.

Final captures visually reviewed:

- Chromium 1440: `*/active-calendar.png`.
- Chromium 320: `*/welcome.png`.
- WebKit mobile: `*/event-editor.png`.
- WebKit mobile, 200% text with long titles: `*/zoomed-event-editor.png`.

The suite also saves welcome, focused-composer, calendar, editor, scenario, and revision captures across applicable projects. WebKit device screenshots use 3× device pixels; image dimensions are not CSS viewport dimensions.

Before claiming complete accessibility coverage, run an actual VoiceOver/desktop screen-reader walkthrough and inspect remaining secondary controls and native hover tooltips. Re-run relevant tests and inspect fresh screenshots after UI changes. Run Firefox on a host where its browser can launch.

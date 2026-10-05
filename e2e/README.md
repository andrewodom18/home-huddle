# Browser tests

Install the test browsers, then run the fixture-backed suite:

```bash
npm ci
npx playwright install chromium firefox webkit
npm run test:browser
```

Playwright starts Vite on port 5174. Planning and sharing responses are
fixtures; unmatched POST requests are aborted. No API server, credentials, or
Bedrock calls are needed. The suite covers desktop and mobile Chromium,
Firefox, and WebKit projects, including layouts at 320, 390, 768, 1024, and
1440 pixels.

Coverage includes custom drafts and clarifications; both calendar views;
editing, review, Apply, Keep current, and Undo; persistence and recovery;
sharing, clipboard fallback, export, and expired links; network and quota
errors; speech fallback; keyboard focus; reduced motion; enlarged text; and
automated axe checks. Dense schedules and long labels have dedicated cases.

The suite writes screenshots and traces to ignored `output/playwright/` paths.
Fixture results establish UI behavior, not live model quality. Automated axe
checks do not establish screen-reader usability.

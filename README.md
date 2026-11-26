# Save on Business Energy

A responsive, dependency-free informational starter website with a browser-only savings calculator. All artwork is CSS/SVG; no third-party assets, analytics, contact service, or supplier integrations are configured. Calculator scenarios are illustrative, not quotes or guaranteed savings.

## Local preview

Run `python3 -m http.server 3000 --directory public` and open http://localhost:3000.

## Deploy

Vercel serves `public/` with no build step. The linked production branch is `main`. Changes can be reviewed via preview deployments before merging. The first starter release can also be deployed directly from its committed PR branch.

## Customize before marketing

Replace generic informational copy with your business details, substantiated offers, service area, and appropriate legal/privacy disclosures. Add a real inquiry destination before adding a lead form. The current calculator does not collect or send input values; hosting infrastructure may retain standard request logs.

## Checks

Run `node --check public/app.js`. Verify desktop/mobile layout, in-page navigation, calculator inputs (including zero and invalid amounts), and keyboard focus in a browser. No dependency install is required.

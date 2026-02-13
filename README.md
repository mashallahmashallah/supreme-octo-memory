# Mobile In-Browser TTS Lab

Performance-first static web app for evaluating in-browser TTS architecture on mobile Chrome/Safari with background downloads, worker execution, and persisted benchmark history.

## Run locally

```bash
npm ci
npm test
npm run start
```

Open http://127.0.0.1:4173/index.html.

## Notes
- Model artifacts are represented with placeholder shards under `public/models` in this iteration.
- The app is static and suitable for GitHub Pages deployment.

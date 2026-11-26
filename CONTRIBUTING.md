# Contributing to Coldkite

Thanks for helping. Issues and pull requests are welcome.

## Run it locally

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck
```

No environment variables are needed. Open Settings and use your own AI key and mail login.

## Ground rules

- **Keys stay in the browser.** Settings live in `localStorage`. AI calls go from the browser straight to the provider (`lib/ai.ts`). Don't add server-side storage, logging or analytics of keys, profiles or emails.
- **`app/api/send/route.ts` stays stateless.** It sends one email per request with the credentials it was given, and keeps nothing.
- **No guessed email addresses.** The AI may only use addresses written in the post.
- Keep changes small and focused, and describe how you tested them in the PR.

## Adding an AI provider

Most providers speak the OpenAI Chat Completions format and already work through "Other (OpenAI-compatible)". To add a named preset, add an entry to `AI_PROVIDERS` in `lib/settings.ts` and a case in `draftFromPost` / `listModels` in `lib/ai.ts`. The provider must allow browser (CORS) requests.

## Reporting a security issue

Please don't open a public issue. Use GitHub's private vulnerability reporting on this repo.

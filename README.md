# Family Travel Studio

An Astro + Cloudflare Pages travel planner for family vacations with toddlers. The app generates family-aware lodging, Southwest-first flight guidance, restaurants, activities, selectable options, and a built itinerary.

## Run locally

```bash
npm install
npm run dev
```

Astro preview does not run Cloudflare Pages Functions, so local preview uses local fallback saves and local demo search counts unless you run with Cloudflare's Pages dev tooling later.

## Build

```bash
npm run build
```

Cloudflare Workers settings:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Project name: `family-travel-app`
- Static assets directory is configured in [wrangler.jsonc](./wrangler.jsonc) as `./dist`

Cloudflare now deploys this app as a Worker with Static Assets. Astro builds the static site into `dist`, and [src/worker.js](./src/worker.js) handles `/api/generate-trip` before falling back to static assets.

## Supabase Setup

1. Create a Supabase project.
2. Run [supabase/schema.sql](./supabase/schema.sql) in the Supabase SQL editor.
3. Enable email magic-link auth in Supabase Auth.
4. Add your deployed Cloudflare Pages URL to Supabase Auth redirect URLs.

Public build variables:

```bash
PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
PUBLIC_SUPABASE_ANON_KEY="your-supabase-anon-key"
PUBLIC_OWNER_EMAIL="you@example.com"
```

Cloudflare Worker variables/secrets:

```bash
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-supabase-service-role-key"
OWNER_EMAIL="you@example.com"
OPENAI_API_KEY="your-openai-api-key"
# Optional. Defaults to gpt-4o-mini.
OPENAI_MODEL="gpt-4o-mini"
```

## Usage Gate

The `/api/generate-trip` Worker endpoint is the server-side gate for paid AI calls:

- Owner email signed in through Supabase: unlimited searches.
- Anonymous visitor: 3 AI demo searches.
- After 3 searches: endpoint returns a limit response and the UI opens sign-in.
- Once a request is allowed, the Worker calls OpenAI and returns a structured trip board.
- If OpenAI is unavailable, the UI falls back to the local generator so the app remains usable.

## Saved Trips

- Signed-in users save to Supabase `saved_trips`.
- Signed-out or unconfigured local preview saves to `localStorage`.
- Supabase Row Level Security keeps saved trips scoped to the signed-in user.

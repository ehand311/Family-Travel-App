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

Cloudflare Pages settings:

- Build command: `npm run build`
- Build output directory: `dist`
- Framework preset: Astro

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

Cloudflare Pages Function variables/secrets:

```bash
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-supabase-service-role-key"
OWNER_EMAIL="you@example.com"
OPENAI_API_KEY="add-later-when-real-ai-generation-is-enabled"
```

## Usage Gate

The current `/api/generate-trip` Pages Function is the server-side gate for future paid AI calls:

- Owner email signed in through Supabase: unlimited searches.
- Anonymous visitor: 3 demo searches.
- After 3 searches: endpoint returns a limit response and the UI opens sign-in.

The app still uses the local option generator today. The next step is replacing that local generator with the model response from `/api/generate-trip` after the quota check passes.

## Saved Trips

- Signed-in users save to Supabase `saved_trips`.
- Signed-out or unconfigured local preview saves to `localStorage`.
- Supabase Row Level Security keeps saved trips scoped to the signed-in user.

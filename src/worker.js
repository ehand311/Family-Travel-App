const ANON_LIMIT = 3;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/generate-trip") {
      if (request.method === "GET") {
        return json({ ok: true, limit: ANON_LIMIT });
      }

      if (request.method === "POST") {
        return handleGenerateTrip(request, env);
      }

      return json({ message: "Method not allowed" }, { status: 405 });
    }

    return env.ASSETS.fetch(request);
  }
};

async function handleGenerateTrip(request, env) {
  const visitorId = getVisitorId(request);
  const nextVisitorId = visitorId || crypto.randomUUID();
  const cookieHeader = makeVisitorCookie(nextVisitorId);
  const supabaseUrl = normalizeSupabaseUrl(env.SUPABASE_URL);
  const serviceRoleKey = cleanEnvValue(env.SUPABASE_SERVICE_ROLE_KEY);
  const config = {
    ...env,
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey
  };

  if (!supabaseUrl || !serviceRoleKey) {
    return json(
      {
        allowed: true,
        configured: false,
        isOwner: false,
        remaining: ANON_LIMIT,
        message: "Supabase is not configured yet. Local/demo generation is allowed."
      },
      { headers: cookieHeader }
    );
  }

  const user = await getSupabaseUser(request, config);
  const ownerEmail = cleanEnvValue(env.OWNER_EMAIL).toLowerCase();
  const isOwner = Boolean(user?.email && ownerEmail && user.email.toLowerCase() === ownerEmail);

  if (isOwner) {
    return json(
      {
        allowed: true,
        configured: true,
        isOwner: true,
        remaining: null,
        message: "Owner search allowed."
      },
      { headers: cookieHeader }
    );
  }

  const quota = await incrementAnonymousUsage(config, nextVisitorId);
  if (!quota.allowed) {
    return json(
      {
        allowed: false,
        configured: true,
        isOwner: false,
        remaining: 0,
        message: "Demo search limit reached. Sign in as owner to continue."
      },
      { status: 429, headers: cookieHeader }
    );
  }

  return json(
    {
      allowed: true,
      configured: true,
      isOwner: false,
      remaining: Math.max(0, ANON_LIMIT - quota.count),
      message: "Demo search allowed."
    },
    { headers: cookieHeader }
  );
}

async function getSupabaseUser(request, env) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;

  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: authorization
    }
  });

  if (!response.ok) return null;
  return response.json();
}

async function incrementAnonymousUsage(env, visitorId) {
  const existingResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/search_usage?visitor_id=eq.${encodeURIComponent(visitorId)}&select=visitor_id,search_count`,
    { headers: serviceHeaders(env) }
  );

  if (!existingResponse.ok) {
    return { allowed: true, count: 1 };
  }

  const existingRows = await existingResponse.json();
  const existing = existingRows[0];
  if (!existing) {
    await fetch(`${env.SUPABASE_URL}/rest/v1/search_usage`, {
      method: "POST",
      headers: {
        ...serviceHeaders(env),
        Prefer: "return=minimal"
      },
      body: JSON.stringify({ visitor_id: visitorId, search_count: 1 })
    });
    return { allowed: true, count: 1 };
  }

  const currentCount = Number(existing.search_count || 0);
  if (currentCount >= ANON_LIMIT) {
    return { allowed: false, count: currentCount };
  }

  const nextCount = currentCount + 1;
  await fetch(`${env.SUPABASE_URL}/rest/v1/search_usage?visitor_id=eq.${encodeURIComponent(visitorId)}`, {
    method: "PATCH",
    headers: {
      ...serviceHeaders(env),
      Prefer: "return=minimal"
    },
    body: JSON.stringify({ search_count: nextCount, last_search_at: new Date().toISOString() })
  });

  return { allowed: true, count: nextCount };
}

function serviceHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json"
  };
}

function getVisitorId(request) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)fts_visitor=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function makeVisitorCookie(visitorId) {
  return {
    "Set-Cookie": `fts_visitor=${encodeURIComponent(visitorId)}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly; Secure`
  };
}

function cleanEnvValue(value) {
  return String(value || "").trim().replace(/^["']|["']$/g, "");
}

function normalizeSupabaseUrl(value) {
  const cleaned = cleanEnvValue(value).replace(/\/+$/, "");
  if (!cleaned || /^https?:\/\//i.test(cleaned)) return cleaned;
  if (/^[a-z0-9]+$/i.test(cleaned)) return `https://${cleaned}.supabase.co`;
  return cleaned;
}

function json(body, init = {}) {
  return Response.json(body, {
    status: init.status || 200,
    headers: init.headers || {}
  });
}

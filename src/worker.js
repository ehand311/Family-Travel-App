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

    if (url.pathname === "/api/build-itinerary") {
      if (request.method === "POST") {
        return handleBuildItinerary(request, env);
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
  const body = await request.json().catch(() => ({}));
  const tripInput = normalizeTripInput(body.tripInput || {});
  const supabaseUrl = normalizeSupabaseUrl(env.SUPABASE_URL);
  const serviceRoleKey = cleanEnvValue(env.SUPABASE_SERVICE_ROLE_KEY);
  const openAiKey = cleanEnvValue(env.OPENAI_API_KEY);
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
        message: "Supabase is not configured yet. Local/demo generation is allowed.",
        plan: null
      },
      { headers: cookieHeader }
    );
  }

  const user = await getSupabaseUser(request, config);
  const ownerEmail = cleanEnvValue(env.OWNER_EMAIL).toLowerCase();
  const isOwner = Boolean(user?.email && ownerEmail && user.email.toLowerCase() === ownerEmail);

  if (isOwner) {
    const { plan, error } = await safelyBuildTripPlan(openAiKey, tripInput, env);
    return json(
      {
        allowed: true,
        configured: true,
        isOwner: true,
        remaining: null,
        message: plan ? "Owner AI trip generated." : error || "Owner search allowed, but OpenAI is not configured yet.",
        plan
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
        message: "Demo search limit reached. Sign in as owner to continue.",
        plan: null
      },
      { status: 429, headers: cookieHeader }
    );
  }

  const { plan, error } = await safelyBuildTripPlan(openAiKey, tripInput, env);

  return json(
    {
      allowed: true,
      configured: true,
      isOwner: false,
      remaining: Math.max(0, ANON_LIMIT - quota.count),
      message: plan ? "Public AI trip generated." : error || "Demo search allowed, but OpenAI is not configured yet.",
      plan
    },
    { headers: cookieHeader }
  );
}

async function safelyBuildTripPlan(openAiKey, tripInput, env) {
  if (!openAiKey) {
    return { plan: null, error: "OpenAI is not configured yet. Add OPENAI_API_KEY as a Cloudflare secret." };
  }

  try {
    return { plan: await buildTripPlan(tripInput, env), error: "" };
  } catch (error) {
    console.error("AI trip generation failed", error);
    return { plan: null, error: "AI generation failed. Using a local preview instead." };
  }
}

async function handleBuildItinerary(request, env) {
  const visitorId = getVisitorId(request);
  const nextVisitorId = visitorId || crypto.randomUUID();
  const cookieHeader = makeVisitorCookie(nextVisitorId);
  const body = await request.json().catch(() => ({}));
  const plan = normalizeIncomingPlan(body.plan || {});
  const supabaseUrl = normalizeSupabaseUrl(env.SUPABASE_URL);
  const serviceRoleKey = cleanEnvValue(env.SUPABASE_SERVICE_ROLE_KEY);
  const openAiKey = cleanEnvValue(env.OPENAI_API_KEY);
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
        message: "Supabase is not configured yet. Local itinerary building is allowed.",
        itinerary: null
      },
      { headers: cookieHeader }
    );
  }

  const user = await getSupabaseUser(request, config);
  const ownerEmail = cleanEnvValue(env.OWNER_EMAIL).toLowerCase();
  const isOwner = Boolean(user?.email && ownerEmail && user.email.toLowerCase() === ownerEmail);

  if (!isOwner) {
    const quota = await incrementAnonymousUsage(config, nextVisitorId);
    if (!quota.allowed) {
      return json(
        {
          allowed: false,
          configured: true,
          isOwner: false,
          remaining: 0,
          message: "Demo AI limit reached. Sign in as owner to build more itineraries.",
          itinerary: null
        },
        { status: 429, headers: cookieHeader }
      );
    }

    const { itinerary, error } = await safelyBuildItinerary(openAiKey, plan, env);
    return json(
      {
        allowed: true,
        configured: true,
        isOwner: false,
        remaining: Math.max(0, ANON_LIMIT - quota.count),
        message: itinerary ? "AI itinerary built." : error || "Itinerary build allowed, but OpenAI is not configured yet.",
        itinerary
      },
      { headers: cookieHeader }
    );
  }

  const { itinerary, error } = await safelyBuildItinerary(openAiKey, plan, env);
  return json(
    {
      allowed: true,
      configured: true,
      isOwner: true,
      remaining: null,
      message: itinerary ? "Owner AI itinerary built." : error || "Owner itinerary build allowed, but OpenAI is not configured yet.",
      itinerary
    },
    { headers: cookieHeader }
  );
}

async function safelyBuildItinerary(openAiKey, plan, env) {
  if (!openAiKey) {
    return { itinerary: null, error: "OpenAI is not configured yet. Add OPENAI_API_KEY as a Cloudflare secret." };
  }

  try {
    return { itinerary: await buildTripItinerary(plan, env), error: "" };
  } catch (error) {
    console.error("AI itinerary generation failed", error);
    return { itinerary: null, error: "AI itinerary generation failed. Using a local itinerary instead." };
  }
}

async function buildTripPlan(tripInput, env) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cleanEnvValue(env.OPENAI_API_KEY)}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: cleanEnvValue(env.OPENAI_MODEL) || "gpt-4o-mini",
      input: [
        {
          role: "system",
          content:
            "You are a practical family travel planner for parents traveling with toddlers. Generate specific, searchable options with concise copy. Do not claim live availability, exact live prices, or guaranteed Southwest schedules. Use realistic estimates, real venue/property/area names when you know them, and toddler-aware tradeoffs: nap windows, stroller access, early meals, short drives, pool/down-time, kitchen/laundry, weather backups, and easy exits."
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "Create a family trip option board for a family of 4 with a 1-year-old and 2-year-old.",
            tripInput,
            outputRules: [
              "Return exactly four categories: lodging, flights, food, activities.",
              "Each category should contain three strong options.",
              "Use specific hotel/property or neighborhood names, Southwest-first flight strategy names, specific restaurants, and specific activities where possible.",
              "Respect the stated budgets as upper targets.",
              "Keep price strings short enough for compact cards, for example '$280/night', '~$320/person', '$65/family', or 'Free'.",
              "Keep option names under 64 characters when possible.",
              "Make why and timing practical, not salesy.",
              "Avoid repeating the same tags or phrases across every card.",
              "Use searchQuery values that would work well as Google searches.",
              "For flights, use Southwest-focused search queries and family timing notes."
            ]
          })
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "family_trip_options",
          strict: true,
          schema: tripOptionsSchema()
        }
      },
      max_output_tokens: 4500
    })
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "OpenAI request failed.");
    throw new Error(message.slice(0, 500));
  }

  const result = await response.json();
  const text = extractResponseText(result);
  return normalizeAiPlan(JSON.parse(text), tripInput);
}

async function buildTripItinerary(plan, env) {
  const selected = selectedOptionSummaries(plan);
  const builder = plan.builder || defaultBuilderSettings(plan.pace);
  const days = Math.min(Math.max(2, Number(plan.nights || 4) + 1), builder.dailyPace === "full" ? 7 : 6);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cleanEnvValue(env.OPENAI_API_KEY)}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: cleanEnvValue(env.OPENAI_MODEL) || "gpt-4o-mini",
      input: [
        {
          role: "system",
          content:
            "You build realistic day-by-day family travel itineraries for parents with toddlers. Use the selected trip options, protect nap/bedtime, avoid overpacked days, minimize unnecessary driving, and include simple backup logic. Do not claim live availability or exact operating hours."
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "Build an itinerary from the selected trip-board options.",
            destination: plan.destination,
            dateRange: plan.dateRange,
            nights: plan.nights,
            pace: plan.pace,
            notes: plan.notes,
            builder,
            selectedOptions: selected,
            outputRules: [
              `Return exactly ${days} days.`,
              "Day 1 should be arrival-focused unless the trip context clearly says otherwise.",
              "Last day should be departure-focused.",
              `Use the arrival window (${builder.arrivalWindow}), departure window (${builder.departureWindow}), nap window (${builder.napWindow}), and dinner time (${builder.dinnerTime}).`,
              `Use the builder daily pace (${builder.dailyPace}) over the original trip pace when they differ.`,
              "Use morning anchors, early lunches, nap/down-time, early dinners, and one flexible backup note per day.",
              "Apply builder notes when provided.",
              "Use selected restaurants and activities naturally, rotating them across days.",
              "Keep each field concise enough for a dashboard card."
            ]
          })
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "family_trip_itinerary",
          strict: true,
          schema: itinerarySchema()
        }
      },
      max_output_tokens: 3600
    })
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "OpenAI itinerary request failed.");
    throw new Error(message.slice(0, 500));
  }

  const result = await response.json();
  const text = extractResponseText(result);
  return normalizeAiItinerary(JSON.parse(text), days);
}

function tripOptionsSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["categories"],
    properties: {
      categories: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["key", "title", "summary", "options"],
          properties: {
            key: { type: "string", enum: ["lodging", "flights", "food", "activities"] },
            title: { type: "string" },
            summary: { type: "string" },
            options: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "price", "priceValue", "why", "timing", "tags", "searchQuery"],
                properties: {
                  name: { type: "string" },
                  price: { type: "string" },
                  priceValue: { type: "number" },
                  why: { type: "string" },
                  timing: { type: "string" },
                  tags: { type: "array", items: { type: "string" } },
                  searchQuery: { type: "string" }
                }
              }
            }
          }
        }
      }
    }
  };
}

function itinerarySchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["itinerary"],
    properties: {
      itinerary: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["day", "title", "morning", "lunch", "afternoon", "dinner", "notes"],
          properties: {
            day: { type: "number" },
            title: { type: "string" },
            morning: { type: "string" },
            lunch: { type: "string" },
            afternoon: { type: "string" },
            dinner: { type: "string" },
            notes: { type: "string" }
          }
        }
      }
    }
  };
}

function extractResponseText(result) {
  if (typeof result.output_text === "string" && result.output_text.trim()) {
    return result.output_text;
  }

  const text = result.output
    ?.flatMap((item) => item.content || [])
    ?.filter((item) => item.type === "output_text" || item.type === "text")
    ?.map((item) => item.text)
    ?.join("");

  if (!text) throw new Error("OpenAI returned an empty response.");
  return text;
}

function normalizeAiItinerary(aiResult, days) {
  const itinerary = Array.isArray(aiResult.itinerary) ? aiResult.itinerary : [];
  const normalized = itinerary.slice(0, days).map((day, index) => ({
    day: Number(day.day || index + 1),
    title: cleanText(day.title) || `Day ${index + 1}`,
    morning: cleanText(day.morning) || "Choose one easy morning anchor.",
    lunch: cleanText(day.lunch) || "Early casual lunch close to the morning plan.",
    afternoon: cleanText(day.afternoon) || "Nap, pool, or downtime reset.",
    dinner: cleanText(day.dinner) || "Early dinner with a simple fallback.",
    notes: cleanText(day.notes) || "Keep the day flexible and protect bedtime."
  }));

  while (normalized.length < days) {
    const day = normalized.length + 1;
    normalized.push({
      day,
      title: day === days ? "Easy departure day" : `Flexible family day ${day}`,
      morning: day === days ? "Pack, breakfast, and one short optional stop." : "Choose one easy morning anchor.",
      lunch: "Early casual lunch close to the day's plan.",
      afternoon: day === days ? "Travel buffer, stroller reset, and snack backup." : "Nap, pool, or downtime reset.",
      dinner: day === days ? "Home or simple travel-day dinner." : "Early dinner with a simple fallback.",
      notes: "Keep the day flexible and protect bedtime."
    });
  }

  return normalized;
}

function normalizeAiPlan(aiPlan, tripInput) {
  const categories = ["lodging", "flights", "food", "activities"].map((key) => {
    const category = aiPlan.categories?.find((item) => item.key === key) || {};
    return {
      key,
      kicker: categoryKicker(key),
      title: category.title || categoryTitle(key),
      icon: categoryIcon(key),
      summary: category.summary || categorySummary(key, tripInput),
      options: normalizeOptions(key, category.options || [], tripInput)
    };
  });

  return {
    id: crypto.randomUUID(),
    destination: tripInput.destination,
    origin: tripInput.origin,
    dateRange: formatDateRange(tripInput.startDate, tripInput.endDate),
    nights: differenceInDays(tripInput.startDate, tripInput.endDate),
    pace: tripInput.pace,
    priorities: tripInput.priorities,
    budget: {
      lodging: tripInput.lodgingBudget,
      flight: tripInput.flightBudget,
      food: tripInput.foodBudget,
      activity: tripInput.activityBudget
    },
    notes: tripInput.notes,
    createdAt: new Date().toISOString(),
    selectedOptionIds: categories.flatMap((category) => category.options[0]?.id || []).filter(Boolean),
    builder: defaultBuilderSettings(tripInput.pace),
    itinerary: [],
    categories
  };
}

function normalizeIncomingPlan(plan) {
  return {
    id: cleanText(plan.id),
    destination: cleanText(plan.destination) || "your destination",
    origin: cleanText(plan.origin),
    dateRange: cleanText(plan.dateRange),
    nights: numberOr(plan.nights, 4),
    pace: cleanText(plan.pace) || "easy",
    priorities: Array.isArray(plan.priorities) ? plan.priorities.map(cleanText).filter(Boolean) : [],
    budget: plan.budget || {},
    notes: cleanText(plan.notes),
    selectedOptionIds: Array.isArray(plan.selectedOptionIds) ? plan.selectedOptionIds.map(cleanText).filter(Boolean) : [],
    builder: normalizeBuilderSettings(plan.builder, cleanText(plan.pace) || "easy"),
    categories: Array.isArray(plan.categories) ? plan.categories : []
  };
}

function selectedOptionSummaries(plan) {
  return (plan.categories || []).map((category) => {
    const options = Array.isArray(category.options) ? category.options : [];
    const selected = options.filter((option) => plan.selectedOptionIds.includes(option.id));
    return {
      category: category.key || category.title,
      options: selected.map((option) => ({
        name: option.name,
        price: option.price,
        why: option.why,
        timing: option.timing,
        tags: option.tags || []
      }))
    };
  }).filter((group) => group.options.length);
}

function defaultBuilderSettings(pace = "balanced") {
  return {
    arrivalWindow: "midday",
    departureWindow: "midday",
    napWindow: "1:00-3:00 PM",
    dinnerTime: "5:15 PM",
    dailyPace: pace === "full" ? "balanced" : pace || "balanced",
    notes: ""
  };
}

function normalizeBuilderSettings(builder = {}, pace = "balanced") {
  const defaults = defaultBuilderSettings(pace);
  return {
    arrivalWindow: cleanText(builder.arrivalWindow) || defaults.arrivalWindow,
    departureWindow: cleanText(builder.departureWindow) || defaults.departureWindow,
    napWindow: cleanText(builder.napWindow) || defaults.napWindow,
    dinnerTime: cleanText(builder.dinnerTime) || defaults.dinnerTime,
    dailyPace: ["easy", "balanced", "full"].includes(builder.dailyPace) ? builder.dailyPace : defaults.dailyPace,
    notes: cleanText(builder.notes)
  };
}

function normalizeOptions(category, options, tripInput) {
  const fallback = fallbackOptions(category, tripInput);
  const source = options.length ? options : fallback;

  return source.slice(0, 3).map((option, index) => {
    const name = cleanText(option.name) || fallback[index]?.name || categoryTitle(category);
    const searchQuery = cleanText(option.searchQuery) || `${name} ${tripInput.destination}`;
    return {
      id: `${category}-${slugify(name)}-${index + 1}`,
      category,
      name,
      price: cleanText(option.price) || fallback[index]?.price || "$0 estimate",
      priceValue: Number(option.priceValue || fallback[index]?.priceValue || 0),
      why: cleanText(option.why) || fallback[index]?.why || "Good family fit with flexible timing.",
      timing: cleanText(option.timing) || fallback[index]?.timing || "Use as a flexible option.",
      link: searchUrl(category === "flights" ? `Southwest ${searchQuery}` : searchQuery),
      tags: Array.isArray(option.tags) && option.tags.length ? option.tags.slice(0, 4).map(cleanText) : fallback[index]?.tags || ["family-friendly"]
    };
  });
}

function normalizeTripInput(input) {
  const destination = cleanText(input.destination) || "San Diego, CA";
  const origin = cleanText(input.origin || "AUS").toUpperCase().slice(0, 3);
  const startDate = cleanText(input.startDate) || new Date().toISOString().slice(0, 10);
  const fallbackEnd = new Date(`${startDate}T12:00:00`);
  fallbackEnd.setDate(fallbackEnd.getDate() + 5);

  return {
    destination,
    origin,
    startDate,
    endDate: cleanText(input.endDate) || fallbackEnd.toISOString().slice(0, 10),
    kids: cleanText(input.kids) || "1 and 2 year old",
    pace: ["easy", "balanced", "full"].includes(input.pace) ? input.pace : "easy",
    lodgingBudget: numberOr(input.lodgingBudget, 360),
    flightBudget: numberOr(input.flightBudget, 360),
    foodBudget: numberOr(input.foodBudget, 80),
    activityBudget: numberOr(input.activityBudget, 100),
    priorities: Array.isArray(input.priorities) ? input.priorities.map(cleanText).filter(Boolean) : [],
    notes: cleanText(input.notes)
  };
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function cleanText(value) {
  return String(value || "").trim();
}

function formatDateRange(startDate, endDate) {
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

function differenceInDays(startDate, endDate) {
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
}

function searchUrl(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function fallbackOptions(category, tripInput) {
  const destination = tripInput.destination;
  const options = {
    lodging: [
      ["Family suite in a walkable base", tripInput.lodgingBudget * 0.92, "per night", "A practical base with room for toddler gear, snacks, and nap resets.", "Use for every night."],
      ["Apartment-style stay with kitchen", tripInput.lodgingBudget * 0.82, "per night", "Kitchen and laundry access reduce meal and packing friction.", "Best when routines matter."],
      ["Hotel or resort with pool reset", tripInput.lodgingBudget * 1.05, "per night", "Built-in downtime makes afternoons easier.", "Use for weather or post-nap resets."]
    ],
    flights: [
      ["Southwest morning nonstop target", tripInput.flightBudget * 0.95, "per person", "Shortest travel day and best odds with toddlers.", "Aim for 8-10 a.m."],
      ["Southwest one-stop with buffer", tripInput.flightBudget * 0.82, "per person", "Often cheaper while preserving diaper and snack time.", "Target 75-110 minute layover."],
      ["Southwest flexible fare watch", tripInput.flightBudget * 1.05, "per person", "Useful for points and fare-drop rebooking.", "Track after booking."]
    ],
    food: [
      ["Family-friendly local cafe", tripInput.foodBudget * 0.78, "meal for 4", "Fast seating and flexible menus help with early meals.", "Good lunch or first dinner."],
      ["Casual market hall", tripInput.foodBudget * 1.05, "meal for 4", "Multiple choices reduce toddler menu risk.", "Use for early dinner."],
      ["Grocery and breakfast setup", tripInput.foodBudget * 0.55, "stock-up", "Milk, fruit, snacks, and parent coffee smooth out mornings.", "Do this on arrival day."]
    ],
    activities: [
      ["Top family attraction", tripInput.activityBudget * 0.95, "family", "One memorable anchor without overloading the day.", "Best first full morning."],
      ["Nearby playground or waterfront walk", tripInput.activityBudget * 0.25, "family", "Low-cost reset with an easy exit.", "Use before nap."],
      ["Children-friendly museum or aquarium", tripInput.activityBudget * 0.7, "family", "Weather-proof backup with short-visit flexibility.", "Save for backup."]
    ]
  };

  return options[category].map(([name, amount, unit, why, timing]) => ({
    name,
    price: `$${Math.round(amount)} ${unit}`,
    priceValue: Math.round(amount),
    why,
    timing,
    searchQuery: category === "flights" ? `flights ${tripInput.origin} to ${destination}` : `${name} ${destination}`,
    tags: category === "flights" ? ["Southwest", tripInput.origin, "family boarding"] : ["family-friendly", "toddler-aware"]
  }));
}

function categoryKicker(key) {
  return {
    lodging: "Lodging",
    flights: "Flights",
    food: "Restaurants",
    activities: "Things to do"
  }[key];
}

function categoryTitle(key) {
  return {
    lodging: "Stay options",
    flights: "Southwest-first routes",
    food: "Meal options",
    activities: "Activity options"
  }[key];
}

function categoryIcon(key) {
  return {
    lodging: "hotel",
    flights: "plane",
    food: "utensils",
    activities: "star"
  }[key];
}

function categorySummary(key, tripInput) {
  return {
    lodging: `Filtered around $${tripInput.lodgingBudget}/night with family space and easy nap resets.`,
    flights: `Southwest-first timing around $${tripInput.flightBudget}/person.`,
    food: `Early, toddler-friendly meals around $${tripInput.foodBudget} for four.`,
    activities: `Family activities around $${tripInput.activityBudget}/day with easy exits.`
  }[key];
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

const path = require("path");
const express = require("express");
const dotenv = require("dotenv");
const OpenAI = require("openai");

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
const client = apiKey ? new OpenAI({ apiKey }) : null;
const rideOptionsCache = new Map();
const rideOptionsCacheMs = Number(process.env.RIDE_OPTIONS_CACHE_MS || 30 * 60 * 1000);

function getRideOptionsCacheKey(parks) {
  return parks
    .map((park) => String(park).trim().toLowerCase())
    .sort()
    .join("|");
}

async function createJsonCompletion(systemContent, userPayload, temperature = 0.4) {
  const completion = await client.chat.completions.create({
    model,
    temperature,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: systemContent,
      },
      {
        role: "user",
        content: JSON.stringify(userPayload),
      },
    ],
  });

  return JSON.parse(completion.choices?.[0]?.message?.content || "{}");
}

app.post("/api/ride-options", async (req, res) => {
  if (!client) {
    return res.status(500).json({ error: "Missing OPENAI_API_KEY on server." });
  }

  try {
    const parks = Array.isArray(req.body?.parks)
      ? req.body.parks.filter((park) => typeof park === "string" && park.trim())
      : [];

    if (!parks.length) {
      return res.status(400).json({ error: "Missing parks payload." });
    }

    const cacheKey = getRideOptionsCacheKey(parks);
    const cached = rideOptionsCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < rideOptionsCacheMs) {
      return res.json({ parks: cached.parks, cached: true });
    }

    const parsed = await createJsonCompletion(
      "You generate ride option data for a Universal Orlando planner. Return strict JSON only with one key: parks. The value must be an object keyed by the exact requested park names. Each park value must be an array containing the full set of major rides and ride-like attractions available in that park, not a short sample. Do not limit the count. Each ride object must include name (string), waitMinutes (integer), category (one of thrill, family, dark-ride, water, simulator, coaster, show), intensity (one of low, medium, high), environment (one of indoor, outdoor, mixed), transferSupport (short string describing transfer expectations), and accessibilityNote (short string describing accessibility context). Use real attractions for the requested Universal Orlando parks, avoid duplicates, and do not include parks that were not requested.",
      {
        task: "Generate the complete ride option list for the selected parks.",
        parks,
      },
      0.3,
    );

    const normalizedParks = {};
    parks.forEach((park) => {
      const rides = Array.isArray(parsed?.parks?.[park]) ? parsed.parks[park] : [];
      const normalized = rides
        .filter((ride) => ride && ride.name)
        .map((ride) => ({
          name: String(ride.name),
          waitMinutes: Number.isFinite(Number(ride.waitMinutes))
            ? Number(ride.waitMinutes)
            : 40,
          category: String(ride.category || "family").toLowerCase(),
          intensity: String(ride.intensity || "medium").toLowerCase(),
          environment: String(ride.environment || "mixed").toLowerCase(),
          transferSupport: String(ride.transferSupport || "Ask at load station"),
          accessibilityNote: String(ride.accessibilityNote || "Check ride-specific accessibility details before boarding."),
        }));

      if (normalized.length) {
        normalizedParks[park] = normalized;
      }
    });

    if (!Object.keys(normalizedParks).length) {
      return res.status(502).json({ error: "Model returned no ride options." });
    }

    rideOptionsCache.set(cacheKey, {
      createdAt: Date.now(),
      parks: normalizedParks,
    });

    return res.json({ parks: normalizedParks, cached: false });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to generate ride options.",
      detail: error?.message || "Unknown server error",
    });
  }
});

app.post("/api/generate-day", async (req, res) => {
  if (!client) {
    return res.status(500).json({ error: "Missing OPENAI_API_KEY on server." });
  }

  try {
    const answers = req.body?.answers;
    if (!answers || typeof answers !== "object") {
      return res.status(400).json({ error: "Missing answers payload." });
    }

    const parsed = await createJsonCompletion(
      "You are an itinerary planner for a theme park accessibility app. Return strict JSON only with keys: subtitle (string), note (string), itinerary (array). Each itinerary item must include time (12-hour time like 9:00 AM), title, desc, tag. Build a practical day plan using the provided accessibility preferences, selected parks, time per park, and rides per park. Include at least one item after lunch if meal is planned.",
      {
        task: "Generate a same-day itinerary from this planning form.",
        answers,
      },
    );

    const itinerary = Array.isArray(parsed.itinerary) ? parsed.itinerary : [];

    if (!itinerary.length) {
      return res.status(502).json({ error: "Model returned no itinerary items." });
    }

    const normalized = itinerary
      .filter((item) => item && item.time && item.title)
      .map((item) => ({
        time: String(item.time),
        title: String(item.title),
        desc: String(item.desc || "Accessibility-friendly stop."),
        tag: String(item.tag || "Suggested"),
      }));

    if (!normalized.length) {
      return res.status(502).json({ error: "Model response could not be normalized." });
    }

    return res.json({
      subtitle: String(parsed.subtitle || "AI-generated from your park selections"),
      note: String(parsed.note || "AI route generated from your selected parks, times, rides, and accessibility settings."),
      itinerary: normalized,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to generate itinerary.",
      detail: error?.message || "Unknown server error",
    });
  }
});

app.listen(port, () => {
  console.log(`Planner server running at http://localhost:${port}`);
});


export async function onRequest(context) {
  const apiKey = context.env.CRICKET_API_KEY;

  const headers = {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8"
  };

  const cache = caches.default;

  const cacheKey = new Request(
    new URL("/__cricpluse_cache/live-scores", context.request.url)
  );

  const cooldownKey = new Request(
    new URL("/__cricpluse_cache/live-scores-cooldown", context.request.url)
  );

  const CACHE_TTL = 90;
  const COOLDOWN_MS = 15 * 60 * 1000;

  async function readCachedScores() {
    try {
      const response = await cache.match(cacheKey);
      if (!response) return null;

      const saved = await response.json();

      if (!saved?.payload || !Number.isFinite(saved.cachedAt)) {
        return null;
      }

      return saved;
    } catch {
      return null;
    }
  }

  async function isCoolingDown() {
    try {
      const response = await cache.match(cooldownKey);
      if (!response) return false;

      const saved = await response.json();

      return Number.isFinite(saved?.cooldownUntil) &&
        saved.cooldownUntil > Date.now();
    } catch {
      return false;
    }
  }

  async function setCooldown() {
    try {
      await cache.put(
        cooldownKey,
        new Response(
          JSON.stringify({
            cooldownUntil: Date.now() + COOLDOWN_MS
          }),
          {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=900"
            }
          }
        )
      );
    } catch {}
  }

  async function useCachedScores(reason, setCooldownFlag = true) {
    const reasonText = String(reason || "Unknown provider error");

    if (
      setCooldownFlag &&
      /blocked|429|rate.?limit|too many|15 minutes/i.test(reasonText)
    ) {
      await setCooldown();
    }

    const saved = await readCachedScores();

    if (saved) {
      return Response.json(
        {
          ...saved.payload,
          stale: true,
          staleMessage:
            "Showing the last saved scores because live updates are temporarily unavailable.",
          lastSuccessfulUpdate: new Date(saved.cachedAt).toISOString()
        },
        { status: 200, headers }
      );
    }

    return Response.json(
      {
        status: "error",
        message: "Cricket scores are temporarily unavailable.",
        reason: reasonText.slice(0, 250)
      },
      { status: 502, headers }
    );
  }

  if (!apiKey || !apiKey.trim()) {
    return Response.json(
      {
        status: "error",
        message: "Cricket API key is not configured."
      },
      { status: 500, headers }
    );
  }

  const saved = await readCachedScores();

  if (saved && Date.now() - saved.cachedAt < CACHE_TTL * 1000) {
    return Response.json(saved.payload, {
      status: 200,
      headers
    });
  }

  if (await isCoolingDown()) {
    return useCachedScores(
      "Provider cooldown is active; waiting before retrying.",
      false
    );
  }

  const apiUrl = new URL(
    "https://api.cricapi.com/v1/currentMatches"
  );

  apiUrl.searchParams.set("apikey", apiKey.trim());
  apiUrl.searchParams.set("offset", "0");

  try {
    const response = await fetch(apiUrl.toString(), {
      cache: "no-store"
    });

    let data;

    try {
      data = await response.json();
    } catch {
      return useCachedScores(
        `Invalid provider response. HTTP ${response.status}`
      );
    }

    const providerReason = String(
      data?.reason || data?.message || ""
    );

    const providerStatus = String(
      data?.status || ""
    ).toLowerCase();

    const blockedPattern =
      /blocked|rate.?limit|too many requests|15 minutes|temporarily blocked/i;

    if (
      response.status === 429 ||
      blockedPattern.test(providerReason)
    ) {
      await setCooldown();

      return useCachedScores(
        providerReason || `Provider rate limit. HTTP ${response.status}`,
        false
      );
    }

    if (
      !response.ok ||
      providerStatus === "failure" ||
      providerStatus === "error"
    ) {
      return useCachedScores(
        providerReason || `HTTP ${response.status}`
      );
    }

    if (!Array.isArray(data.data)) {
      return useCachedScores(
        "The provider did not return a valid match list."
      );
    }

    const completedPattern =
      /\b(won|drawn|tied|abandoned|cancelled|canceled|no result|match complete|match completed|innings victory|conceded|forfeited)\b/i;

    const pausedPattern =
      /\bstumps?\b|\blunch\b|\btea\b|rain delay|bad light|play suspended|day\s*\d+\s*close|innings break|match delayed|weather interruption|interval|rain stopped play|bad weather/i;

    const matches = data.data.map((match) => {
      const status = String(match.status || "").trim();

      let matchState;

      if (
        match.matchEnded === true ||
        completedPattern.test(status)
      ) {
        matchState = "COMPLETED";
      } else if (
        pausedPattern.test(status) ||
        String(match.matchState || "").toUpperCase() === "PAUSED"
      ) {
        matchState = "PAUSED";
      } else if (
        String(match.matchState || "").toUpperCase() === "LIVE" ||
        match.matchStarted === true
      ) {
        matchState = "LIVE";
      } else {
        matchState = "UPCOMING";
      }

      const scores = Array.isArray(match.score)
        ? match.score.map((score, index) => {
            const inningName =
              score.providerInning ||
              score.inning ||
              `Innings ${index + 1}`;

            return {
              ...score,
              runs: score.r ?? score.runs ?? "",
              wickets: score.w ?? score.wickets ?? "",
              overs: score.o ?? score.overs ?? "",
              providerInning: inningName,
              inning: inningName
            };
          })
        : [];

      return {
        ...match,
        matchState,
        score: scores
      };
    });

    const { apikey, ...safeData } = data;

    const now = Date.now();

    const payload = {
      ...safeData,
      status: data.status || "success",
      data: matches,
      stale: false,
      lastSuccessfulUpdate: new Date(now).toISOString()
    };

    try {
      await cache.put(
        cacheKey,
        new Response(
          JSON.stringify({
            payload,
            cachedAt: now
          }),
          {
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "public, max-age=90"
            }
          }
        )
      );
    } catch {}

    return Response.json(payload, {
      status: 200,
      headers
    });

  } catch (error) {
    return useCachedScores(
      error?.message || "Network request failed or provider is unreachable."
    );
  }
}


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

  const CACHE_TTL = 90;

  async function readCachedScores() {
    try {
      const response = await cache.match(cacheKey);
      if (!response) return null;

      const saved = await response.json();

      if (
        !saved ||
        !saved.payload ||
        !Number.isFinite(saved.cachedAt)
      ) {
        return null;
      }

      return saved;
    } catch {
      return null;
    }
  }

  async function useCachedScores(reason) {
    const saved = await readCachedScores();

    if (saved) {
      return Response.json(
        {
          ...saved.payload,
          stale: true,
          staleMessage:
            "Showing the last saved scores because live updates are temporarily unavailable.",
          lastSuccessfulUpdate: new Date(
            saved.cachedAt
          ).toISOString()
        },
        { status: 200, headers }
      );
    }

    return Response.json(
      {
        status: "error",
        message: "Cricket scores are temporarily unavailable.",
        reason: String(
          reason || "No saved scores are available."
        ).slice(0, 250)
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

  if (
    saved &&
    Date.now() - saved.cachedAt < CACHE_TTL * 1000
  ) {
    return Response.json(saved.payload, {
      status: 200,
      headers
    });
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

    if (
      !response.ok ||
      data.status === "failure" ||
      data.status === "error"
    ) {
      return useCachedScores(
        data.reason ||
        data.message ||
        `HTTP ${response.status}`
      );
    }

    if (!Array.isArray(data.data)) {
      return useCachedScores(
        "The provider did not return a valid match list."
      );
    }

    // Match results that indicate the match has finished.
    const completedPattern =
      /\b(won|drawn|tied|abandoned|cancelled|canceled|no result|match complete|match completed|innings victory|conceded|forfeited)\b/i;

    // A match may have started but temporarily stopped.
    const breakPattern =
      /\b(stumps|lunch|tea|rain delay|bad light|play suspended|day \d+ close|day \d+ stumps|innings break|interval)\b/i;

    const matches = data.data.map((match) => {
      const status = String(match.status || "").trim();

      let matchState;

      if (
        match.matchEnded === true ||
        completedPattern.test(status)
      ) {
        matchState = "COMPLETED";
      } else if (breakPattern.test(status)) {
        matchState = "PAUSED";
      } else if (match.matchStarted === true) {
        matchState = "LIVE";
      } else {
        matchState = "UPCOMING";
      }

      const scores = Array.isArray(match.score)
        ? match.score.map((score, index) => ({
            ...score,
            providerInning: score.inning || "",
            inning: `Innings ${index + 1}`
          }))
        : [];

      return {
        ...match,
        matchState,
        score: scores
      };
    });

    // Never expose the provider API key.
    const { apikey, ...safeData } = data;

    const payload = {
      ...safeData,
      status: data.status || "success",
      data: matches,
      stale: false,
      lastSuccessfulUpdate: new Date().toISOString()
    };

    try {
      await cache.put(
        cacheKey,
        new Response(
          JSON.stringify({
            payload,
            cachedAt: Date.now()
          }),
          {
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "public, max-age=90"
            }
          }
        )
      );
    } catch {
      // Scores can still be returned if caching fails.
    }

    return Response.json(payload, {
      status: 200,
      headers
    });
  } catch {
    return useCachedScores(
      "Network request failed or the provider is unreachable."
    );
  }
}

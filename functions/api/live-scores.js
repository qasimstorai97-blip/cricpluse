
export async function onRequest(context) {
  const apiKey = context.env.CRICKET_API_KEY;

  const headers = {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8"
  };

  // Check whether the API key is configured.
  if (!apiKey || !apiKey.trim()) {
    return Response.json(
      {
        status: "error",
        message: "Cricket API key is not configured."
      },
      { status: 500, headers }
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
      return Response.json(
        {
          status: "error",
          message: "The cricket provider returned an invalid response.",
          reason: `HTTP ${response.status}`
        },
        { status: 502, headers }
      );
    }

    // Report a useful error without exposing the API key.
    if (
      !response.ok ||
      data.status === "failure" ||
      data.status === "error"
    ) {
      const reason = String(
        data.reason ||
        data.message ||
        `HTTP ${response.status}`
      ).slice(0, 250);

      return Response.json(
        {
          status: "error",
          message: "The cricket score provider returned an error.",
          reason
        },
        { status: 502, headers }
      );
    }

    // Never expose the provider API key.
    const { apikey, ...safeData } = data;

    if (!Array.isArray(data.data)) {
      return Response.json(
        {
          ...safeData,
          status: data.status || "success",
          data: []
        },
        { status: 200, headers }
      );
    }

    const matches = data.data.map((match) => {
      const status = String(match.status || "").trim();

      const completedPattern =
        /\b(won|drawn|tied|abandoned|cancelled|canceled|no result|match complete|match completed|innings victory|conceded|forfeited)\b/i;

      let matchState;

      if (
        match.matchEnded === true ||
        completedPattern.test(status)
      ) {
        matchState = "COMPLETED";
      } else if (match.matchStarted === true) {
        matchState = "LIVE";
      } else {
        matchState = "UPCOMING";
      }

      // Preserve the provider's original innings information.
      // Do not alter runs, wickets, overs, or team data.
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

    return Response.json(
      {
        ...safeData,
        status: data.status || "success",
        data: matches
      },
      { status: 200, headers }
    );
  } catch {
    return Response.json(
      {
        status: "error",
        message: "Could not fetch cricket scores.",
        reason: "Network request failed or the provider is unreachable."
      },
      { status: 502, headers }
    );
  }
}

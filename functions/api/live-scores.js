
export async function onRequest(context) {
  const apiKey = context.env.CRICKET_API_KEY;

  const headers = {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8"
  };

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
          message: "The cricket provider returned an invalid response."
        },
        { status: 502, headers }
      );
    }

    if (
      !response.ok ||
      data.status === "failure" ||
      data.status === "error"
    ) {
      return Response.json(
        {
          status: "error",
          message: "The cricket score provider returned an error."
        },
        { status: 502, headers }
      );
    }

    // Never expose the provider API key to website visitors.
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

      // A confirmed completed match must never be labelled LIVE.
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

      // Keep the original score data, but provide clean inning labels
      // for the website to display. Do not change runs, wickets or overs.
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
        message: "Could not fetch cricket scores."
      },
      { status: 502, headers }
    );
  }
}

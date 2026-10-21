
export async function onRequest(context) {
  const apiKey = context.env.CRICKET_API_KEY;

  const headers = {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8"
  };

  if (!apiKey) {
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

    const data = await response.json();

    if (!response.ok || data.status === "failure") {
      return Response.json(
        {
          status: "error",
          message: "The cricket score provider returned an error."
        },
        { status: 502, headers }
      );
    }

    if (!Array.isArray(data.data)) {
      const { apikey, ...safeData } = data;

      return Response.json(safeData, {
        status: 200,
        headers
      });
    }

    const matches = data.data.map((match) => {
      const matchStatus = String(match.status || "").toLowerCase();

      const resultWords =
        /\b(won|drawn|tied|abandoned|cancelled|canceled|no result|match complete|match completed|innings victory)\b/i;

      let matchState;

      if (match.matchEnded === true || resultWords.test(matchStatus)) {
        matchState = "COMPLETED";
      } else if (match.matchStarted === true) {
        matchState = "LIVE";
      } else {
        matchState = "UPCOMING";
      }

      return {
        ...match,
        matchState
      };
    });

    // Never send the provider's API key back to website visitors.
    const { apikey, ...safeData } = data;

    return Response.json(
      {
        ...safeData,
        data: matches
      },
      {
        status: 200,
        headers
      }
    );
  } catch {
    return Response.json(
      {
        status: "error",
        message: "Could not fetch cricket scores."
      },
      {
        status: 502,
        headers
      }
    );
  }
}

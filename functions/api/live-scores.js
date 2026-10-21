
export async function onRequest(context) {
  const apiKey = context.env.CRICKET_API_KEY;

  if (!apiKey) {
    return Response.json(
      {
        status: "error",
        message: "CRICKET_API_KEY is not configured for this environment"
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store"
        }
      }
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

    return Response.json(data, {
      status: response.ok ? 200 : response.status,
      headers: {
        "Cache-Control": "no-store"
      }
    });
  } catch {
    return Response.json(
      {
        status: "error",
        message: "Could not fetch cricket scores"
      },
      {
        status: 502,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }
}

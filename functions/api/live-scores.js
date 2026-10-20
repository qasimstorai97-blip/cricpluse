
export async function onRequest(context) {
  const apiKey = context.env.CRICKET_API_KEY;

  if (!apiKey) {
    return Response.json(
      { status: "error", message: "API key is not configured" },
      { status: 500 }
    );
  }

  const apiUrl = new URL(
    "https://api.cricapi.com/v1/currentMatches"
  );

  apiUrl.searchParams.set("apikey", apiKey);
  apiUrl.searchParams.set("offset", "0");

  try {
    const response = await fetch(apiUrl.toString(), {
      cf: { cacheTtl: 600, cacheEverything: true }
    });

    const data = await response.json();

    return Response.json(data, {
      status: response.ok ? 200 : response.status,
      headers: {
        "Cache-Control": "public, max-age=60"
      }
    });
  } catch {
    return Response.json(
      { status: "error", message: "Could not fetch cricket scores" },
      { status: 502 }
    );
  }
}

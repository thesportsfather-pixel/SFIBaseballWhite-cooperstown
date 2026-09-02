function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

async function supabaseGet(env, path) {
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/${path}`,
    {
      method: "GET",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        accept: "application/json"
      }
    }
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Supabase ${response.status}: ${text}`
    );
  }

  return text ? JSON.parse(text) : [];
}

async function createStripeSession({
  env,
  origin,
  amountCents,
  donorName,
  anonymous,
  team,
  player
}) {
  const params = new URLSearchParams();

  const hasPlayer =
    Boolean(player);

  const donationType =
    hasPlayer
      ? "player_general"
      : "team_general";

  const successUrl =
    hasPlayer
      ? `${origin}/fundraiser.html?player=${encodeURIComponent(
          player.player_key
        )}&payment=success&session_id={CHECKOUT_SESSION_ID}`
      : `${origin}/?payment=success&session_id={CHECKOUT_SESSION_ID}`;

  const cancelUrl =
    hasPlayer
      ? `${origin}/fundraiser.html?player=${encodeURIComponent(
          player.player_key
        )}&payment=cancelled`
      : `${origin}/?payment=cancelled`;

  params.set(
    "mode",
    "payment"
  );

  params.set(
    "success_url",
    successUrl
  );

  params.set(
    "cancel_url",
    cancelUrl
  );

  params.set(
    "line_items[0][quantity]",
    "1"
  );

  params.set(
    "line_items[0][price_data][currency]",
    "usd"
  );

  params.set(
    "line_items[0][price_data][unit_amount]",
    String(amountCents)
  );

  params.set(
    "line_items[0][price_data][product_data][name]",
    hasPlayer
      ? `${player.player_name} – Cooperstown Donation`
      : `${team.team_name} – Cooperstown Team Donation`
  );

  params.set(
    "line_items[0][price_data][product_data][description]",
    hasPlayer
      ? `SFI White 12U player donation • Donor: ${donorName}`
      : `SFI White 12U team donation • Donor: ${donorName}`
  );

  params.set(
    "metadata[team_key]",
    env.TEAM_KEY
  );

  params.set(
    "metadata[team_id]",
    team.id
  );

  params.set(
    "metadata[donation_type]",
    donationType
  );

  params.set(
    "metadata[amount_cents]",
    String(amountCents)
  );

  params.set(
    "metadata[donor_name]",
    donorName
  );

  params.set(
    "metadata[anonymous]",
    anonymous
      ? "true"
      : "false"
  );

  params.set(
    "payment_intent_data[metadata][team_key]",
    env.TEAM_KEY
  );

  params.set(
    "payment_intent_data[metadata][team_id]",
    team.id
  );

  params.set(
    "payment_intent_data[metadata][donation_type]",
    donationType
  );

  params.set(
    "payment_intent_data[metadata][amount_cents]",
    String(amountCents)
  );

  params.set(
    "payment_intent_data[metadata][donor_name]",
    donorName
  );

  params.set(
    "payment_intent_data[metadata][anonymous]",
    anonymous
      ? "true"
      : "false"
  );

  if (hasPlayer) {
    params.set(
      "metadata[player_id]",
      player.id
    );

    params.set(
      "metadata[player_key]",
      player.player_key
    );

    params.set(
      "metadata[player_name]",
      player.player_name
    );

    params.set(
      "metadata[player_number]",
      String(
        player.player_number
      )
    );

    params.set(
      "payment_intent_data[metadata][player_id]",
      player.id
    );

    params.set(
      "payment_intent_data[metadata][player_key]",
      player.player_key
    );

    params.set(
      "payment_intent_data[metadata][player_name]",
      player.player_name
    );

    params.set(
      "payment_intent_data[metadata][player_number]",
      String(
        player.player_number
      )
    );
  }

  const stripeResponse =
    await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          authorization:
            `Bearer ${env.STRIPE_SECRET_KEY}`,
          "content-type":
            "application/x-www-form-urlencoded"
        },
        body: params.toString()
      }
    );

  const stripeText =
    await stripeResponse.text();

  let stripeData;

  try {
    stripeData =
      JSON.parse(stripeText);
  } catch {
    stripeData = null;
  }

  if (!stripeResponse.ok) {
    throw new Error(
      stripeData?.error?.message ||
      `Stripe ${stripeResponse.status}: ${stripeText}`
    );
  }

  if (!stripeData?.url) {
    throw new Error(
      "Stripe checkout URL was not returned."
    );
  }

  return stripeData;
}

export async function onRequestPost({
  request,
  env
}) {
  try {

    /* =========================
       CONFIG
    ========================= */

    if (
      !env.SUPABASE_URL ||
      !env.SUPABASE_SERVICE_ROLE_KEY ||
      !env.STRIPE_SECRET_KEY ||
      !env.TEAM_KEY
    ) {
      return json(
        {
          success: false,
          error:
            "Missing server configuration."
        },
        500
      );
    }


    /* =========================
       BODY
    ========================= */

    let body;

    try {
      body =
        await request.json();
    } catch {
      return json(
        {
          success: false,
          error:
            "Invalid request body."
        },
        400
      );
    }


    /* =========================
       AMOUNT
    ========================= */

    const amount =
      Number(
        body.amount
      );

    if (
      !Number.isFinite(amount) ||
      amount < 1
    ) {
      return json(
        {
          success: false,
          error:
            "Donation amount must be at least $1."
        },
        400
      );
    }

    const amountCents =
      Math.round(
        amount * 100
      );

    if (
      amountCents < 100
    ) {
      return json(
        {
          success: false,
          error:
            "Donation amount must be at least $1."
        },
        400
      );
    }


    /* =========================
       DONOR
    ========================= */

    const anonymous =
      body.anonymous === true ||
      body.anonymous === "true";

    let donorName;

    if (anonymous) {
      donorName =
        "Anonymous";
    } else {
      donorName =
        String(
          body.donorName ||
          ""
        )
          .trim()
          .replace(
            /\s+/g,
            " "
          );

      if (!donorName) {
        return json(
          {
            success: false,
            error:
              "Please enter a donor name or select Remain Anonymous."
          },
          400
        );
      }

      if (
        donorName.length > 50
      ) {
        donorName =
          donorName.slice(
            0,
            50
          );
      }
    }


    /* =========================
       TEAM
    ========================= */

    const teams =
      await supabaseGet(
        env,
        `teams?team_key=eq.${encodeURIComponent(
          env.TEAM_KEY
        )}&select=id,team_key,team_name&limit=1`
      );

    if (!teams.length) {
      return json(
        {
          success: false,
          error:
            "Team not found."
        },
        404
      );
    }

    const team =
      teams[0];


    /* =========================
       OPTIONAL PLAYER
    ========================= */

    const playerKey =
      String(
        body.playerKey ||
        body.player ||
        ""
      ).trim();

    let player = null;

    if (playerKey) {
      const players =
        await supabaseGet(
          env,
          `players?team_id=eq.${encodeURIComponent(
            team.id
          )}&player_key=eq.${encodeURIComponent(
            playerKey
          )}&select=id,player_key,player_name,player_number&limit=1`
        );

      if (!players.length) {
        return json(
          {
            success: false,
            error:
              "Player not found."
          },
          404
        );
      }

      player =
        players[0];
    }


    /* =========================
       ORIGIN
    ========================= */

    const requestUrl =
      new URL(
        request.url
      );

    const origin =
      request.headers.get(
        "origin"
      ) ||
      requestUrl.origin;


    /* =========================
       STRIPE
    ========================= */

    const session =
      await createStripeSession({
        env,
        origin,
        amountCents,
        donorName,
        anonymous,
        team,
        player
      });


    /* =========================
       RESPONSE
    ========================= */

    return json({
      success: true,

      url:
        session.url,

      sessionId:
        session.id,

      donationType:
        player
          ? "player_general"
          : "team_general",

      player:
        player
          ? player.player_key
          : null,

      donorName,

      anonymous,

      amountCents,

      amount:
        amountCents / 100
    });

  } catch (error) {

    console.error(
      "Create general donation error:",
      error
    );

    return json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : String(error)
      },
      500
    );

  }
}

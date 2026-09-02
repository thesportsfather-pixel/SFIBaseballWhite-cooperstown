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

async function createStripeCheckoutSession({
  env,
  origin,
  playerKey,
  playerName,
  playerNumber,
  selectedBalls,
  totalCents,
  donorName,
  anonymous,
  team
}) {
  const params = new URLSearchParams();

  params.set(
    "mode",
    "payment"
  );

  params.set(
    "success_url",
    `${origin}/fundraiser.html?player=${encodeURIComponent(
      playerKey
    )}&payment=success&session_id={CHECKOUT_SESSION_ID}`
  );

  params.set(
    "cancel_url",
    `${origin}/fundraiser.html?player=${encodeURIComponent(
      playerKey
    )}&payment=cancelled`
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
    String(totalCents)
  );

  params.set(
    "line_items[0][price_data][product_data][name]",
    `${playerName} – Cooperstown Baseball Sponsorship`
  );

  params.set(
    "line_items[0][price_data][product_data][description]",
    `SFI White 12U • Baseball${
      selectedBalls.length === 1
        ? ""
        : "s"
    } #${selectedBalls.join(", #")} • Donor: ${donorName}`
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
    "metadata[player_key]",
    playerKey
  );

  params.set(
    "metadata[player_name]",
    playerName
  );

  params.set(
    "metadata[player_number]",
    String(playerNumber)
  );

  params.set(
    "metadata[balls]",
    selectedBalls.join(",")
  );

  params.set(
    "metadata[baseball_numbers]",
    selectedBalls.join(",")
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
    "metadata[donation_type]",
    "baseballs"
  );

  params.set(
    "metadata[amount_cents]",
    String(totalCents)
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
    "payment_intent_data[metadata][player_key]",
    playerKey
  );

  params.set(
    "payment_intent_data[metadata][player_name]",
    playerName
  );

  params.set(
    "payment_intent_data[metadata][player_number]",
    String(playerNumber)
  );

  params.set(
    "payment_intent_data[metadata][balls]",
    selectedBalls.join(",")
  );

  params.set(
    "payment_intent_data[metadata][baseball_numbers]",
    selectedBalls.join(",")
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

  params.set(
    "payment_intent_data[metadata][donation_type]",
    "baseballs"
  );

  params.set(
    "payment_intent_data[metadata][amount_cents]",
    String(totalCents)
  );

  const stripeResponse = await fetch(
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
       ENVIRONMENT
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
       REQUEST BODY
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
       PLAYER
    ========================= */

    const playerKey =
      String(
        body.playerKey ||
        body.player ||
        ""
      ).trim();

    if (!playerKey) {
      return json(
        {
          success: false,
          error:
            "Player is required."
        },
        400
      );
    }


    /* =========================
       BASEBALLS
    ========================= */

    const rawBalls =
      Array.isArray(body.balls)
        ? body.balls
        : (
            Array.isArray(
              body.baseballs
            )
              ? body.baseballs
              : []
          );

    const selectedBalls =
      [
        ...new Set(
          rawBalls
            .map(Number)
            .filter(
              number =>
                Number.isInteger(
                  number
                ) &&
                number >= 1 &&
                number <= 100
            )
        )
      ].sort(
        (a, b) =>
          a - b
      );

    if (
      selectedBalls.length === 0
    ) {
      return json(
        {
          success: false,
          error:
            "Please select at least one baseball."
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
       PLAYER LOOKUP
    ========================= */

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

    const player =
      players[0];


    /* =========================
       LOAD BASEBALLS
    ========================= */

    const ballFilter =
      selectedBalls.join(",");

    const baseballRows =
      await supabaseGet(
        env,
        `baseballs?player_id=eq.${encodeURIComponent(
          player.id
        )}&ball_number=in.(${encodeURIComponent(
          ballFilter
        )})&select=id,ball_number,amount_cents,status,reserved_until,reservation_id`
      );


    if (
      baseballRows.length !==
      selectedBalls.length
    ) {
      return json(
        {
          success: false,
          error:
            "One or more selected baseballs could not be found."
        },
        400
      );
    }


    /* =========================
       CHECK AVAILABILITY
    ========================= */

    const now =
      Date.now();

    const unavailable =
      baseballRows.filter(
        ball => {

          const status =
            String(
              ball.status ||
              "available"
            ).toLowerCase();

          if (
            status === "sold"
          ) {
            return true;
          }

          if (
            status === "reserved"
          ) {

            const reservedUntil =
              ball.reserved_until
                ? new Date(
                    ball.reserved_until
                  ).getTime()
                : null;

            if (
              reservedUntil &&
              reservedUntil > now
            ) {
              return true;
            }

          }

          return false;
        }
      );


    if (
      unavailable.length
    ) {
      return json(
        {
          success: false,
          error:
            `Baseball${
              unavailable.length === 1
                ? ""
                : "s"
            } #${unavailable
              .map(
                ball =>
                  ball.ball_number
              )
              .sort(
                (a, b) =>
                  a - b
              )
              .join(
                ", #"
              )} ${
              unavailable.length === 1
                ? "is"
                : "are"
            } no longer available.`
        },
        409
      );
    }


    /* =========================
       CALCULATE TOTAL
    ========================= */

    const totalCents =
      baseballRows.reduce(
        (total, ball) =>
          total +
          Number(
            ball.amount_cents ||
            0
          ),
        0
      );


    if (
      totalCents < 100
    ) {
      return json(
        {
          success: false,
          error:
            "Invalid donation total."
        },
        400
      );
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
      await createStripeCheckoutSession({
        env,
        origin,
        playerKey:
          player.player_key,
        playerName:
          player.player_name,
        playerNumber:
          player.player_number,
        selectedBalls,
        totalCents,
        donorName,
        anonymous,
        team
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

      player:
        player.player_key,

      baseballs:
        selectedBalls,

      amountCents:
        totalCents,

      amount:
        totalCents / 100
    });

  } catch (error) {

    console.error(
      "Create checkout error:",
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

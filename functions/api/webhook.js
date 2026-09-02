function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function safeString(value) {
  return String(value ?? "").trim();
}

function parseBallNumbers(metadata = {}) {
  const raw =
    metadata.balls ||
    metadata.baseball_numbers ||
    "";

  return [
    ...new Set(
      safeString(raw)
        .split(",")
        .map(value => Number(value.trim()))
        .filter(
          number =>
            Number.isInteger(number) &&
            number >= 1 &&
            number <= 100
        )
    )
  ].sort((a, b) => a - b);
}

function getDonorName(session) {
  const metadata =
    session?.metadata || {};

  const anonymous =
    metadata.anonymous === "true" ||
    metadata.anonymous === true;

  if (anonymous) {
    return "Anonymous";
  }

  const metadataName =
    safeString(
      metadata.donor_name
    );

  if (metadataName) {
    return metadataName;
  }

  const customerName =
    safeString(
      session?.customer_details?.name
    );

  if (customerName) {
    return customerName;
  }

  return "Anonymous";
}

function getDonorEmail(session) {
  return (
    safeString(
      session?.customer_details?.email
    ) ||
    safeString(
      session?.customer_email
    ) ||
    null
  );
}

function hexToBytes(hex) {
  const bytes =
    new Uint8Array(
      hex.length / 2
    );

  for (
    let i = 0;
    i < bytes.length;
    i++
  ) {
    bytes[i] =
      parseInt(
        hex.substr(i * 2, 2),
        16
      );
  }

  return bytes;
}

function timingSafeEqual(a, b) {
  if (
    !(a instanceof Uint8Array) ||
    !(b instanceof Uint8Array) ||
    a.length !== b.length
  ) {
    return false;
  }

  let result = 0;

  for (
    let i = 0;
    i < a.length;
    i++
  ) {
    result |=
      a[i] ^ b[i];
  }

  return result === 0;
}

async function verifyStripeSignature(
  payload,
  signatureHeader,
  secret
) {
  if (
    !signatureHeader ||
    !secret
  ) {
    return false;
  }

  const parts =
    signatureHeader.split(",");

  const timestampPart =
    parts.find(
      part =>
        part.startsWith("t=")
    );

  const signatureParts =
    parts
      .filter(
        part =>
          part.startsWith("v1=")
      )
      .map(
        part =>
          part.slice(3)
      );

  if (
    !timestampPart ||
    signatureParts.length === 0
  ) {
    return false;
  }

  const timestamp =
    timestampPart.slice(2);

  const timestampNumber =
    Number(timestamp);

  if (
    !Number.isFinite(
      timestampNumber
    )
  ) {
    return false;
  }

  const nowSeconds =
    Math.floor(
      Date.now() / 1000
    );

  if (
    Math.abs(
      nowSeconds -
      timestampNumber
    ) > 300
  ) {
    return false;
  }

  const signedPayload =
    `${timestamp}.${payload}`;

  const encoder =
    new TextEncoder();

  const key =
    await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      {
        name: "HMAC",
        hash: "SHA-256"
      },
      false,
      ["sign"]
    );

  const signatureBuffer =
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(
        signedPayload
      )
    );

  const expectedSignature =
    new Uint8Array(
      signatureBuffer
    );

  for (
    const signature
    of signatureParts
  ) {
    try {
      const received =
        hexToBytes(signature);

      if (
        timingSafeEqual(
          expectedSignature,
          received
        )
      ) {
        return true;
      }
    } catch {
      // Ignore malformed signature.
    }
  }

  return false;
}

async function supabaseRequest(
  env,
  path,
  options = {}
) {
  const headers = {
    apikey:
      env.SUPABASE_SERVICE_ROLE_KEY,

    authorization:
      `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,

    accept:
      "application/json",

    ...(options.headers || {})
  };

  const response =
    await fetch(
      `${env.SUPABASE_URL}/rest/v1/${path}`,
      {
        ...options,
        headers
      }
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Supabase ${response.status}: ${text}`
    );
  }

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function supabaseGet(
  env,
  path
) {
  return supabaseRequest(
    env,
    path,
    {
      method: "GET"
    }
  );
}

async function supabasePatch(
  env,
  path,
  data
) {
  return supabaseRequest(
    env,
    path,
    {
      method: "PATCH",

      headers: {
        "content-type":
          "application/json",

        prefer:
          "return=representation"
      },

      body:
        JSON.stringify(data)
    }
  );
}

async function supabaseUpsert(
  env,
  path,
  data
) {
  return supabaseRequest(
    env,
    path,
    {
      method: "POST",

      headers: {
        "content-type":
          "application/json",

        prefer:
          "resolution=merge-duplicates,return=representation"
      },

      body:
        JSON.stringify(data)
    }
  );
}

async function getTeam(
  env,
  teamKey
) {
  const rows =
    await supabaseGet(
      env,
      `teams?team_key=eq.${encodeURIComponent(
        teamKey
      )}&select=id,team_key,team_name&limit=1`
    );

  return rows?.[0] || null;
}

async function getPlayer({
  env,
  teamId,
  playerId,
  playerKey
}) {
  if (playerId) {
    const rows =
      await supabaseGet(
        env,
        `players?id=eq.${encodeURIComponent(
          playerId
        )}&team_id=eq.${encodeURIComponent(
          teamId
        )}&select=id,player_key,player_name,player_number,team_id&limit=1`
      );

    if (rows?.length) {
      return rows[0];
    }
  }

  if (playerKey) {
    const rows =
      await supabaseGet(
        env,
        `players?team_id=eq.${encodeURIComponent(
          teamId
        )}&player_key=eq.${encodeURIComponent(
          playerKey
        )}&select=id,player_key,player_name,player_number,team_id&limit=1`
      );

    if (rows?.length) {
      return rows[0];
    }
  }

  return null;
}

async function recordDonation({
  env,
  session,
  team,
  player,
  donationType,
  donorName,
  donorEmail,
  ballNumbers
}) {
  const metadata =
    session.metadata || {};

  const amountCents =
    Number(
      session.amount_total ??
      metadata.amount_cents ??
      0
    );

  if (
    !Number.isFinite(
      amountCents
    ) ||
    amountCents < 0
  ) {
    throw new Error(
      "Invalid donation amount."
    );
  }

  const row = {
    team_key:
      team.team_key,

    team_id:
      team.id,

    player_id:
      player?.id || null,

    player_key:
      player?.player_key || null,

    donation_type:
      donationType,

    amount_cents:
      amountCents,

    donor_name:
      donorName,

    donor_email:
      donorEmail,

    stripe_session_id:
      session.id,

    stripe_payment_intent_id:
      safeString(
        session.payment_intent
      ) || null,

    balls:
      ballNumbers.length
        ? ballNumbers.join(",")
        : null
  };

  await supabaseUpsert(
    env,
    "donations?on_conflict=stripe_session_id",
    row
  );
}

async function fulfillBaseballs({
  env,
  session,
  team,
  player,
  donorName,
  donorEmail,
  ballNumbers
}) {
  if (
    !player ||
    ballNumbers.length === 0
  ) {
    throw new Error(
      "Missing baseball purchase information."
    );
  }

  let expectedTotalCents = 0;

  for (
    const ballNumber
    of ballNumbers
  ) {
    const rows =
      await supabaseGet(
        env,
        `baseballs?player_id=eq.${encodeURIComponent(
          player.id
        )}&ball_number=eq.${ballNumber}&select=id,ball_number,amount_cents,status,stripe_session_id,team_id&limit=1`
      );

    if (
      !rows ||
      rows.length === 0
    ) {
      console.error(
        `Baseball #${ballNumber} not found for player ${player.player_key}`
      );

      continue;
    }

    const ball =
      rows[0];

    expectedTotalCents +=
      Number(
        ball.amount_cents || 0
      );

    const status =
      safeString(
        ball.status
      ).toLowerCase();

    const existingSessionId =
      safeString(
        ball.stripe_session_id
      );

    /*
      Webhook retries are safe:
      if this same Stripe session already
      fulfilled the ball, do nothing.
    */
    if (
      status === "sold" &&
      existingSessionId ===
        session.id
    ) {
      continue;
    }

    /*
      Never overwrite a baseball that
      was already sold by another
      Checkout Session.
    */
    if (
      status === "sold" &&
      existingSessionId &&
      existingSessionId !==
        session.id
    ) {
      console.error(
        `Baseball conflict: player=${player.player_key}, ball=${ballNumber}, existing_session=${existingSessionId}, new_session=${session.id}`
      );

      continue;
    }

    /*
      If the database somehow contains
      a sold ball with no session ID,
      protect it rather than replacing
      the donor.
    */
    if (
      status === "sold" &&
      !existingSessionId
    ) {
      console.error(
        `Baseball #${ballNumber} is already sold but has no Stripe session ID. It was not overwritten.`
      );

      continue;
    }

    await supabasePatch(
      env,
      `baseballs?id=eq.${encodeURIComponent(
        ball.id
      )}`,
      {
        status:
          "sold",

        donor_name:
          donorName,

        donor_email:
          donorEmail,

        stripe_session_id:
          session.id,

        sold_at:
          new Date().toISOString(),

        reserved_until:
          null,

        reservation_id:
          null,

        team_id:
          team.team_key
      }
    );
  }

  const stripeTotalCents =
    Number(
      session.amount_total || 0
    );

  if (
    stripeTotalCents > 0 &&
    expectedTotalCents > 0 &&
    stripeTotalCents !==
      expectedTotalCents
  ) {
    console.error(
      "Baseball payment amount mismatch:",
      {
        sessionId:
          session.id,

        player:
          player.player_key,

        baseballs:
          ballNumbers,

        expectedTotalCents,

        stripeTotalCents
      }
    );
  }
}

async function processSession(
  env,
  session
) {
  if (!session?.id) {
    throw new Error(
      "Stripe session is missing."
    );
  }

  /*
    For completed Checkout events,
    only fulfill after Stripe reports
    the session as paid.
  */
  if (
    session.payment_status !==
    "paid"
  ) {
    console.log(
      `Ignoring unpaid Checkout Session ${session.id}`
    );

    return;
  }

  const metadata =
    session.metadata || {};

  const teamKey =
    safeString(
      metadata.team_key
    );

  if (!teamKey) {
    console.log(
      `Ignoring Checkout Session ${session.id}: no team_key metadata.`
    );

    return;
  }

  /*
    This webhook belongs to the
    SFI White Cloudflare project.
    Ignore Stripe sessions created
    for another team.
  */
  if (
    teamKey !==
    env.TEAM_KEY
  ) {
    console.log(
      `Ignoring Checkout Session ${session.id}: team ${teamKey} does not match ${env.TEAM_KEY}.`
    );

    return;
  }

  const team =
    await getTeam(
      env,
      teamKey
    );

  if (!team) {
    throw new Error(
      `Team not found: ${teamKey}`
    );
  }

  const donationType =
    safeString(
      metadata.donation_type
    ) ||
    (
      parseBallNumbers(
        metadata
      ).length
        ? "baseballs"
        : "team_general"
    );

  const donorName =
    getDonorName(
      session
    );

  const donorEmail =
    getDonorEmail(
      session
    );

  const playerId =
    safeString(
      metadata.player_id
    );

  const playerKey =
    safeString(
      metadata.player_key
    );

  let player = null;

  if (
    playerId ||
    playerKey
  ) {
    player =
      await getPlayer({
        env,
        teamId:
          team.id,
        playerId,
        playerKey
      });
  }

  if (
    donationType ===
    "baseballs"
  ) {
    if (!player) {
      throw new Error(
        `Player not found for baseball session ${session.id}`
      );
    }

    const ballNumbers =
      parseBallNumbers(
        metadata
      );

    if (
      ballNumbers.length === 0
    ) {
      throw new Error(
        `No baseball numbers found for session ${session.id}`
      );
    }

    await fulfillBaseballs({
      env,
      session,
      team,
      player,
      donorName,
      donorEmail,
      ballNumbers
    });

    /*
      Donation logging should not stop
      baseball fulfillment if something
      is wrong with the donations table.
    */
    try {
      await recordDonation({
        env,
        session,
        team,
        player,
        donationType:
          "baseballs",
        donorName,
        donorEmail,
        ballNumbers
      });
    } catch (error) {
      console.error(
        "Donation logging failed after baseball fulfillment:",
        error
      );
    }

    return;
  }

  if (
    donationType ===
    "player_general"
  ) {
    if (!player) {
      throw new Error(
        `Player not found for player donation session ${session.id}`
      );
    }

    await recordDonation({
      env,
      session,
      team,
      player,
      donationType:
        "player_general",
      donorName,
      donorEmail,
      ballNumbers: []
    });

    return;
  }

  if (
    donationType ===
    "team_general"
  ) {
    await recordDonation({
      env,
      session,
      team,
      player: null,
      donationType:
        "team_general",
      donorName,
      donorEmail,
      ballNumbers: []
    });

    return;
  }

  console.log(
    `Ignoring unsupported donation type "${donationType}" for session ${session.id}`
  );
}

export async function onRequestPost({
  request,
  env
}) {
  try {
    if (
      !env.STRIPE_WEBHOOK_SECRET ||
      !env.SUPABASE_URL ||
      !env.SUPABASE_SERVICE_ROLE_KEY ||
      !env.TEAM_KEY
    ) {
      return json(
        {
          success: false,
          error:
            "Missing webhook configuration."
        },
        500
      );
    }

    /*
      IMPORTANT:
      Stripe signature verification
      must use the untouched/raw body.
    */
    const payload =
      await request.text();

    const signature =
      request.headers.get(
        "stripe-signature"
      );

    const verified =
      await verifyStripeSignature(
        payload,
        signature,
        env.STRIPE_WEBHOOK_SECRET
      );

    if (!verified) {
      console.error(
        "Invalid Stripe webhook signature."
      );

      return json(
        {
          success: false,
          error:
            "Invalid webhook signature."
        },
        400
      );
    }

    let event;

    try {
      event =
        JSON.parse(payload);
    } catch {
      return json(
        {
          success: false,
          error:
            "Invalid Stripe event payload."
        },
        400
      );
    }

    const supportedEvents = [
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded"
    ];

    if (
      !supportedEvents.includes(
        event.type
      )
    ) {
      return json({
        success: true,
        received: true,
        ignored: true,
        eventType:
          event.type
      });
    }

    const session =
      event?.data?.object;

    await processSession(
      env,
      session
    );

    return json({
      success: true,
      received: true,
      eventType:
        event.type,
      sessionId:
        session?.id || null
    });

  } catch (error) {
    console.error(
      "Webhook processing error:",
      error
    );

    return json(
      {
        success: false,
        error:
          "Webhook processing failed.",
        details:
          error instanceof Error
            ? error.message
            : String(error)
      },
      500
    );
  }
}

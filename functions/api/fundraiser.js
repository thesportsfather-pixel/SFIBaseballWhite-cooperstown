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
        apikey:
          env.SUPABASE_SERVICE_ROLE_KEY,
        authorization:
          `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        accept:
          "application/json"
      }
    }
  );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Supabase ${response.status}: ${text}`
    );
  }

  return text
    ? JSON.parse(text)
    : [];
}

function safeNumber(value) {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}

function normalizeBaseball(row) {
  const ballNumber =
    Number(
      row.ball_number
    );

  const status =
    String(
      row.status ||
      "available"
    ).toLowerCase();

  const sold =
    status === "sold";

  const donorName =
    sold
      ? (
          String(
            row.donor_name ||
            ""
          ).trim() ||
          "Anonymous"
        )
      : "";

  return {
    id:
      row.id,

    number:
      ballNumber,

    ballNumber:
      ballNumber,

    ball_number:
      ballNumber,

    amountCents:
      safeNumber(
        row.amount_cents
      ),

    amount_cents:
      safeNumber(
        row.amount_cents
      ),

    amount:
      safeNumber(
        row.amount_cents
      ) / 100,

    status,

    sold,

    reserved:
      status === "reserved",

    donorName,

    donor_name:
      donorName,

    soldAt:
      row.sold_at || null,

    sold_at:
      row.sold_at || null
  };
}

export async function onRequestGet({
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
       PLAYER PARAM
    ========================= */

    const url =
      new URL(
        request.url
      );

    const playerKey =
      String(
        url.searchParams.get(
          "player"
        ) || ""
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
       TEAM
    ========================= */

    const teams =
      await supabaseGet(
        env,
        `teams?team_key=eq.${encodeURIComponent(
          env.TEAM_KEY
        )}&select=id,team_key,team_name,primary_color,secondary_color,logo_url&limit=1`
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
       PLAYER
    ========================= */

    const players =
      await supabaseGet(
        env,
        `players?team_id=eq.${encodeURIComponent(
          team.id
        )}&player_key=eq.${encodeURIComponent(
          playerKey
        )}&select=id,player_key,player_name,player_number,slug,name&limit=1`
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
       BASEBALLS
    ========================= */

    const baseballRows =
      await supabaseGet(
        env,
        `baseballs?player_id=eq.${encodeURIComponent(
          player.id
        )}&select=id,ball_number,amount_cents,status,reserved_until,reservation_id,sold_at,stripe_session_id,donor_name,donor_email&order=ball_number.asc`
      );

    const baseballs =
      baseballRows.map(
        normalizeBaseball
      );


    /* =========================
       SOLD BASEBALL TOTALS
    ========================= */

    const soldBaseballs =
      baseballs.filter(
        ball =>
          ball.sold
      );

    const baseballAmountCents =
      soldBaseballs.reduce(
        (total, ball) =>
          total +
          safeNumber(
            ball.amountCents
          ),
        0
      );

    const ballsSold =
      soldBaseballs.length;


    /* =========================
       CUSTOM PLAYER DONATIONS
    ========================= */

    let generalDonationRows = [];

    try {
      generalDonationRows =
        await supabaseGet(
          env,
          `donations?team_key=eq.${encodeURIComponent(
            env.TEAM_KEY
          )}&player_id=eq.${encodeURIComponent(
            player.id
          )}&donation_type=eq.player_general&select=id,amount_cents,donor_name,donor_email,stripe_session_id,created_at&order=created_at.desc`
        );
    } catch (error) {
      /*
        If the donations table is temporarily
        unavailable, the baseball board should
        still load normally.
      */
      console.error(
        "Unable to load player general donations:",
        error
      );

      generalDonationRows = [];
    }


    const generalDonationAmountCents =
      generalDonationRows.reduce(
        (total, donation) =>
          total +
          safeNumber(
            donation.amount_cents
          ),
        0
      );


    /* =========================
       TOTAL RAISED
    ========================= */

    /*
      Baseball donation rows are intentionally
      NOT included here.

      The sold baseball table already contains
      those amounts, so adding baseball donation
      records from the donations table would
      double-count the same payment.
    */

    const amountRaisedCents =
      baseballAmountCents +
      generalDonationAmountCents;

    const amountRaised =
      amountRaisedCents / 100;


    /* =========================
       GOAL / PROGRESS
    ========================= */

    const goalCents =
      505000;

    const goal =
      goalCents / 100;

    const progressPercentage =
      Math.min(
        100,
        Math.max(
          0,
          (
            amountRaisedCents /
            goalCents
          ) * 100
        )
      );


    /* =========================
       NORMALIZE GENERAL DONATIONS
    ========================= */

    const generalDonations =
      generalDonationRows.map(
        donation => ({
          id:
            donation.id,

          amountCents:
            safeNumber(
              donation.amount_cents
            ),

          amount_cents:
            safeNumber(
              donation.amount_cents
            ),

          amount:
            safeNumber(
              donation.amount_cents
            ) / 100,

          donorName:
            String(
              donation.donor_name ||
              ""
            ).trim() ||
            "Anonymous",

          donor_name:
            String(
              donation.donor_name ||
              ""
            ).trim() ||
            "Anonymous",

          createdAt:
            donation.created_at,

          created_at:
            donation.created_at
        })
      );


    /* =========================
       RESPONSE
    ========================= */

    return json({
      success: true,

      team: {
        id:
          team.id,

        teamKey:
          team.team_key,

        team_key:
          team.team_key,

        teamName:
          team.team_name,

        team_name:
          team.team_name,

        primaryColor:
          team.primary_color,

        secondaryColor:
          team.secondary_color,

        logoUrl:
          team.logo_url
      },

      player: {
        id:
          player.id,

        playerKey:
          player.player_key,

        player_key:
          player.player_key,

        slug:
          player.slug ||
          player.player_key,

        name:
          player.player_name ||
          player.name,

        playerName:
          player.player_name ||
          player.name,

        player_name:
          player.player_name ||
          player.name,

        number:
          player.player_number,

        playerNumber:
          player.player_number,

        player_number:
          player.player_number
      },

      baseballs,

      ballsSold,

      baseballsSold:
        ballsSold,

      amountRaised,

      amount_raised:
        amountRaised,

      amountRaisedCents,

      amount_raised_cents:
        amountRaisedCents,

      goal,

      goalCents,

      progressPercentage,

      progress:
        progressPercentage,

      breakdown: {
        baseballs: {
          soldCount:
            ballsSold,

          amountCents:
            baseballAmountCents,

          amount:
            baseballAmountCents / 100
        },

        playerGeneralDonations: {
          count:
            generalDonationRows.length,

          amountCents:
            generalDonationAmountCents,

          amount:
            generalDonationAmountCents / 100
        },

        total: {
          amountCents:
            amountRaisedCents,

          amount:
            amountRaised
        }
      },

      totals: {
        soldCount:
          ballsSold,

        raisedCents:
          amountRaisedCents,

        raisedDollars:
          amountRaised,

        goalCents,

        goalDollars:
          goal,

        progressPercentage
      },

      generalDonations
    });

  } catch (error) {

    console.error(
      "Fundraiser API error:",
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

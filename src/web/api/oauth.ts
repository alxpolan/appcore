import { Router, Request, Response } from "express";
import { randomBytes, createHash } from "crypto";
import bcrypt from "bcryptjs";
import express from "express";
import rateLimit from "express-rate-limit";
import { prisma, logger } from "../../config";

export const oauthRouter = Router();

const oauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

oauthRouter.use("/register", oauthLimiter);
oauthRouter.use("/token", oauthLimiter);
oauthRouter.use("/authorize", oauthLimiter);

export async function isTokenClientAuthenticated(
  client: { clientSecret: string; tokenEndpointAuthMethod: string },
  providedSecret: string | undefined,
): Promise<boolean> {
  if (client.tokenEndpointAuthMethod === "none") return true;

  if (!providedSecret) return false;

  if (client.clientSecret.startsWith("$2")) return bcrypt.compare(providedSecret, client.clientSecret);

  return client.clientSecret === providedSecret;
}

oauthRouter.post("/register", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");

  const { client_name, redirect_uris, grant_types, response_types, token_endpoint_auth_method } = req.body as {
    client_name?: string;
    redirect_uris?: string[];
    grant_types?: string[];
    response_types?: string[];
    token_endpoint_auth_method?: string;
  };

  if (!Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    res.status(400).json({
      error: "invalid_client_metadata",
      error_description: "redirect_uris is required",
    });
    return;
  }

  for (const uri of redirect_uris) {
    try {
      const u = new URL(uri);

      if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") {
        res.status(400).json({
          error: "invalid_redirect_uri",
          error_description: `Redirect URI must use https or localhost: ${uri}`,
        });
        return;
      }
    } catch {
      res.status(400).json({
        error: "invalid_redirect_uri",
        error_description: `Invalid URI: ${uri}`,
      });
      return;
    }
  }

  const supportedAuthMethods = ["client_secret_post", "client_secret_basic", "none"];
  const authMethod =
    typeof token_endpoint_auth_method === "string" && supportedAuthMethods.includes(token_endpoint_auth_method)
      ? token_endpoint_auth_method
      : "client_secret_post";

  try {
    const { randomBytes } = await import("crypto");
    const clientId = `appcore_${randomBytes(12).toString("hex")}`;
    const clientSecret = randomBytes(24).toString("hex");
    const clientSecretHash = await bcrypt.hash(clientSecret, 10);

    await prisma.oAuthClient.create({
      data: {
        clientId,
        clientSecret: clientSecretHash,
        name: client_name?.trim() || "Unnamed client",
        userId: null,
        redirectUris: redirect_uris,
        tokenEndpointAuthMethod: authMethod,
      },
    });

    res.status(201).json({
      client_id: clientId,
      client_secret: clientSecret,
      client_name: client_name || "Unnamed client",
      redirect_uris,
      grant_types: grant_types ?? ["authorization_code"],
      response_types: response_types ?? ["code"],
      token_endpoint_auth_method: authMethod,
    });
  } catch (err) {
    logger.error("DCR error", err);
    res.status(500).json({ error: "server_error" });
  }
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

oauthRouter.get("/authorize", async (req: Request, res: Response) => {
  const {
    client_id,
    redirect_uri,
    response_type,
    state,
    code_challenge,
    code_challenge_method,
    error: qError,
  } = req.query as Record<string, string>;

  if (response_type !== "code") {
    res.status(400).send("Unsupported response_type");
    return;
  }

  if (!client_id) {
    res.status(400).send("Missing client_id");
    return;
  }

  let client: Awaited<ReturnType<typeof prisma.oAuthClient.findUnique>>;
  try {
    client = await prisma.oAuthClient.findUnique({ where: { clientId: client_id } });
  } catch (err) {
    logger.error("OAuth authorize DB error", err);
    res.status(500).send("Internal server error");
    return;
  }

  if (!client) {
    res.status(400).send("Unknown client_id");
    return;
  }

  if (!redirect_uri || !client.redirectUris.includes(redirect_uri)) {
    res.status(400).send("Invalid redirect_uri");
    return;
  }

  if (!code_challenge || code_challenge_method !== "S256") {
    res.status(400).send("PKCE with S256 is required");
    return;
  }

  const hiddenFields = [
    ["client_id", client_id],
    ["redirect_uri", redirect_uri || ""],
    ["state", state || ""],
    ["code_challenge", code_challenge || ""],
    ["code_challenge_method", code_challenge_method || ""],
  ]
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join("\n      ");

  const errorHtml = qError ? `<p class="error">${escapeHtml(qError)}</p>` : "";

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorize – Marteso</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0a0a0a;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #111111;
      border: 1px solid #222222;
      border-radius: 16px;
      padding: 40px 36px;
      width: 100%;
      max-width: 400px;
      box-shadow: 0 8px 40px rgba(0,0,0,.6);
    }
    .logo-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      margin-bottom: 28px;
    }
    .logo-svg {
      width: 52px;
      height: 39px;
    }
    .brand {
      font-size: 20px;
      font-weight: 700;
      background: linear-gradient(135deg, #FF6B00, #CC0022);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      letter-spacing: -0.3px;
    }
    h1 {
      font-size: 16px;
      font-weight: 600;
      color: #f5f5f5;
      text-align: center;
      margin-bottom: 4px;
    }
    .sub {
      font-size: 13px;
      color: #888;
      text-align: center;
      margin-bottom: 28px;
    }
    .client-name {
      background: linear-gradient(135deg, #FF6B00, #CC0022);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      font-weight: 600;
    }
    label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: #aaa;
      margin-bottom: 5px;
      letter-spacing: 0.02em;
    }
    input[type=email], input[type=password] {
      width: 100%;
      padding: 11px 14px;
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 10px;
      font-size: 14px;
      color: #f5f5f5;
      margin-bottom: 16px;
      outline: none;
      transition: border-color .15s, box-shadow .15s;
    }
    input[type=email]:focus, input[type=password]:focus {
      border-color: #FF6B00;
      box-shadow: 0 0 0 3px rgba(255,107,0,.15);
    }
    input::placeholder { color: #555; }
    button {
      width: 100%;
      padding: 12px;
      background: linear-gradient(135deg, #FF6B00, #CC0022);
      color: #fff;
      border: none;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity .15s;
      letter-spacing: 0.01em;
    }
    button:hover { opacity: 0.9; }
    .error {
      color: #f87171;
      font-size: 13px;
      margin-bottom: 16px;
      padding: 10px 14px;
      background: rgba(220,38,38,.1);
      border-radius: 8px;
      border: 1px solid rgba(220,38,38,.25);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo-wrap">
      <svg class="logo-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 210">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#FF6B00"/>
            <stop offset="100%" stop-color="#CC0022"/>
          </linearGradient>
        </defs>
        <path d="M 36 165 L 36 78 A 46 46 0 0 1 128 78 L 128 145"
          fill="none" stroke="url(#grad)" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M 128 145 L 128 78 A 46 46 0 0 1 220 78 L 220 165"
          fill="none" stroke="url(#grad)" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span class="brand">Marteso</span>
    </div>
    <h1>Authorize <span class="client-name">${escapeHtml(client.name)}</span></h1>
    <p class="sub">Sign in to grant access to your ASO data.</p>
    ${errorHtml}
    <form method="POST" action="/oauth/authorize">
      ${hiddenFields}
      <label for="email">Email</label>
      <input type="email" id="email" name="email" required autofocus autocomplete="email" placeholder="you@example.com">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" required autocomplete="current-password" placeholder="••••••••">
      <button type="submit">Authorize access</button>
    </form>
  </div>
</body>
</html>`);
});

oauthRouter.post("/authorize", express.urlencoded({ extended: false }), async (req: Request, res: Response) => {
  const { client_id, redirect_uri, state, code_challenge, code_challenge_method, email, password } = req.body as Record<
    string,
    string
  >;

  const formParams = new URLSearchParams({
    client_id: client_id || "",
    redirect_uri: redirect_uri || "",
    state: state || "",
    code_challenge: code_challenge || "",
    code_challenge_method: code_challenge_method || "",
    response_type: "code",
  });

  const redirectToForm = (error: string) => {
    formParams.set("error", error);
    res.redirect(`/oauth/authorize?${formParams}`);
  };

  try {
    const client = await prisma.oAuthClient.findUnique({
      where: { clientId: client_id },
    });

    if (!client) {
      redirectToForm("Invalid client");
      return;
    }

    if (!redirect_uri || !client.redirectUris.includes(redirect_uri)) {
      redirectToForm("Invalid redirect_uri");
      return;
    }

    if (!code_challenge || code_challenge_method !== "S256") {
      redirectToForm("PKCE with S256 is required");
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        teamMembers: {
          include: { team: { include: { settings: true } } },
        },
      },
    });

    if (!user || !user.passwordHash || !password) {
      redirectToForm("Invalid email or password");
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);

    if (!valid) {
      redirectToForm("Invalid email or password");
      return;
    }

    const mcpEnabled = user.teamMembers.some((m) => m.team.settings?.mcpEnabled);

    if (!mcpEnabled) {
      redirectToForm("MCP access is not enabled. Enable it in AppCore settings first.");
      return;
    }

    const code = randomBytes(32).toString("hex");

    await prisma.oAuthCode.create({
      data: {
        code,
        clientId: client_id,
        userId: user.id,
        redirectUri: redirect_uri || "",
        codeChallenge: code_challenge || null,
        codeChallengeMethod: code_challenge_method || null,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    const target = redirect_uri || client.redirectUris[0];
    const params = new URLSearchParams({ code });
    if (state) params.set("state", state);
    res.redirect(`${target}?${params}`);
  } catch (err) {
    logger.error("OAuth authorize error", err);
    redirectToForm("Internal error, please try again");
  }
});

oauthRouter.post(
  "/token",
  (req, res, next) => {
    const ct = req.headers["content-type"] ?? "";

    if (ct.includes("application/json")) {
      express.json()(req, res, next);
    } else {
      express.urlencoded({ extended: false })(req, res, next);
    }
  },
  async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");

    const { grant_type, code, redirect_uri, code_verifier } = req.body as Record<string, string>;

    let client_id: string | undefined = (req.body as Record<string, string>).client_id;
    let client_secret: string | undefined = (req.body as Record<string, string>).client_secret;
    const authHeader = req.headers.authorization;

    if (authHeader?.startsWith("Basic ")) {
      const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
      const colonIdx = decoded.indexOf(":");

      if (colonIdx !== -1) {
        client_id = decodeURIComponent(decoded.slice(0, colonIdx));
        client_secret = decodeURIComponent(decoded.slice(colonIdx + 1));
      }
    }

    if (grant_type !== "authorization_code") {
      res.status(400).json({ error: "unsupported_grant_type" });
      return;
    }

    if (!client_id) {
      res.status(401).json({ error: "invalid_client" });
      return;
    }

    let client: Awaited<ReturnType<typeof prisma.oAuthClient.findUnique>>;
    try {
      client = await prisma.oAuthClient.findUnique({
        where: { clientId: client_id },
      });
    } catch (err) {
      logger.error("OAuth token DB error", err);
      res.status(500).json({ error: "server_error" });
      return;
    }

    if (!client) {
      res.status(401).json({ error: "invalid_client" });
      return;
    }

    const authenticated = await isTokenClientAuthenticated(
      { clientSecret: client.clientSecret, tokenEndpointAuthMethod: client.tokenEndpointAuthMethod },
      client_secret,
    );

    if (!authenticated) {
      res.status(401).json({ error: "invalid_client" });
      return;
    }

    try {
      const accessToken = await prisma.$transaction(async (tx) => {
        const authCode = await tx.oAuthCode.findUnique({ where: { code } });

        if (!authCode || authCode.used || authCode.expiresAt < new Date() || authCode.clientId !== client_id) {
          throw new Error("invalid_grant");
        }

        if (!redirect_uri || authCode.redirectUri !== redirect_uri) {
          throw new Error("invalid_grant");
        }

        if (!authCode.codeChallenge) {
          throw new Error("invalid_grant");
        }

        if (!code_verifier) {
          throw new Error("code_verifier_required");
        }
        const expected = createHash("sha256").update(code_verifier).digest("base64url");

        if (expected !== authCode.codeChallenge) {
          throw new Error("pkce_failed");
        }

        await tx.oAuthCode.update({ where: { code }, data: { used: true } });

        const token = randomBytes(32).toString("hex");

        await tx.oAuthToken.create({
          data: {
            accessToken: token,
            clientId: client_id,
            userId: authCode.userId,
          },
        });

        return token;
      });

      res.json({ access_token: accessToken, token_type: "Bearer", expires_in: 30 * 24 * 60 * 60 });
    } catch (err: any) {
      if (err.message === "code_verifier_required") {
        res.status(400).json({
          error: "invalid_grant",
          error_description: "code_verifier required",
        });
      } else if (err.message === "pkce_failed") {
        res.status(400).json({
          error: "invalid_grant",
          error_description: "PKCE verification failed",
        });
      } else if (err.message === "invalid_grant") {
        res.status(400).json({ error: "invalid_grant" });
      } else {
        res.status(500).json({ error: "server_error" });
      }
    }
  },
);

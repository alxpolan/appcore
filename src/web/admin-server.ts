import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import http from "http";
import { env, logger, prisma } from "../config";
import { authRouter } from "./api/auth";
import { adminRouter } from "./api/admin";
import { oauthRouter } from "./api/oauth";
import { adminMcpAuth, createAdminMcpHandler } from "./mcp-admin";

const app = express();
const PORT = env.ADMIN_WEB_PORT ?? 3200;
const ADMIN_VITE_PORT = 5174;
const isProd = process.env.NODE_ENV === "production";

app.set("trust proxy", 1);
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false,
  }),
);

const allowedOrigins = [
  env.ADMIN_URL,
  "http://localhost:5174",
  "http://localhost:3200",
  "http://localhost:3201",
  ...(env.CORS_ORIGIN ? env.CORS_ORIGIN.split(",").map((o) => o.trim()) : []),
];

app.use((req, res, next) => {
  const p = req.path;

  if (
    p.startsWith("/oauth") ||
    p.startsWith("/mcp") ||
    p.startsWith("/mcp-admin") ||
    p.startsWith("/.well-known")
  ) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,MCP-Protocol-Version");

    if (req.method === "OPTIONS") {
      res.sendStatus(204);

      return;
    }

    return next();
  }

  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })(req, res, next);
});

app.use(express.json());
app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/oauth", oauthRouter);

app.get("/.well-known/oauth-protected-resource", (req, res) => {
  const base = `${req.protocol}://${req.get("host")}`;

  res.json({ resource: `${base}/mcp`, authorization_servers: [base] });
});

app.get("/.well-known/oauth-protected-resource-admin", (req, res) => {
  const base = `${req.protocol}://${req.get("host")}`;

  res.json({ resource: `${base}/mcp-admin`, authorization_servers: [base] });
});

app.get("/.well-known/oauth-authorization-server", (req, res) => {
  const base = `${req.protocol}://${req.get("host")}`;

  res.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
  });
});

app.post("/mcp", adminMcpAuth, createAdminMcpHandler());
app.post("/mcp-admin", adminMcpAuth, createAdminMcpHandler());

const adminDist = path.join(__dirname, "../../admin/dist");

if (isProd) {
  app.use(express.static(adminDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(adminDist, "index.html"));
  });
} else {
  app.use((req, res) => {
    const proxyReq = http.request(
      {
        hostname: "localhost",
        port: ADMIN_VITE_PORT,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `localhost:${ADMIN_VITE_PORT}` },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );

    req.pipe(proxyReq);
    proxyReq.on("error", () => {
      res.status(502).send("Admin dev server not running — cd admin && npm run dev");
    });
  });
}

app.listen(PORT, () => {
  logger.info(`Marteso Admin server running at http://localhost:${PORT}`);
});

function shutdown() {
  logger.info("Admin server shutting down...");
  prisma.$disconnect().then(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

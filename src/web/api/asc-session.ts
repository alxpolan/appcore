import { ascRouter } from "./asc-versions";
import { handle } from "./asc-shared";
import { checkAppleSession } from "../../services/apple-web-session";
import {
  cancelAppleLogin,
  getAppleLogin,
  startAppleLogin,
  submitAppleLoginCode,
} from "../../services/apple-web-login";

ascRouter.get(
  "/privacy/session",
  handle("getAppleSessionStatus", async (_req, res) => {
    res.json(await checkAppleSession());
  }),
);

ascRouter.post(
  "/privacy/session/login",
  handle("startAppleSessionLogin", async (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };

    try {
      const state = await startAppleLogin(email ?? "", password ?? "");

      res.status(202).json(state);
    } catch (err: any) {
      res.status(400).json({ error: err.message ?? "Could not start Apple login" });

      return;
    }
  }),
);

function loginIdFromParams(req: any): string | null {
  const id = req.params?.id;

  return typeof id === "string" && id ? id : null;
}

ascRouter.get(
  "/privacy/session/login/:id",
  handle("getAppleSessionLogin", async (req, res) => {
    const id = loginIdFromParams(req);

    if (!id) {
      res.status(400).json({ error: "login id is required" });
      return;
    }

    const state = getAppleLogin(id);

    if (!state) {
      res.status(404).json({ error: "Login not found" });
      return;
    }

    res.json(state);
  }),
);

ascRouter.post(
  "/privacy/session/login/:id/code",
  handle("submitAppleSessionLoginCode", async (req, res) => {
    const id = loginIdFromParams(req);
    const { code } = req.body as { code?: string };

    if (!id) {
      res.status(400).json({ error: "login id is required" });
      return;
    }

    if (!code?.trim()) {
      res.status(400).json({ error: "code is required" });
      return;
    }

    if (!submitAppleLoginCode(id, code.trim())) {
      res.status(409).json({ error: "Login is not waiting for a code" });
      return;
    }

    res.json({ ok: true });
  }),
);

ascRouter.post(
  "/privacy/session/login/:id/cancel",
  handle("cancelAppleSessionLogin", async (req, res) => {
    const id = loginIdFromParams(req);

    if (!id) {
      res.status(400).json({ error: "login id is required" });
      return;
    }

    await cancelAppleLogin(id);

    res.json({ ok: true });
  }),
);

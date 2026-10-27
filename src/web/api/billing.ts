import { Router } from "express";
import crypto from "crypto";
import { env, logger, prisma } from "../../config";
import { requireAuth, requireTeamAdmin } from "../auth";
import { isAdminGrant, PRO_STATUSES } from "../../services/pro-grants";

export const billingRouter = Router();

const LS_API = "https://api.lemonsqueezy.com/v1";

function lsHeaders(): Record<string, string> {
  return {
    Accept: "application/vnd.api+json",
    "Content-Type": "application/vnd.api+json",
    Authorization: `Bearer ${env.LEMONSQUEEZY_API_KEY ?? ""}`,
  };
}

function isConfigured(): boolean {
  return !!(
    env.LEMONSQUEEZY_API_KEY &&
    env.LEMONSQUEEZY_STORE_ID &&
    env.LEMONSQUEEZY_VARIANT_MONTHLY &&
    env.LEMONSQUEEZY_VARIANT_YEARLY
  );
}

function intervalFromVariantId(variantId: string | null | undefined): "monthly" | "yearly" | null {
  if (!variantId) return null;
  if (variantId === env.LEMONSQUEEZY_VARIANT_MONTHLY) return "monthly";
  if (variantId === env.LEMONSQUEEZY_VARIANT_YEARLY) return "yearly";
  return null;
}

function serializeSubscription(sub: Awaited<ReturnType<typeof prisma.subscription.findUnique>>) {
  if (!sub) return null;

  return {
    status: sub.status,
    interval: sub.interval ?? intervalFromVariantId(sub.lemonVariantId),
    cardBrand: sub.cardBrand,
    cardLastFour: sub.cardLastFour,
    renewsAt: sub.renewsAt?.toISOString() ?? null,
    endsAt: sub.endsAt?.toISOString() ?? null,
    trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
    customerPortalUrl: sub.customerPortalUrl,
    updatePaymentMethodUrl: sub.updatePaymentMethodUrl,
  };
}

billingRouter.get("/", requireAuth, async (req, res) => {
  try {
    const teamId = req.user!.teamId;
    let sub = await prisma.subscription.findUnique({ where: { teamId } });

    if (
      isAdminGrant(sub) &&
      sub?.endsAt &&
      sub.endsAt <= new Date() &&
      (PRO_STATUSES as readonly string[]).includes(sub.status)
    ) {
      sub = await prisma.subscription.update({
        where: { teamId },
        data: { status: "expired" },
      });
    }

    res.json({
      configured: isConfigured(),
      plans: {
        monthly: { price: 19, currency: "EUR", interval: "monthly" },
        yearly: { price: 190, currency: "EUR", interval: "yearly" },
      },
      subscription: serializeSubscription(sub),
    });
  } catch (err) {
    logger.error("billing status failed", { err });
    res.status(500).json({ error: String(err) });
  }
});

billingRouter.post("/checkout", requireAuth, async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;

    if (!isConfigured()) {
      res.status(500).json({ error: "Billing is not configured" });
      return;
    }

    const teamId = req.user!.teamId;
    const interval = req.body?.interval as "monthly" | "yearly" | undefined;
    const variantId = interval === "yearly" ? env.LEMONSQUEEZY_VARIANT_YEARLY : env.LEMONSQUEEZY_VARIANT_MONTHLY;

    if (!variantId) {
      res.status(400).json({ error: "Unknown interval" });
      return;
    }

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: { members: { where: { role: "OWNER" }, include: { user: true }, take: 1 } },
    });

    const owner = team?.members[0]?.user;

    const payload = {
      data: {
        type: "checkouts",
        attributes: {
          checkout_data: {
            email: owner?.email ?? undefined,
            name: owner?.name ?? team?.name ?? undefined,
            custom: { team_id: teamId },
          },
          product_options: {
            redirect_url: `${env.APP_URL}/settings?billing=success`,
          },
        },
        relationships: {
          store: { data: { type: "stores", id: String(env.LEMONSQUEEZY_STORE_ID) } },
          variant: { data: { type: "variants", id: String(variantId) } },
        },
      },
    };

    const r = await fetch(`${LS_API}/checkouts`, {
      method: "POST",
      headers: lsHeaders(),
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      logger.error("lemon squeezy checkout creation failed");
      res.status(502).json({ error: "Failed to create checkout" });
      return;
    }

    const body = (await r.json()) as { data?: { attributes?: { url?: string } } };
    const url = body.data?.attributes?.url;

    if (!url) {
      res.status(502).json({ error: "Checkout url missing" });
      return;
    }

    res.json({ url });
  } catch (err) {
    logger.error("checkout failed", { err });
    res.status(500).json({ error: String(err) });
  }
});

billingRouter.post("/portal", requireAuth, async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const teamId = req.user!.teamId;
    const sub = await prisma.subscription.findUnique({ where: { teamId } });

    if (!sub?.customerPortalUrl) {
      res.status(404).json({ error: "No active subscription" });
      return;
    }

    res.json({ url: sub.customerPortalUrl });
  } catch (err) {
    logger.error("portal failed", { err });
    res.status(500).json({ error: String(err) });
  }
});

type LsSubscriptionAttributes = {
  store_id?: number;
  customer_id?: number;
  order_id?: number;
  product_id?: number;
  variant_id?: number;
  status?: string;
  card_brand?: string | null;
  card_last_four?: string | null;
  renews_at?: string | null;
  ends_at?: string | null;
  trial_ends_at?: string | null;
  urls?: { update_payment_method?: string; customer_portal?: string };
};

type LsWebhookBody = {
  meta?: { event_name?: string; custom_data?: { team_id?: string } };
  data?: { id?: string; attributes?: LsSubscriptionAttributes };
};

export async function handleLemonSqueezyWebhook(rawBody: Buffer, signature: string | undefined) {
  const secret = env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) throw new Error("Webhook secret not configured");
  if (!signature) throw new Error("Missing signature");
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const sigBuf = Buffer.from(signature, "utf8");
  const expBuf = Buffer.from(expected, "utf8");

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error("Invalid signature");
  }

  const body = JSON.parse(rawBody.toString("utf8")) as LsWebhookBody;
  const event = body.meta?.event_name ?? "";
  const teamId = body.meta?.custom_data?.team_id;
  const lemonSubscriptionId = body.data?.id;
  const attrs = body.data?.attributes;

  if (!event.startsWith("subscription_")) return { ignored: true, event };
  if (!lemonSubscriptionId || !attrs) throw new Error("Malformed webhook payload");

  const data = {
    lemonCustomerId: String(attrs.customer_id ?? ""),
    lemonOrderId: attrs.order_id ? String(attrs.order_id) : null,
    lemonProductId: attrs.product_id ? String(attrs.product_id) : null,
    lemonVariantId: attrs.variant_id ? String(attrs.variant_id) : null,
    status: attrs.status ?? "unknown",
    interval: intervalFromVariantId(attrs.variant_id ? String(attrs.variant_id) : null),
    cardBrand: attrs.card_brand ?? null,
    cardLastFour: attrs.card_last_four ?? null,
    renewsAt: attrs.renews_at ? new Date(attrs.renews_at) : null,
    endsAt: attrs.ends_at ? new Date(attrs.ends_at) : null,
    trialEndsAt: attrs.trial_ends_at ? new Date(attrs.trial_ends_at) : null,
    updatePaymentMethodUrl: attrs.urls?.update_payment_method ?? null,
    customerPortalUrl: attrs.urls?.customer_portal ?? null,
  };

  const existing = await prisma.subscription.findUnique({ where: { lemonSubscriptionId } });

  if (existing) {
    await prisma.subscription.update({ where: { lemonSubscriptionId }, data });
  } else {
    if (!teamId) throw new Error("team_id missing in custom_data for new subscription");
    await prisma.subscription.upsert({
      where: { teamId },
      create: { teamId, lemonSubscriptionId, ...data },
      update: { lemonSubscriptionId, ...data },
    });
  }

  return { ok: true, event };
}

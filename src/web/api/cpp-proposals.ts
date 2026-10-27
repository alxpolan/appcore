import { Router, Request, Response } from "express";
import { prisma, logger } from "../../config";
import { requireAuth, loadTeamRole, requireWriteRole, loadTeamSettings } from "../auth";
import { ascClientForUser } from "../../services/asc-client";
import { appleAdsKeyMissing, appleAdsKeyCreds, orgCredsForCampaign } from "./apple-ads-helpers";
import { AppleAdsCampaignNotFoundError } from "../../services/apple-ads-types";
import {
  applyCppProposal,
  attachScreenshotJobs,
  deleteCppProposal,
  generateCppProposals,
  getCppProposal,
  listCppProposals,
  renderCppProposal,
  updateCppProposalCaptions,
} from "../../services/cpp-proposals";

const writeAuth = [requireAuth, loadTeamRole, requireWriteRole];

export const cppProposalsRouter = Router();

async function appForCampaign(teamId: string, campaignId: string) {
  const member = await prisma.appleAdsCampaignGroupMember.findFirst({
    where: { externalCampaignId: campaignId },
    select: { appId: true },
  });

  if (!member) return null;

  return prisma.app.findFirst({ where: { id: member.appId, teamId } });
}

async function proposalForTeam(teamId: string, id: string) {
  const proposal = await getCppProposal(id);
  const app = await prisma.app.findFirst({ where: { id: proposal.appId, teamId } });

  if (!app) throw new Error(`CPP proposal ${id} not found`);

  return { proposal, app };
}

cppProposalsRouter.get("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const campaignId = req.query.campaignId as string | undefined;

    if (!campaignId) {
      res.status(400).json({ error: "campaignId is required" });

      return;
    }

    const app = await appForCampaign(req.user!.teamId, campaignId);

    if (!app) {
      res.status(404).json({ error: "No app mapped for this campaign" });

      return;
    }

    res.json({ proposals: await attachScreenshotJobs(await listCppProposals(app.id, campaignId)) });
  } catch (err: any) {
    logger.error(`cpp proposals list error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

cppProposalsRouter.get("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const { proposal } = await proposalForTeam(req.user!.teamId, req.params.id as string);
    const [withJob] = await attachScreenshotJobs([proposal]);

    res.json({ proposal: withJob });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 500;

    logger.error(`cpp proposal get error: ${err.message}`);
    res.status(status).json({ error: err.message });
  }
});

cppProposalsRouter.post("/generate", ...writeAuth, loadTeamSettings, async (req: Request, res: Response) => {
  const s = req.teamSettings;

  if (appleAdsKeyMissing(s)) {
    res.status(400).json({ error: "Apple Search Ads is not connected" });

    return;
  }

  try {
    const { campaignId, days } = req.body as { campaignId?: string; days?: number };

    if (!campaignId || typeof campaignId !== "string") {
      res.status(400).json({ error: "campaignId is required" });

      return;
    }

    const app = await appForCampaign(req.user!.teamId, campaignId);

    if (!app) {
      res.status(404).json({ error: "No app mapped for this campaign — map one in Integrations" });

      return;
    }

    const proposals = await generateCppProposals({
      appId: app.id,
      campaignId,
      creds: await orgCredsForCampaign(req.user!.teamId, appleAdsKeyCreds(s), campaignId),
      days,
    });

    res.json({ proposals: await attachScreenshotJobs(proposals) });
  } catch (err: any) {
    if (err instanceof AppleAdsCampaignNotFoundError) {
      res.status(404).json({ error: err.message });

      return;
    }

    logger.error(`cpp proposals generate error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

cppProposalsRouter.post("/:id/render/stream", ...writeAuth, async (req: Request, res: Response) => {
  try {
    await proposalForTeam(req.user!.teamId, req.params.id as string);

    res.writeHead(200, {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    let closed = false;

    res.on("close", () => {
      closed = true;
    });

    const write = (obj: unknown) => {
      if (closed || res.writableEnded) return;

      try {
        res.write(`${JSON.stringify(obj)}\n`);
      } catch {
        closed = true;
      }
    };

    const heartbeat = setInterval(() => write({ heartbeat: true }), 15000);

    try {
      const proposal = await renderCppProposal(req.params.id as string, (event) => write(event));
      const [withJob] = await attachScreenshotJobs([proposal]);

      write({ result: { proposal: withJob } });
    } catch (err: any) {
      logger.error(`cpp proposal render error: ${err.message}`);
      write({ error: err.message });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  } catch (err: any) {
    if (!res.headersSent) {
      const status = err.message.includes("not found") ? 404 : 500;

      logger.error(`cpp proposal render error: ${err.message}`);
      res.status(status).json({ error: err.message });
    } else {
      res.end();
    }
  }
});

cppProposalsRouter.patch("/:id/captions", ...writeAuth, async (req: Request, res: Response) => {
  try {
    await proposalForTeam(req.user!.teamId, req.params.id as string);

    const { captions } = req.body as { captions?: unknown };

    res.json({ proposal: await updateCppProposalCaptions(req.params.id as string, captions) });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 500;

    logger.error(`cpp proposal captions error: ${err.message}`);
    res.status(status).json({ error: err.message });
  }
});

cppProposalsRouter.post("/:id/apply", ...writeAuth, async (req: Request, res: Response) => {
  try {
    const { app } = await proposalForTeam(req.user!.teamId, req.params.id as string);
    const asc = await ascClientForUser(req.user!.userId);

    if (!asc) {
      res.status(400).json({ error: "App Store Connect credentials missing." });

      return;
    }

    const proposal = await applyCppProposal({
      proposalId: req.params.id as string,
      asc,
      bundleId: app.bundleId,
    });

    const [withJob] = await attachScreenshotJobs([proposal]);

    res.json({ proposal: withJob });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 500;

    logger.error(`cpp proposal apply error: ${err.message}`);
    res.status(status).json({ error: err.message });
  }
});

cppProposalsRouter.delete("/:id", ...writeAuth, async (req: Request, res: Response) => {
  try {
    await proposalForTeam(req.user!.teamId, req.params.id as string);
    await deleteCppProposal(req.params.id as string);

    res.json({ ok: true });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : err.message.includes("stay") || err.message.includes("busy") ? 409 : 500;

    logger.error(`cpp proposal delete error: ${err.message}`);
    res.status(status).json({ error: err.message });
  }
});

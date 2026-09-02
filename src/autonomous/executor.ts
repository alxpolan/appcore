import { prisma, logger, getEffectiveSettings } from "../config";
import { AsoExperimentStatus, AsoExperimentType } from "@prisma/client";
import { ascClientFromSettings } from "../services/asc-client";

export class ASOExecutor {
  async deployExperiment(experimentId: string, userId: string) {
    const experiment = await prisma.asoExperiment.findUniqueOrThrow({
      where: { id: experimentId },
      include: { app: true },
    });

    if (experiment.status !== AsoExperimentStatus.PENDING && experiment.status !== AsoExperimentStatus.APPROVED) {
      throw new Error(
        `Experiment ${experimentId} has status "${experiment.status}" — ` +
          `only PENDING or APPROVED experiments can be deployed`,
      );
    }

    const app = experiment.app;
    logger.info(`[ASOExecutor] Deploying experiment ${experimentId} for app "${app.name}" (${app.bundleId})`);

    const settings = await getEffectiveSettings(userId);
    const asc = ascClientFromSettings(settings);
    if (!asc) {
      throw new Error(
        "App Store Connect credentials not configured. Set ascIssuerId / ascKeyId / ascPrivateKey in Settings.",
      );
    }

    const currentKeywords = app.currentKeywords ?? "";
    let newMetadata: Record<string, string> = {};

    switch (experiment.type) {
      case AsoExperimentType.KEYWORD_ADD: {
        const kws: string[] = currentKeywords
          .split(",")
          .map((k: string) => k.trim())
          .filter(Boolean);
        if (experiment.toValue) kws.push(experiment.toValue);
        newMetadata = { keywords: kws.join(",") };
        break;
      }
      case AsoExperimentType.KEYWORD_REMOVE: {
        const kws: string[] = currentKeywords
          .split(",")
          .map((k: string) => k.trim())
          .filter(Boolean)
          .filter((k: string) => k.toLowerCase() !== (experiment.fromValue ?? "").toLowerCase());
        newMetadata = { keywords: kws.join(",") };
        break;
      }
      case AsoExperimentType.KEYWORD_REPLACE: {
        const kws: string[] = currentKeywords
          .split(",")
          .map((k: string) => k.trim())
          .filter(Boolean)
          .map((k: string) =>
            k.toLowerCase() === (experiment.fromValue ?? "").toLowerCase() ? (experiment.toValue ?? k) : k,
          );
        newMetadata = { keywords: kws.join(",") };
        break;
      }
      case AsoExperimentType.TITLE_CHANGE: {
        newMetadata = { title: experiment.toValue ?? "" };
        break;
      }
      case AsoExperimentType.SUBTITLE_CHANGE: {
        newMetadata = { subtitle: experiment.toValue ?? "" };
        break;
      }
    }

    let rankBefore: number | null = null;
    const targetKeyword = experiment.toValue ?? experiment.fromValue;

    if (targetKeyword) {
      const keyword = await prisma.keyword.findFirst({
        where: { term: { equals: targetKeyword, mode: "insensitive" } },
      });

      if (keyword) {
        const latestRanking = await prisma.keywordRanking.findFirst({
          where: { keywordId: keyword.id, appId: app.id },
          orderBy: { trackedAt: "desc" },
        });
        rankBefore = latestRanking?.rank ?? null;
      }
    }

    await prisma.asoExperiment.update({
      where: { id: experimentId },
      data: {
        status: AsoExperimentStatus.DEPLOYED,
        deployedAt: new Date(),
        rankBefore,
      },
    });

    const locale = "en-US";
    const ascResult = await asc.applyASOChanges(
      {
        title: newMetadata.title,
        subtitle: newMetadata.subtitle,
        keywords: newMetadata.keywords,
      },
      locale,
      app.bundleId,
    );

    if (ascResult.errors.length > 0) {
      logger.error(
        `[ASOExecutor] ASC deployment errors for experiment ${experimentId}: ${ascResult.errors.join(", ")}`,
      );
      throw new Error(`App Store Connect update failed: ${ascResult.errors.join("; ")}`);
    }

    logger.info(
      `[ASOExecutor] Experiment ${experimentId} deployed to ASC v${ascResult.versionString}. ` +
        `Applied: ${ascResult.applied.join(", ")}`,
    );

    return {
      success: true,
      experimentId,
      deployed: newMetadata,
      rankBefore,
      ascVersionString: ascResult.versionString,
      ascApplied: ascResult.applied,
    };
  }
}

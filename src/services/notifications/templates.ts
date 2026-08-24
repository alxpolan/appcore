import { notificationService } from "./notification.js";
import { env } from "../../config/env.js";

export async function teamInvite({
  to,
  inviterName,
  teamName,
  role,
  token,
}: {
  to: string;
  inviterName: string;
  teamName: string;
  role: string;
  token: string;
}): Promise<void> {
  const inviteUrl = `${env.APP_URL}/invite/${token}`;
  const roleLabel: Record<string, string> = {
    OWNER: "Owner",
    ADMIN: "Admin",
    MEMBER: "Member",
    VIEWER: "Viewer",
  };

  await notificationService.sendEmail({
    to,
    subject: `Du wurdest zu ${teamName} auf marteso eingeladen`,
    title: "Du wurdest eingeladen",
    body: `<strong style="color:#1a1a2e;">${inviterName}</strong> hat dich eingeladen, dem Team <strong style="color:#1a1a2e;">${teamName}</strong> als <strong style="color:#D94412;">${roleLabel[role] ?? role}</strong> beizutreten.`,
    cta: { label: "Einladung annehmen", url: inviteUrl },
    footer:
      "Dieser Link läuft in 7 Tagen ab. Falls du diese Einladung nicht erwartet hast, kannst du diese E-Mail ignorieren.",
  });
}

export async function verifyEmail({ to, token }: { to: string; token: string }): Promise<void> {
  const verifyUrl = `${env.APP_URL}/verify-email?token=${token}`;

  await notificationService.sendEmail({
    to,
    subject: "Confirm your Marteso email",
    title: "Confirm your email",
    body: "Welcome to Marteso. Please confirm your email address to activate your account and start optimizing your app.",
    cta: { label: "Confirm email", url: verifyUrl },
    footer: "This link expires in 24 hours. If you did not create a Marteso account, you can safely ignore this email.",
  });
}

export function founderWelcome({ to, name }: { to: string; name: string }): void {
  setTimeout(
    () => {
      notificationService
        .sendPlainEmail({
          to,
          from: "Alex from marteso <alex@marteso.com>",
          replyTo: "alex@marteso.com",
          subject: "Welcome to marteso",
          text: `Hey ${(name ?? "").trim().split(/\s+/)[0] || "there"},

               Alex here - founder of marteso. Just wanted to reach out personally and say thanks for signing up. Really glad to have you on board.

               We're building marteso because ASO today is way too complicated - too many tools, too much guesswork, not enough clarity. My goal: within a few minutes you should see what's actually going on with your app and which levers will move the needle.

               One small ask: just reply to this email with the one thing that's bugging you most about your app right now, or where you'd want help. I read every reply myself and feed it straight into the roadmap.

               If anything's broken or unclear, hit me up directly - I'll help personally.

               Cheers,
               Alex
               Founder, marteso
          `,
        })
        .catch(() => {});
    },
    180_000 + Math.floor(Math.random() * 150_000),
  ).unref?.();
}

export async function premiumGranted({
  to,
  teamName,
  endsAt,
}: {
  to: string;
  teamName: string;
  endsAt: Date | null;
}): Promise<void> {
  const expiryText = endsAt
    ? `It will expire automatically on <strong style="color:#1a1a2e;">${endsAt.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })}</strong>. No action is needed from you.`
    : `It won't expire. Pro is yours permanently.`;

  await notificationService.sendEmail({
    to,
    from: "Alex from Marteso <alex@marteso.com>",
    replyTo: "alex@marteso.com",
    subject: "You've been granted Marteso Pro",
    title: "Pro unlocked",
    body: `Good news! Your team <strong style="color:#1a1a2e;">${teamName}</strong> has been automatically granted <strong style="color:#D94412;">Pro</strong> access. ${expiryText}`,
    cta: { label: "Open Marteso", url: env.APP_URL },
    footer: "Enjoy all Pro features. If you have any questions, just reply to this email.",
  });
}

export async function ascInviteAccepted({ subject, from }: { subject: string; from: string }): Promise<void> {
  await notificationService.sendPlainEmail({
    to: "alex@marteso.com",
    from: "Marteso <alex@marteso.com>",
    subject: `ASC invite auto-accepted — ${subject}`,
    text: `Auto-accepted an App Store Connect team invite from ${from}:

"${subject}"

Go generate the API key under asc@marteso.com's access to that team and enter it into the customer's Team Settings.`,
  });
}
ƒ
export async function ascInviteNeedsManualAccept({
  subject,
  from,
  inviteUrl,
}: {
  subject: string;
  from: string;
  inviteUrl: string;
}): Promise<void> {
  await notificationService.sendPlainEmail({
    to: "alex@marteso.com",
    from: "Marteso <alex@marteso.com>",
    subject: `ASC invite ready to accept — ${subject}`,
    text: `Found a new App Store Connect team invite from ${from}. Click to accept (you'll need to sign in as asc@marteso.com, incl. 2FA — Apple requires this fresh every time, it's not automatable):

${inviteUrl}

Then go generate the API key under that access and enter it into the customer's Team Settings.`,
  });
}

export async function ascInviteAcceptFailed({
  subject,
  from,
  reason,
  inviteUrl,
}: {
  subject: string;
  from: string;
  reason: string;
  inviteUrl: string | null;
}): Promise<void> {
  await notificationService.sendPlainEmail({
    to: "alex@marteso.com",
    from: "Marteso <alex@marteso.com>",
    subject: `ASC invite needs manual accept — ${subject}`,
    text: `Found what looks like an App Store Connect team invite from ${from}, but couldn't auto-accept it:

"${subject}"

Reason: ${reason}
${inviteUrl ? `Link: ${inviteUrl}` : "No invite link could be extracted from the email — accept it manually from the asc@marteso.com inbox."}`,
  });
}

export function keywordRankChange(
  keywordTerm: string,
  oldRank: number | null,
  newRank: number | null,
  country: string,
) {
  const rankText = newRank ? `now #${newRank}` : "no longer ranked";
  const changeText =
    oldRank && newRank ? (newRank < oldRank ? `↑ ${oldRank - newRank}` : `↓ ${newRank - oldRank}`) : "";

  return notificationService.broadcast({
    push: {
      title: "🔑 Keyword Rank Update",
      body: `"${keywordTerm}" (${country.toUpperCase()}): ${rankText} ${changeText}`.trim(),
      category: "KEYWORD_RANK_UPDATE",
      data: {
        keywordTerm,
        country,
        oldRank: String(oldRank ?? ""),
        newRank: String(newRank ?? ""),
      },
    },
  });
}

export function submissionUpdate(appName: string, versionString: string, status: string) {
  const emoji =
    status === "READY_FOR_DISTRIBUTION" ? "✅" : status === "IN_REVIEW" ? "👀" : status === "REJECTED" ? "❌" : "📦";

  return notificationService.broadcast({
    push: {
      title: `${emoji} App Store Update`,
      body: `${appName} v${versionString}: ${status.replace(/_/g, " ").toLowerCase()}`,
      category: "SUBMISSION_UPDATE",
      data: { appName, versionString, status },
    },
  });
}

export function jobComplete(jobType: string, status: string, itemsCount?: number) {
  const emoji = status === "COMPLETED" ? "✅" : "❌";
  const itemsText = itemsCount ? ` (${itemsCount} items)` : "";

  return notificationService.broadcast({
    push: {
      title: `${emoji} Job ${status.toLowerCase()}`,
      body: `${jobType.replace(/-/g, " ")}${itemsText}`,
      category: "JOB_COMPLETE",
      data: { jobType, status, itemsCount: String(itemsCount ?? 0) },
    },
  });
}

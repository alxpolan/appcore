import { useState, useEffect } from "react";
import { CreditCard, Check } from "lucide-react";
import { useApi, apiPost } from "../../hooks/useApi";
import { usePermissions } from "../../hooks/usePermissions";
import { usePostHog } from "@posthog/react";
import type { BillingStatus } from "../../types";
import {
  badge,
  borderDefault,
  btnPrimary,
  btnSecondary,
  cardCls,
  pageTitle,
  textMuted,
  textPrimary,
  textSecondary,
} from "../../styles";

interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString();
}

function statusLabel(s: string): string {
  return s.replace(/_/g, " ");
}

export default function Billing({ addToast }: Props) {
  const posthog = usePostHog();
  const { canManageTeam } = usePermissions();
  const { data, loading, refetch } = useApi<BillingStatus>("/billing", [], true);
  const [busy, setBusy] = useState<null | "monthly" | "yearly" | "portal">(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("billing") === "success") {
      posthog?.capture("checkout_completed");
      addToast("Subscription activated", "success");
      refetch();

      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const startCheckout = async (interval: "monthly" | "yearly") => {
    setBusy(interval);
    try {
      posthog?.capture("checkout_started", { interval });
      const { url } = await apiPost<{ url: string }>("/billing/checkout", { interval });
      window.location.href = url;
    } catch (err: any) {
      addToast(err.message ?? "Failed to start checkout", "error");
      setBusy(null);
    }
  };

  const openPortal = async () => {
    setBusy("portal");
    try {
      posthog?.capture("billing_portal_opened");
      const { url } = await apiPost<{ url: string }>("/billing/portal");
      window.location.href = url;
    } catch (err: any) {
      addToast(err.message ?? "Failed to open customer portal", "error");
      setBusy(null);
    }
  };

  if (loading)
    return (
      <div className="flex items-center justify-center py-20 gap-3 text-gray-400 dark:text-[#5c6478]">
        <div className="spinner" /> Loading billing…
      </div>
    );

  const sub = data?.subscription ?? null;
  const isActive = sub && ["active", "on_trial", "paused"].includes(sub.status);

  return (
    <div className="max-w-3xl">
      <h1 className={`${pageTitle} mb-1`}>Billing</h1>
      <p className="text-sm text-[#6b7280] dark:text-[#5c6478] mb-8">
        Manage your subscription, payment method, and invoices.
      </p>

      {!data?.configured && (
        <div className="mb-6 px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-900/40 text-[12px] text-amber-800 dark:text-amber-300">
          Billing is currently unavailable. Please try again later.
        </div>
      )}

      {isActive && sub ? (
        <div className={cardCls}>
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl border ${borderDefault} flex items-center justify-center shrink-0`}>
              <CreditCard className="w-6 h-6 text-[#595DD2]" />
            </div>
            <div className="min-w-0">
              <div className={`text-[15px] font-semibold ${textPrimary} flex items-center gap-2`}>
                {sub.interval === "yearly" ? "Yearly Plan — €190 / year" : "Monthly Plan — €19 / month"}
                <span className={badge(sub.status === "active" ? "active" : sub.status)}>
                  {statusLabel(sub.status)}
                </span>
              </div>
              <div className={`text-[12px] ${textMuted} mt-1`}>
                {sub.cardBrand && sub.cardLastFour && (
                  <span>
                    {sub.cardBrand} •••• {sub.cardLastFour}
                    {" · "}
                  </span>
                )}
                {sub.endsAt
                  ? `Ends ${formatDate(sub.endsAt)}`
                  : sub.renewsAt
                    ? `Renews ${formatDate(sub.renewsAt)}`
                    : null}
              </div>
            </div>
            <div className="ml-auto">
              <button
                className={btnSecondary}
                onClick={openPortal}
                disabled={busy !== null || !canManageTeam}
                title={!canManageTeam ? "Only team admins can manage billing" : undefined}
              >
                {busy === "portal" ? "Opening…" : "Manage Subscription"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <PlanCard
            title="Monthly"
            price="€19"
            cadence="/ month"
            features={["Cancel anytime", "All features included"]}
            ctaLabel={busy === "monthly" ? "Redirecting…" : "Subscribe"}
            onClick={() => startCheckout("monthly")}
            disabled={!data?.configured || busy !== null || !canManageTeam}
          />
          <PlanCard
            title="Yearly"
            price="€190"
            cadence="/ year"
            features={["2 months free", "All features included"]}
            ctaLabel={busy === "yearly" ? "Redirecting…" : "Subscribe"}
            onClick={() => startCheckout("yearly")}
            disabled={!data?.configured || busy !== null || !canManageTeam}
            highlight
          />
        </div>
      )}

      {!canManageTeam && <p className={`text-[11px] ${textMuted} mt-4`}>Only team admins can manage billing.</p>}
    </div>
  );
}

interface PlanCardProps {
  title: string;
  price: string;
  cadence: string;
  features: string[];
  ctaLabel: string;
  onClick: () => void;
  disabled: boolean;
  highlight?: boolean;
}

function PlanCard({ title, price, cadence, features, ctaLabel, onClick, disabled, highlight }: PlanCardProps) {
  return (
    <div
      className={`rounded-2xl border p-5 flex flex-col gap-3 ${
        highlight
          ? "border-[#595DD2]/30 bg-gradient-to-br from-[#595DD2]/[0.04] to-transparent"
          : `${borderDefault} bg-white dark:bg-[#1c2028]`
      }`}
    >
      <div className="flex items-center justify-between">
        <div className={`text-sm font-semibold ${textPrimary}`}>{title}</div>
        {highlight && (
          <span className="text-[10px] uppercase tracking-wider font-semibold text-[#595DD2]">Save 17%</span>
        )}
      </div>
      <div className="flex items-baseline gap-1">
        <span className={`text-3xl font-semibold ${textPrimary}`}>{price}</span>
        <span className={`text-[12px] ${textSecondary}`}>{cadence}</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {features.map((f) => (
          <li key={f} className={`text-[12px] ${textSecondary} flex items-center gap-2`}>
            <Check className="w-3.5 h-3.5 text-emerald-500" />
            {f}
          </li>
        ))}
      </ul>
      <button className={`${btnPrimary} justify-center mt-1`} onClick={onClick} disabled={disabled}>
        {ctaLabel}
      </button>
    </div>
  );
}

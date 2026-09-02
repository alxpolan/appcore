import { BarChart2 } from "lucide-react";
import { borderDefault, cardCls, pageTitle, textPrimary, textSecondary } from "../styles";

const INTEGRATIONS = [
  {
    key: "posthog",
    name: "PostHog",
    description:
      "Connect your PostHog project to see product analytics like funnels, retention and events next to your ASO data.",
    icon: BarChart2,
    iconBg: "bg-[#f9bd2b]",
    comingSoon: true,
  },
];

export default function Integrations() {
  return (
    <div>
      <h1 className={pageTitle}>Integrations</h1>
      <p className={`text-[13px] ${textSecondary} mt-1 mb-5 max-w-xl`}>
        Connect the tools you already use with Marteso.
      </p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {INTEGRATIONS.map((integration) => (
          <div key={integration.key} className={`${cardCls} flex flex-col`}>
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-10 h-10 rounded-xl ${integration.iconBg} flex items-center justify-center shrink-0`}>
                <integration.icon className="w-5 h-5 text-black/80" />
              </div>
              <div className={`text-[15px] font-semibold ${textPrimary}`}>{integration.name}</div>
            </div>
            <p className={`text-[13px] ${textSecondary} leading-relaxed flex-1`}>{integration.description}</p>
            <div className="mt-4">
              {integration.comingSoon && (
                <button
                  disabled
                  className={`inline-flex items-center gap-1.5 px-3 py-[7px] rounded-xl border ${borderDefault} text-[13px] font-medium ${textSecondary} cursor-not-allowed`}
                >
                  Coming soon
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

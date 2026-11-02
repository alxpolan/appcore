import { useCallback, useEffect, useState } from "react";
import { Check, Smartphone } from "lucide-react";
import { apiGet, apiPost } from "../../hooks/useApi";
import { btnSecSm, textMuted, textPrimary } from "../../styles";

interface ProductPage {
  id: string;
  name: string;
  state: string;
}

interface AdGroupAd {
  id: string;
  creativeId: string;
  creativeType: string;
  status: string;
  name: string;
}

interface AdGroupCppSettingsProps {
  campaignId: string;
  adGroupId: string;
  canWrite: boolean;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function AdGroupCppSettings({ campaignId, adGroupId, canWrite, addToast }: AdGroupCppSettingsProps) {
  const [pages, setPages] = useState<ProductPage[]>([]);
  const [currentAd, setCurrentAd] = useState<AdGroupAd | null>(null);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [pagesRes, adsRes] = await Promise.all([
        apiGet<{ productPages: ProductPage[] }>(`/apple-ads/campaigns/${campaignId}/product-pages`),
        apiGet<{ ads: AdGroupAd[] }>(`/apple-ads/campaigns/${campaignId}/adgroups/${adGroupId}/ads`),
      ]);

      setPages(pagesRes.productPages);
      setCurrentAd(adsRes.ads.find((ad) => ad.creativeType === "CUSTOM_PRODUCT_PAGE") ?? null);
    } catch (err: any) {
      addToast(`Failed to load Custom Product Pages: ${err.message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [campaignId, adGroupId, addToast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleConnect = async () => {
    const page = pages.find((p) => p.id === selected);

    if (!page) return;

    setConnecting(true);

    try {
      await apiPost(`/apple-ads/campaigns/${campaignId}/adgroups/${adGroupId}/cpp`, {
        productPageId: page.id,
        name: page.name,
        status: "ENABLED",
      });

      addToast(`Connected "${page.name}" to this ad group`, "success");
      await load();
    } catch (err: any) {
      addToast(`Connect failed: ${err.message}`, "error");
    } finally {
      setConnecting(false);
    }
  };

  if (loading) {
    return <div className={`text-[12px] ${textMuted}`}>Loading Custom Product Pages…</div>;
  }

  if (pages.length === 0) {
    return <div className={`text-[12px] ${textMuted}`}>No Custom Product Pages found for this app.</div>;
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${textPrimary}`}>
        <Smartphone className="w-3.5 h-3.5" /> Custom Product Page:
      </span>
      {currentAd && (
        <span className={`inline-flex items-center gap-1 text-[12px] ${textMuted}`}>
          <Check className="w-3.5 h-3.5 text-emerald-600" />
          {currentAd.name}
        </span>
      )}
      {canWrite && (
        <>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="text-[12px] rounded-lg border border-gray-300 dark:border-[#2a3040] bg-white dark:bg-[#1c2028] px-2 py-1"
          >
            <option value="">{currentAd ? "Switch to…" : "Select a page…"}</option>
            {pages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.name}
              </option>
            ))}
          </select>
          <button onClick={handleConnect} disabled={!selected || connecting} className={btnSecSm}>
            {connecting ? "Connecting…" : "Connect"}
          </button>
        </>
      )}
    </div>
  );
}

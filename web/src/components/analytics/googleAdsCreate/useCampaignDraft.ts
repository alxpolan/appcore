import { useMemo, useState } from "react";
import type { GoogleAdsBiddingStrategy } from "../GoogleAdsCampaignAdvancedFields";
import type { GoogleMatchType, GoogleNegativeDraft } from "../GoogleAdsNegativeKeywords";
import type {
  AdScheduleDraft,
  CallDraft,
  DeviceBidAdjustmentsDraft,
  SitelinkDraft,
  StructuredSnippetDraft,
} from "../GoogleAdsCampaignAdvancedFields";

export interface KeywordDraft {
  key: number;
  text: string;
  matchType: GoogleMatchType;
  bid: string;
}

export interface AdGroupDraft {
  key: number;
  name: string;
  defaultBid: string;
  keywords: KeywordDraft[];
  negatives: GoogleNegativeDraft[];
}

let nextKey = 1;

export const newKeyword = (): KeywordDraft => ({ key: nextKey++, text: "", matchType: "EXACT", bid: "" });

export const newAdGroup = (): AdGroupDraft => ({
  key: nextKey++,
  name: "",
  defaultBid: "",
  keywords: [newKeyword()],
  negatives: [],
});

export interface CampaignDraft {
  name: string;
  setName: (v: string) => void;
  dailyBudget: string;
  setDailyBudget: (v: string) => void;
  startDate: string;
  setStartDate: (v: string) => void;
  endDate: string;
  setEndDate: (v: string) => void;
  startPaused: boolean;
  setStartPaused: (v: boolean) => void;
  displayNetwork: boolean;
  setDisplayNetwork: (v: boolean) => void;
  searchPartners: boolean;
  setSearchPartners: (v: boolean) => void;
  presenceOnly: boolean;
  setPresenceOnly: (v: boolean) => void;
  campaignNegatives: GoogleNegativeDraft[];
  setCampaignNegatives: (v: GoogleNegativeDraft[]) => void;
  adGroups: AdGroupDraft[];
  setAdGroups: React.Dispatch<React.SetStateAction<AdGroupDraft[]>>;
  biddingStrategy: GoogleAdsBiddingStrategy;
  setBiddingStrategy: (v: GoogleAdsBiddingStrategy) => void;
  cpcBidCeiling: string;
  setCpcBidCeiling: (v: string) => void;
  targetCpa: string;
  setTargetCpa: (v: string) => void;
  targetRoas: string;
  setTargetRoas: (v: string) => void;
  deviceBidAdjustments: DeviceBidAdjustmentsDraft;
  setDeviceBidAdjustments: (v: DeviceBidAdjustmentsDraft) => void;
  adSchedule: AdScheduleDraft[];
  setAdSchedule: (v: AdScheduleDraft[]) => void;
  sitelinks: SitelinkDraft[];
  setSitelinks: (v: SitelinkDraft[]) => void;
  callouts: string[];
  setCallouts: (v: string[]) => void;
  structuredSnippets: StructuredSnippetDraft[];
  setStructuredSnippets: (v: StructuredSnippetDraft[]) => void;
  calls: CallDraft[];
  setCalls: (v: CallDraft[]) => void;
  manualBids: boolean;
  keywordCount: number;
  negativeCount: number;
  patchAdGroup: (key: number, patch: Partial<AdGroupDraft>) => void;
  patchKeyword: (gKey: number, kKey: number, patch: Partial<KeywordDraft>) => void;
  addAdGroup: () => void;
  removeAdGroup: (key: number) => void;
}

export function useCampaignDraft(): CampaignDraft {
  const [name, setName] = useState("");
  const [dailyBudget, setDailyBudget] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startPaused, setStartPaused] = useState(true);
  const [displayNetwork, setDisplayNetwork] = useState(false);
  const [searchPartners, setSearchPartners] = useState(true);
  const [presenceOnly, setPresenceOnly] = useState(true);
  const [campaignNegatives, setCampaignNegatives] = useState<GoogleNegativeDraft[]>([]);
  const [adGroups, setAdGroups] = useState<AdGroupDraft[]>([newAdGroup()]);

  const [biddingStrategy, setBiddingStrategy] = useState<GoogleAdsBiddingStrategy>("MANUAL_CPC");
  const [cpcBidCeiling, setCpcBidCeiling] = useState("");
  const [targetCpa, setTargetCpa] = useState("");
  const [targetRoas, setTargetRoas] = useState("");
  const [deviceBidAdjustments, setDeviceBidAdjustments] = useState<DeviceBidAdjustmentsDraft>({
    mobile: "",
    desktop: "",
    tablet: "",
  });
  const [adSchedule, setAdSchedule] = useState<AdScheduleDraft[]>([]);
  const [sitelinks, setSitelinks] = useState<SitelinkDraft[]>([]);
  const [callouts, setCallouts] = useState<string[]>([]);
  const [structuredSnippets, setStructuredSnippets] = useState<StructuredSnippetDraft[]>([]);
  const [calls, setCalls] = useState<CallDraft[]>([]);

  const manualBids = biddingStrategy === "MANUAL_CPC";

  const keywordCount = useMemo(() => adGroups.reduce((n, g) => n + g.keywords.length, 0), [adGroups]);
  const negativeCount = useMemo(
    () => campaignNegatives.length + adGroups.reduce((n, g) => n + g.negatives.length, 0),
    [campaignNegatives, adGroups],
  );

  const patchAdGroup = (key: number, patch: Partial<AdGroupDraft>) =>
    setAdGroups((gs) => gs.map((g) => (g.key === key ? { ...g, ...patch } : g)));

  const patchKeyword = (gKey: number, kKey: number, patch: Partial<KeywordDraft>) =>
    setAdGroups((gs) =>
      gs.map((g) =>
        g.key === gKey ? { ...g, keywords: g.keywords.map((k) => (k.key === kKey ? { ...k, ...patch } : k)) } : g,
      ),
    );

  const addAdGroup = () => setAdGroups((gs) => [...gs, newAdGroup()]);

  const removeAdGroup = (key: number) => setAdGroups((gs) => gs.filter((x) => x.key !== key));

  return {
    name,
    setName,
    dailyBudget,
    setDailyBudget,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    startPaused,
    setStartPaused,
    displayNetwork,
    setDisplayNetwork,
    searchPartners,
    setSearchPartners,
    presenceOnly,
    setPresenceOnly,
    campaignNegatives,
    setCampaignNegatives,
    adGroups,
    setAdGroups,
    biddingStrategy,
    setBiddingStrategy,
    cpcBidCeiling,
    setCpcBidCeiling,
    targetCpa,
    setTargetCpa,
    targetRoas,
    setTargetRoas,
    deviceBidAdjustments,
    setDeviceBidAdjustments,
    adSchedule,
    setAdSchedule,
    sitelinks,
    setSitelinks,
    callouts,
    setCallouts,
    structuredSnippets,
    setStructuredSnippets,
    calls,
    setCalls,
    manualBids,
    keywordCount,
    negativeCount,
    patchAdGroup,
    patchKeyword,
    addAdGroup,
    removeAdGroup,
  };
}

export interface CppKeywordStat {
  term: string;
  keyword: string | null;
  matchType: string | null;
  adGroupId: string;
  adGroupName: string | null;
  spend: number;
  taps: number;
  installs: number;
}

export interface CppKeywordGroup {
  key: string;
  label: string;
  spend: number;
  taps: number;
  installs: number;
  conversionRate: number | null;
  coverage: number;
  keywords: CppKeywordStat[];
}

export const CPP_MAX_GROUPS = 6;

const CPP_STOP_TOKENS = new Set(["app", "apps", "free", "gratis", "kostenlos", "premium"]);

export function tokenizeKeywordTerm(term: string): string[] {
  return term
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3 && !CPP_STOP_TOKENS.has(token));
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;

  return Math.round(value * 100) / 100;
}

function roundCount(value: number): number {
  if (!Number.isFinite(value)) return 0;

  return Math.max(0, Math.round(value));
}

function rankTokens(tokens: string[], spendByToken: Map<string, number>): string[] {
  return [...new Set(tokens)].sort((a, b) => {
    const spendDiff = (spendByToken.get(b) ?? 0) - (spendByToken.get(a) ?? 0);

    if (spendDiff !== 0) return spendDiff;
    if (b.length !== a.length) return b.length - a.length;

    return a.localeCompare(b);
  });
}

export function groupKeywordsByTheme(terms: CppKeywordStat[]): CppKeywordGroup[] {
  const funded = terms.filter((term) => Number.isFinite(term.spend) && term.spend > 0);

  if (funded.length === 0) return [];

  const totalSpend = funded.reduce((sum, term) => sum + term.spend, 0);
  const spendByToken = new Map<string, number>();

  for (const term of funded) {
    for (const token of new Set(tokenizeKeywordTerm(term.term))) {
      spendByToken.set(token, (spendByToken.get(token) ?? 0) + term.spend);
    }
  }

  const ranked = [...funded].sort((a, b) => b.spend - a.spend || a.term.localeCompare(b.term));
  const groups = new Map<string, CppKeywordStat[]>();

  for (const term of ranked) {
    const tokens = rankTokens(tokenizeKeywordTerm(term.term), spendByToken);
    const key = tokens[0] ?? term.term.toLowerCase().trim();

    if (!key) continue;

    const group = groups.get(key) ?? [];
    group.push(term);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([key, keywords]) => {
      const spend = roundMoney(keywords.reduce((sum, item) => sum + item.spend, 0));
      const taps = keywords.reduce((sum, item) => sum + roundCount(item.taps), 0);
      const installs = keywords.reduce((sum, item) => sum + roundCount(item.installs), 0);

      return {
        key,
        label: key.charAt(0).toUpperCase() + key.slice(1),
        spend,
        taps,
        installs,
        conversionRate: taps > 0 ? installs / taps : null,
        coverage: totalSpend > 0 ? spend / totalSpend : 0,
        keywords: [...keywords].sort((a, b) => b.spend - a.spend || a.term.localeCompare(b.term)),
      };
    })
    .sort((a, b) => b.spend - a.spend || a.key.localeCompare(b.key))
    .slice(0, CPP_MAX_GROUPS);
}

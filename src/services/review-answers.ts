export interface ReviewAnswerField {
  key: string;
  number: number;
  label: string;
  placeholder: string;
}

export const REVIEW_ANSWER_FIELDS: ReviewAnswerField[] = [
  {
    key: "siriShortcuts",
    number: 0,
    label: "Does the app include any Siri Shortcuts functionality?",
    placeholder: "No, it doesn't",
  },
  {
    key: "screenRecording",
    number: 1,
    label: "Screen recording",
    placeholder: "(Attached)",
  },
  {
    key: "devicesTested",
    number: 2,
    label: "Devices tested",
    placeholder: "iPhone 14 Pro, iOS 26.6.1",
  },
  {
    key: "purposeAudience",
    number: 3,
    label: "Purpose & audience",
    placeholder: "What the app does and who it is for",
  },
  {
    key: "setup",
    number: 4,
    label: "Setup",
    placeholder: "How to reach the core functionality",
  },
  {
    key: "externalServices",
    number: 5,
    label: "External services",
    placeholder: "Apple In-App Purchase, RevenueCat, ...",
  },
  {
    key: "regionalDifferences",
    number: 6,
    label: "Regional differences",
    placeholder: "None - same features everywhere",
  },
  {
    key: "regulatedIndustry",
    number: 7,
    label: "Regulated industry / third-party material",
    placeholder: "Not applicable",
  },
];

const FIELD_BY_KEY = new Map(REVIEW_ANSWER_FIELDS.map((field) => [field.key, field]));

export type ReviewAnswers = Record<string, string>;

export function normalizeReviewAnswers(raw: unknown): ReviewAnswers {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Review answers must be an object");
  }

  const answers: ReviewAnswers = {};

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!FIELD_BY_KEY.has(key)) {
      throw new Error(`Unknown review answer field "${key}"`);
    }

    if (typeof value !== "string") {
      throw new Error(`Review answer "${key}" must be a string`);
    }

    const trimmed = value.trim();

    if (trimmed) answers[key] = trimmed;
  }

  return answers;
}

export function formatReviewAnswers(answers: ReviewAnswers): string {
  const lines: string[] = [];

  for (const field of REVIEW_ANSWER_FIELDS) {
    const answer = answers[field.key]?.trim();

    if (!answer) continue;

    lines.push(`${field.number}. ${field.label}: ${answer}`);
  }

  return lines.join("\n\n");
}

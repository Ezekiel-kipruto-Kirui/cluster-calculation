export const getSourceLabel = (source: string): string => {
  if (source === "saved-session") return "Saved Session";
  if (source === "firebase-function") return "Firebase Function";
  return "Local Cluster Engine";
};

const formatPoint = (value: number | string): string =>
  Number(value || 0)
    .toFixed(3)
    .replace(/\.?0+$/, "");

const buildTopClusterLines = (results: Record<string, number>, limit: number): string[] => {
  const entries = Object.entries(results || {})
    .map(([cluster, points]) => [cluster, Number(points)] as const)
    .filter(([, points]) => Number.isFinite(points) && points > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  if (!entries.length) return [];

  return [
    "Top cluster points:",
    ...entries.map(([cluster, points], index) => `${index + 1}. Cluster ${cluster}: ${formatPoint(points)}`),
  ];
};

export const buildAccessCodeEmailMessage = ({
  code,
  results,
  medicineEligible,
}: {
  code: string;
  results?: Record<string, number>;
  medicineEligible?: boolean;
}): string => {
  const lines = ["Your KUCCPS cluster calculation is ready.", "", `Access code: ${code}`];

  if (results && Object.keys(results).length > 0) {
    lines.push("", ...buildTopClusterLines(results, 3));
  }

  if (typeof medicineEligible === "boolean") {
    lines.push("", `Medicine eligibility: ${medicineEligible ? "Eligible" : "Not eligible"}.`);
  }

  lines.push("", "Use this code on the home page to open your saved cluster points and continue course selection.");
  return lines.join("\n");
};

export const buildEmailReceiptMessage = ({ payableAmount }: { payableAmount: number }): string =>
  [
    "We received your email for KUCCPS cluster calculation.",
    "",
    `Next step: complete the M-Pesa payment of KES ${Number(payableAmount || 0)}.`,
    "We will email your access code after the payment is confirmed.",
  ].join("\n");

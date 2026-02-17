import { computeAllClusters, medicineEligibility } from "./clusterEngine";

const withNoTrailingSlash = (value) => (value || "").replace(/\/+$/, "");

const djangoApiBaseUrl = withNoTrailingSlash(import.meta.env.VITE_DJANGO_API_BASE_URL);
const defaultEmailEndpoint = "http://127.0.0.1:8080/api/daraja-emails/send-email/";

const darajaEndpoint = (import.meta.env.VITE_DJANGO_DARAJA_URL || "").trim();

const emailEndpoint =
  import.meta.env.VITE_DJANGO_EMAIL_URL ||
  (djangoApiBaseUrl ? `${djangoApiBaseUrl}/api/daraja-emails/send-email/` : defaultEmailEndpoint);

const parseResponseBody = async (response) => {
  try {
    const text = await response.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const postRequest = async ({ url, headers, body }) => {
  const response = await fetch(url, {
    method: "POST",
    headers: headers || {},
    body: body || undefined,
  });
  const data = await parseResponseBody(response);
  return { ok: response.ok, status: response.status, data };
};

export const calculateLocally = (grades) => ({
  source: "local-engine",
  results: computeAllClusters(grades),
  medicineEligible: medicineEligibility(grades),
});

export const initiateDarajaPayment = async (payload) => {
  if (!darajaEndpoint) {
    throw new Error("Django Daraja endpoint is not configured.");
  }

  const phone =
    payload?.["phone number"] || payload?.phone_number || payload?.phoneNumber || payload?.phone || "";
  const amount = Number(payload?.amount ?? 0);

  const attempts = [
    {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, "phone number": phone }),
    },
    {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, phone_number: phone }),
    },
    {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, phone }),
    },
  ];

  const statuses = [];
  for (const attempt of attempts) {
    const result = await postRequest({ url: darajaEndpoint, ...attempt });
    if (result.ok) return result.data;
    statuses.push(result.status);
  }

  throw new Error(`Daraja API request failed. Status codes: ${statuses.join(", ")}.`);
};

export const sendServiceEmail = async (payload) => {
  if (!emailEndpoint) {
    throw new Error("Django email endpoint is not configured.");
  }

  const email = String(payload?.email || "").trim();
  const subject = String(payload?.subject || "").trim();
  const message = String(payload?.message || "");
  if (!email || !subject || !message) {
    throw new Error("Email, subject and message are required.");
  }

  const query = new URLSearchParams({ email, subject, message }).toString();

  const attempts = [
    {
      // Primary format expected by backend: JSON body with required fields.
      url: emailEndpoint,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, subject, message }),
    },
    {
      // Supported fallback format expected by backend: query parameters.
      url: `${emailEndpoint}${emailEndpoint.includes("?") ? "&" : "?"}${query}`,
      headers: {},
      body: undefined,
    },
  ];

  const statuses = [];
  for (const attempt of attempts) {
    const result = await postRequest(attempt);
    if (result.ok) return result.data;
    statuses.push(result.status);
  }

  throw new Error(`Email API request failed. Status codes: ${statuses.join(", ")}.`);
};

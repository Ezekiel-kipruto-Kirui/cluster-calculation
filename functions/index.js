const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const nodemailer = require("nodemailer");

const region = String(process.env.FUNCTIONS_REGION || "us-central1").trim() || "us-central1";

const getEnv = (key, fallback = "") => String(process.env[key] || fallback).trim();

const requireEnv = (key) => {
  const value = getEnv(key);
  if (!value) {
    const error = new Error(`${key} is not configured.`);
    error.statusCode = 500;
    throw error;
  }
  return value;
};

const getBody = (request) => (request.body && typeof request.body === "object" ? request.body : {});

const assertMethod = (request, response, method = "POST") => {
  if (request.method === method) return true;
  response.status(405).json({ error: `Method ${request.method} is not allowed. Use ${method}.` });
  return false;
};

const phoneDigitsOnly = (value) => String(value || "").replace(/\D/g, "");

const normalizeKenyanPhone = (value) => {
  const digits = phoneDigitsOnly(value);
  if (!digits) throw new Error("Phone number is required.");
  if (digits.startsWith("254") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.startsWith("7") && digits.length === 9) return `254${digits}`;
  throw new Error("Use a valid Kenyan phone number, e.g. 0712345678 or 254712345678.");
};

const normalizeAmount = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount must be a number greater than 0.");
  }
  return Math.round(amount);
};

const formatDarajaTimestamp = () => {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter
    .formatToParts(new Date())
    .filter((part) => part.type !== "literal")
    .reduce((accumulator, part) => {
      accumulator[part.type] = part.value;
      return accumulator;
    }, {});

  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
};

const getDarajaBaseUrl = () => {
  const environment = getEnv("MPESA_ENVIRONMENT", "sandbox").toLowerCase();
  return environment === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
};

const getDarajaToken = async () => {
  const consumerKey = requireEnv("MPESA_CONSUMER_KEY");
  const consumerSecret = requireEnv("MPESA_CONSUMER_SECRET");
  const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const tokenEndpoint = `${getDarajaBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`;

  const response = await fetch(tokenEndpoint, {
    method: "GET",
    headers: {
      Authorization: `Basic ${credentials}`,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.errorMessage || payload.error || `Daraja auth failed with HTTP ${response.status}.`);
    error.statusCode = response.status;
    throw error;
  }

  if (!payload.access_token) {
    throw new Error("Daraja auth response did not include access_token.");
  }

  return payload.access_token;
};

const getDarajaTransactionType = () => {
  const shortcodeType = getEnv("MPESA_SHORTCODE_TYPE", "till_number").toLowerCase();
  return shortcodeType === "paybill" ? "CustomerPayBillOnline" : "CustomerBuyGoodsOnline";
};

const requestStkPush = async ({ phone, amount, accountReference, transactionDesc }) => {
  const callbackUrl = requireEnv("MPESA_CALLBACK_URL");
  const businessShortCode = getEnv("MPESA_EXPRESS_SHORTCODE") || requireEnv("MPESA_SHORTCODE");
  const passkey = requireEnv("MPESA_PASSKEY");

  const normalizedPhone = normalizeKenyanPhone(phone);
  const normalizedAmount = normalizeAmount(amount);
  const timestamp = formatDarajaTimestamp();
  const password = Buffer.from(`${businessShortCode}${passkey}${timestamp}`).toString("base64");
  const accessToken = await getDarajaToken();

  const stkPayload = {
    BusinessShortCode: businessShortCode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: getDarajaTransactionType(),
    Amount: normalizedAmount,
    PartyA: normalizedPhone,
    PartyB: businessShortCode,
    PhoneNumber: normalizedPhone,
    CallBackURL: callbackUrl,
    AccountReference: String(accountReference || "KUCCPS-CLUSTER").slice(0, 12),
    TransactionDesc: String(transactionDesc || "Cluster payment").slice(0, 13),
  };

  const endpoint = `${getDarajaBaseUrl()}/mpesa/stkpush/v1/processrequest`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(stkPayload),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.errorMessage || payload.errorCode || `Daraja STK request failed with HTTP ${response.status}.`);
    error.statusCode = response.status;
    throw error;
  }

  return payload;
};

let emailTransport = null;

const getEmailTransport = () => {
  if (emailTransport) return emailTransport;

  const user = requireEnv("EMAIL_HOST_USER");
  const pass = requireEnv("EMAIL_HOST_PASSWORD");
  const host = getEnv("EMAIL_HOST", "smtp.gmail.com");
  const port = Number(getEnv("EMAIL_HOST_PORT", "465"));
  const secure = getEnv("EMAIL_HOST_SECURE", port === 465 ? "true" : "false").toLowerCase() === "true";

  emailTransport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  return emailTransport;
};

const sanitizeHeaderValue = (value) => String(value || "").replace(/[\r\n]+/g, " ").trim();

exports.stkPush = onRequest({ region, cors: true }, async (request, response) => {
  if (!assertMethod(request, response, "POST")) return;

  try {
    const body = getBody(request);
    const phone =
      body["phone number"] || body.phone_number || body.phoneNumber || body.phone || "";
    const amount = body.amount;
    const accountReference = body.accountReference;
    const transactionDesc = body.transactionDesc;

    const result = await requestStkPush({ phone, amount, accountReference, transactionDesc });
    response.status(200).json({
      status: "queued",
      ...result,
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode || 500);
    logger.error("stkPush failed", {
      message: error?.message || "Unknown STK push error.",
      statusCode,
    });
    response.status(statusCode).json({
      error: error?.message || "Daraja STK push request failed.",
    });
  }
});

exports.darajaCallback = onRequest({ region, cors: true }, async (request, response) => {
  if (request.method !== "POST") {
    response.status(200).json({ status: "ok" });
    return;
  }

  logger.info("Daraja callback received", {
    body: request.body || null,
  });

  response.status(200).json({
    ResultCode: 0,
    ResultDesc: "Accepted",
  });
});

exports.sendEmail = onRequest({ region, cors: true }, async (request, response) => {
  if (!assertMethod(request, response, "POST")) return;

  try {
    const body = getBody(request);
    const to = sanitizeHeaderValue(body.email);
    const subject = sanitizeHeaderValue(body.subject);
    const message = String(body.message || "");

    if (!to || !subject || !message) {
      response.status(400).json({ error: "email, subject, and message are required." });
      return;
    }

    const hostUser = requireEnv("EMAIL_HOST_USER");
    const from = sanitizeHeaderValue(getEnv("EMAIL_FROM", hostUser));
    const transport = getEmailTransport();
    const info = await transport.sendMail({
      from,
      to,
      subject,
      text: message,
    });

    response.status(200).json({
      status: "sent",
      messageId: info.messageId,
      accepted: info.accepted || [],
      rejected: info.rejected || [],
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode || 500);
    logger.error("sendEmail failed", {
      message: error?.message || "Unknown email error.",
      statusCode,
    });
    response.status(statusCode).json({
      error: error?.message || "Email delivery failed.",
    });
  }
});

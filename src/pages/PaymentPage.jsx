import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import AlertMessage from "../components/common/AlertMessage";
import { calculateLocally, initiateDarajaPayment, sendServiceEmail } from "../lib/api";
import { saveClusterSessionWithFallback } from "../lib/realtimeDb";
import { buildAccessCodeEmailMessage } from "../utils/messages";
import { isValidEmail, normalizePhone } from "../utils/validators";

export default function PaymentPage({ pendingGrades, onCalculationReady, payableAmount }) {
  const navigate = useNavigate();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  if (!pendingGrades) return <Navigate to="/calculator" replace />;

  const startPaymentAndCalculate = async (event) => {
    event.preventDefault();
    setError("");

    const normalizedEmail = String(email || "").trim();
    const normalizedPhone = normalizePhone(phoneNumber);

    if (!normalizedPhone) {
      setError("Enter a valid phone number e.g. 0712345678 or 254712345678.");
      return;
    }

    if (!isValidEmail(normalizedEmail)) {
      setError("Enter a valid email address.");
      return;
    }

    setIsLoading(true);
    try {
      const paymentResponse = await initiateDarajaPayment({
        amount: payableAmount,
        phone_number: normalizedPhone,
        phone: normalizedPhone,
        phoneNumber: normalizedPhone,
        "phone number": normalizedPhone,
      });

      const payload = calculateLocally(pendingGrades);
      const { session: savedSession, storage, warning } = await saveClusterSessionWithFallback({
        email: normalizedEmail,
        phoneNumber: normalizedPhone,
        amountPaid: payableAmount,
        grades: pendingGrades,
        results: payload.results,
        medicineEligible: payload.medicineEligible,
        paymentResponse,
      });

      const statusMessages = [];
      if (storage === "local") {
        statusMessages.push(
          warning ||
            "Firebase save failed. Session was saved on this browser only, so code restore works only on this device.",
        );
      } else {
        statusMessages.push("Session saved to Firebase.");
      }

      try {
        await sendServiceEmail({
          email: normalizedEmail,
          subject: "KUCCPS Cluster Calculator Access Code",
          message: buildAccessCodeEmailMessage({ code: savedSession.code }),
        });
        statusMessages.push(`Access code sent to ${normalizedEmail}.`);
      } catch (emailError) {
        statusMessages.push(
          emailError?.message
            ? `Email delivery failed (${emailError.message}). Save this code: ${savedSession.code}.`
            : `Email delivery failed. Save this code: ${savedSession.code}.`,
        );
      }

      onCalculationReady({
        results: payload.results,
        medicineEligible: payload.medicineEligible,
        source: payload.source,
        accessCode: savedSession.code,
        sessionMessage: statusMessages.join(" "),
      });
      navigate("/results");
    } catch (requestError) {
      setError(requestError.message || "Payment or calculation failed.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Payment Prompt</h1>
      <p className="mt-2 text-sm text-slate-600">
        You must pay first. After payment, the system calculates cluster points, saves the session, and sends your
        access code by email.
      </p>
      <p className="mt-1 text-sm font-medium text-emerald-700">Amount: KES {payableAmount}</p>

      <form onSubmit={startPaymentAndCalculate} className="mt-6 space-y-4">
        <div>
          <label htmlFor="phone_number" className="mb-1 block text-sm font-medium text-slate-700">
            M-Pesa Phone Number
          </label>
          <input
            id="phone_number"
            type="tel"
            value={phoneNumber}
            onChange={(event) => setPhoneNumber(event.target.value)}
            placeholder="0712345678"
            required
            className="ui-input"
          />
        </div>

        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
            Email Address (for access code)
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
            className="ui-input"
          />
        </div>

        <AlertMessage tone="danger" message={error} />

        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-slate-900 to-slate-700 px-4 py-2 text-sm font-semibold text-white transition enabled:hover:from-slate-800 enabled:hover:to-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {isLoading ? "Processing..." : "Pay and Calculate"}
        </button>
      </form>
    </section>
  );
}

/**
 * Email notifier for the Firebase API Monitor.
 * Sends Alert_Email and Recovery_Email via the Resend SDK.
 */

const { Resend } = require("resend");
const logger = require("firebase-functions").logger;

/**
 * Returns a Promise that resolves after the given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends an alert email when an endpoint transitions to unhealthy.
 *
 * Single attempt only. On failure, logs the Resend error response and returns
 * without rethrowing.
 *
 * Email format:
 *   Subject: [ALERT] API endpoint down: <url>
 *   Body:
 *     Endpoint: <url>
 *     Status: UNHEALTHY
 *     Reason: <errorMessage>
 *     Detected at: <timestamp>
 *
 * @param {string} url - The endpoint URL that is down
 * @param {string} errorMessage - The failure reason (e.g. "HTTP 503", "timeout")
 * @param {string} timestamp - ISO 8601 UTC timestamp of when the failure was detected
 * @returns {Promise<void>}
 */
async function sendAlertEmail(url, errorMessage, timestamp) {
  const resend = new Resend(process.env.RESEND_API_KEY);

  const to = process.env.ALERT_EMAIL_TO;
  const from = process.env.ALERT_EMAIL_FROM;

  const subject = `[ALERT] API endpoint down: ${url}`;
  const text = [
    `Endpoint: ${url}`,
    `Status: UNHEALTHY`,
    `Reason: ${errorMessage}`,
    `Detected at: ${timestamp}`,
  ].join("\n");

  try {
    const { error } = await resend.emails.send({ from, to, subject, text });
    if (error) {
      logger.error("Email send failed", {
        type: "alert",
        url,
        attempt: 1,
        error: error.message || JSON.stringify(error),
      });
    }
  } catch (err) {
    logger.error("Email send failed", {
      type: "alert",
      url,
      attempt: 1,
      error: err.message,
    });
  }
}

/**
 * Sends a recovery email when an endpoint transitions back to healthy.
 *
 * Retries up to 3 times with exponential backoff:
 *   attempt 1 → wait 1s → attempt 2 → wait 2s → attempt 3 → wait 4s → attempt 4 (final)
 *
 * After all retries are exhausted, logs the final error and returns without rethrowing.
 *
 * Email format:
 *   Subject: [RECOVERY] API endpoint restored: <url>
 *   Body:
 *     Endpoint: <url>
 *     Status: HEALTHY
 *     Recovered at: <timestamp>
 *
 * @param {string} url - The endpoint URL that has recovered
 * @param {string} timestamp - ISO 8601 UTC timestamp of when recovery was detected
 * @returns {Promise<void>}
 */
async function sendRecoveryEmail(url, timestamp) {
  const resend = new Resend(process.env.RESEND_API_KEY);

  const to = process.env.ALERT_EMAIL_TO;
  const from = process.env.ALERT_EMAIL_FROM;

  const subject = `[RECOVERY] API endpoint restored: ${url}`;
  const text = [
    `Endpoint: ${url}`,
    `Status: HEALTHY`,
    `Recovered at: ${timestamp}`,
  ].join("\n");

  // Delays in ms before each retry attempt: [1000, 2000, 4000]
  const retryDelays = [1000, 2000, 4000];
  const maxAttempts = retryDelays.length + 1; // 4 total attempts

  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { error } = await resend.emails.send({ from, to, subject, text });
      if (!error) {
        // Success — email delivered
        return;
      }
      // Resend returned an error object (non-2xx response)
      lastError = new Error(error.message || JSON.stringify(error));
    } catch (err) {
      // Network-level or unexpected error
      lastError = err;
    }

    // If there are more attempts remaining, wait before retrying
    if (attempt < maxAttempts) {
      await sleep(retryDelays[attempt - 1]);
    }
  }

  // All attempts exhausted — log the final error and return without rethrowing
  logger.error("Email send failed", {
    type: "recovery",
    url,
    attempt: maxAttempts,
    error: lastError ? lastError.message : "unknown error",
  });
}

module.exports = { sendAlertEmail, sendRecoveryEmail };

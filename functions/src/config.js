/**
 * Configuration validation for the Firebase API Monitor.
 * Reads and validates all required environment variables.
 */

const DEFAULT_MONITOR_URL = "https://apineuronv2.monkhub.com/user/login";
const MAX_MONITOR_URLS = 50;

/**
 * Validates that a string is a non-empty value.
 * @param {string|undefined} value
 * @returns {boolean}
 */
function isNonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validates that a string looks like an email address:
 * must have at least one non-whitespace character before '@',
 * and a domain with at least one '.' and a non-empty TLD after it.
 * @param {string} value
 * @returns {boolean}
 */
function isValidEmail(value) {
  if (!isNonEmpty(value)) return false;
  const atIndex = value.indexOf("@");
  if (atIndex < 1) return false;
  const local = value.slice(0, atIndex).trim();
  if (local.length === 0) return false;
  const domain = value.slice(atIndex + 1);
  const dotIndex = domain.indexOf(".");
  if (dotIndex < 1) return false;
  const tld = domain.slice(dotIndex + 1).trim();
  return tld.length > 0;
}

/**
 * Validates that a string starts with http:// or https://.
 * @param {string} value
 * @returns {boolean}
 */
function isValidUrl(value) {
  return (
    typeof value === "string" &&
    (value.startsWith("http://") || value.startsWith("https://"))
  );
}

/**
 * Reads and validates all required environment variables.
 * Throws a descriptive Error listing each invalid/missing variable.
 *
 * @returns {{ resendApiKey: string, alertEmailTo: string, alertEmailFrom: string, monitorUrls: string[] }}
 */
function validateConfig() {
  const errors = [];

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!isNonEmpty(resendApiKey)) {
    errors.push("RESEND_API_KEY is missing or empty");
  }

  const alertEmailTo = process.env.ALERT_EMAIL_TO;
  if (!isValidEmail(alertEmailTo)) {
    errors.push(
      `ALERT_EMAIL_TO is missing or invalid: ${JSON.stringify(alertEmailTo)}`
    );
  }

  const alertEmailFrom = process.env.ALERT_EMAIL_FROM;
  if (!isValidEmail(alertEmailFrom)) {
    errors.push(
      `ALERT_EMAIL_FROM is missing or invalid: ${JSON.stringify(alertEmailFrom)}`
    );
  }

  // Parse MONITOR_URLS
  let monitorUrls;
  const rawUrls = process.env.MONITOR_URLS;
  if (!isNonEmpty(rawUrls)) {
    // Fall back to default
    monitorUrls = [DEFAULT_MONITOR_URL];
  } else {
    // Split and trim; drop empty segments (e.g. trailing commas or ",,")
    const allSegments = rawUrls.split(",").map((u) => u.trim());
    const parsed = allSegments.filter((u) => u.length > 0);

    // If the raw value was provided but contains only empty segments (e.g. ",,,"),
    // treat each non-empty segment as invalid — but if truly all empty, flag it.
    if (parsed.length === 0) {
      errors.push(
        "MONITOR_URLS is provided but contains no valid URL entries"
      );
      monitorUrls = [DEFAULT_MONITOR_URL];
    } else {
      if (parsed.length > MAX_MONITOR_URLS) {
        errors.push(
          `MONITOR_URLS exceeds maximum of ${MAX_MONITOR_URLS} URLs (got ${parsed.length})`
        );
      }

      const invalidUrls = parsed.filter((u) => !isValidUrl(u));
      if (invalidUrls.length > 0) {
        errors.push(
          `MONITOR_URLS contains malformed URL(s): ${invalidUrls.map((u) => JSON.stringify(u)).join(", ")}`
        );
      }

      monitorUrls = parsed;
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Configuration validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`
    );
  }

  return {
    resendApiKey: resendApiKey.trim(),
    alertEmailTo: alertEmailTo.trim(),
    alertEmailFrom: alertEmailFrom.trim(),
    monitorUrls,
  };
}

module.exports = { validateConfig };

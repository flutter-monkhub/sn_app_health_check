/**
 * HTTP health checker for the Firebase API Monitor.
 * Performs a single HTTP POST health check against a URL and returns a structured result.
 */

const axios = require("axios");

const TIMEOUT_MS = 10000; // 10 seconds

/**
 * @typedef {Object} CheckResult
 * @property {string} url - The endpoint URL that was checked
 * @property {'healthy'|'unhealthy'} status - Health classification
 * @property {number|null} statusCode - HTTP status code, or null for network/timeout errors
 * @property {string|null} errorMessage - Failure reason, or null when healthy
 * @property {string} checkedAt - ISO 8601 UTC timestamp of when the check was performed
 */

/**
 * Performs an HTTP POST health check against the given URL.
 *
 * Classification logic:
 * - HTTP 200–299 → status: 'healthy', errorMessage: null
 * - HTTP outside 200–299 → status: 'unhealthy', errorMessage: 'HTTP <code>'
 * - Axios ECONNABORTED (timeout) → status: 'unhealthy', errorMessage: 'timeout', statusCode: null
 * - Network error (no error.response) → status: 'unhealthy', errorMessage: 'network error: <message>', statusCode: null
 *
 * @param {string} url - The endpoint URL to check
 * @returns {Promise<CheckResult>}
 */
async function checkEndpoint(url) {
  const checkedAt = new Date().toISOString();

  try {
    const response = await axios.post(url, {}, {
      headers: { "Content-Type": "application/json" },
      timeout: TIMEOUT_MS,
      // Prevent axios from throwing on non-2xx so we can handle them ourselves
      validateStatus: null,
    });

    const statusCode = response.status;

    if (statusCode >= 200 && statusCode <= 299) {
      return {
        url,
        status: "healthy",
        statusCode,
        errorMessage: null,
        checkedAt,
      };
    }

    return {
      url,
      status: "unhealthy",
      statusCode,
      errorMessage: `HTTP ${statusCode}`,
      checkedAt,
    };
  } catch (error) {
    // Timeout: Axios sets error.code to 'ECONNABORTED' for timeout errors
    if (error.code === "ECONNABORTED") {
      return {
        url,
        status: "unhealthy",
        statusCode: null,
        errorMessage: "timeout",
        checkedAt,
      };
    }

    // Network error: no HTTP response received (DNS failure, connection refused, etc.)
    if (!error.response) {
      return {
        url,
        status: "unhealthy",
        statusCode: null,
        errorMessage: `network error: ${error.message}`,
        checkedAt,
      };
    }

    // Fallback: Axios error with a response (shouldn't reach here due to validateStatus: null,
    // but handle defensively)
    const statusCode = error.response.status;
    return {
      url,
      status: "unhealthy",
      statusCode,
      errorMessage: `HTTP ${statusCode}`,
      checkedAt,
    };
  }
}

module.exports = { checkEndpoint };

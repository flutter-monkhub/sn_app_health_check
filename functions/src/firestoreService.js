/**
 * Firestore state manager for the Firebase API Monitor.
 * Reads and writes StatusRecord documents in the `endpoint_status` collection.
 */

const crypto = require("crypto");
const admin = require("firebase-admin");
const logger = require("firebase-functions").logger;

const COLLECTION_NAME = "endpoint_status";

/**
 * @typedef {Object} StatusRecord
 * @property {string} url - The full endpoint URL being monitored
 * @property {'healthy'|'unhealthy'} status - Last known health status
 * @property {string} lastCheckedAt - ISO 8601 UTC timestamp of the most recent check
 * @property {string} lastStatusChangeAt - ISO 8601 UTC timestamp of the last status transition
 * @property {string|null} errorMessage - Failure reason when unhealthy; null when healthy
 */

/**
 * @typedef {Object} CheckResult
 * @property {string} url - The endpoint URL that was checked
 * @property {'healthy'|'unhealthy'} status - Health classification
 * @property {number|null} statusCode - HTTP status code, or null for network/timeout errors
 * @property {string|null} errorMessage - Failure reason, or null when healthy
 * @property {string} checkedAt - ISO 8601 UTC timestamp of when the check was performed
 */

/**
 * Computes the Firestore document ID for a given URL.
 * Uses SHA-256 hex digest, truncated to 40 characters.
 *
 * @param {string} url
 * @returns {string}
 */
function getDocumentId(url) {
  return crypto.createHash("sha256").update(url).digest("hex").slice(0, 40);
}

/**
 * Reads the StatusRecord for the given URL from Firestore.
 * Returns null if the document does not exist or if a Firestore error occurs.
 *
 * @param {string} url
 * @returns {Promise<StatusRecord|null>}
 */
async function getStatusRecord(url) {
  const docId = getDocumentId(url);
  try {
    const docRef = admin.firestore().collection(COLLECTION_NAME).doc(docId);
    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      return null;
    }

    return snapshot.data();
  } catch (err) {
    logger.error("Firestore operation failed", {
      url,
      operation: "get",
      error: err.message,
    });
    return null;
  }
}

/**
 * Writes or updates the StatusRecord for the given URL in Firestore.
 *
 * Write strategy:
 * - No previous record → set() all fields, lastStatusChangeAt = checkResult.checkedAt
 * - Status changed     → update() status, lastCheckedAt, lastStatusChangeAt, errorMessage
 * - Status unchanged   → update() only lastCheckedAt
 *
 * On unhealthy→healthy transition, errorMessage is explicitly set to null.
 * All Firestore errors are caught, logged with URL and operation type, and swallowed.
 *
 * @param {string} url
 * @param {CheckResult} checkResult
 * @param {StatusRecord|null} previousRecord
 * @returns {Promise<void>}
 */
async function saveStatusRecord(url, checkResult, previousRecord) {
  const docId = getDocumentId(url);
  const docRef = admin.firestore().collection(COLLECTION_NAME).doc(docId);

  try {
    if (!previousRecord) {
      // No existing record — create a new one with set()
      await docRef.set({
        url: checkResult.url,
        status: checkResult.status,
        lastCheckedAt: checkResult.checkedAt,
        lastStatusChangeAt: checkResult.checkedAt,
        errorMessage: checkResult.errorMessage,
      });
    } else if (previousRecord.status !== checkResult.status) {
      // Status changed — update relevant fields including lastStatusChangeAt
      await docRef.update({
        status: checkResult.status,
        lastCheckedAt: checkResult.checkedAt,
        lastStatusChangeAt: checkResult.checkedAt,
        // Set errorMessage to null on unhealthy→healthy transition; otherwise use new value
        errorMessage: checkResult.status === "healthy" ? null : checkResult.errorMessage,
      });
    } else {
      // Status unchanged — update only lastCheckedAt
      await docRef.update({
        lastCheckedAt: checkResult.checkedAt,
      });
    }
  } catch (err) {
    const operation = !previousRecord ? "set" : "update";
    logger.error("Firestore operation failed", {
      url,
      operation,
      error: err.message,
    });
    // Swallow the error — processing continues for remaining endpoints
  }
}

module.exports = { getStatusRecord, saveStatusRecord };

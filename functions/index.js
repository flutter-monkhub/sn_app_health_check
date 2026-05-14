/**
 * Firebase Cloud Functions entry point for the API Health Monitor.
 *
 * Exports the `apiHealthMonitor` scheduled function that runs every 5 minutes,
 * checks each configured endpoint, and sends alert/recovery emails on status transitions.
 */

const { onSchedule } = require("firebase-functions/v2/scheduler");
const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

const { validateConfig } = require("./src/config");
const { checkEndpoint } = require("./src/healthCheck");
const { getStatusRecord, saveStatusRecord } = require("./src/firestoreService");
const { sendAlertEmail, sendRecoveryEmail } = require("./src/notifier");

/**
 * Scheduled Cloud Function that monitors configured API endpoints every 5 minutes.
 *
 * Execution flow per invocation:
 * 1. Validate environment variables — return immediately on failure.
 * 2. For each configured URL (sequentially):
 *    a. Read the previous StatusRecord from Firestore.
 *    b. Perform an HTTP health check.
 *    c. Send an alert or recovery email if the status has transitioned.
 *    d. Persist the new StatusRecord to Firestore.
 *    e. Log the result.
 *
 * Unhandled exceptions inside the check loop propagate to the Cloud Functions
 * runtime so that Cloud Scheduler can apply its retry policy.
 */
exports.apiHealthMonitor = onSchedule("every 5 minutes", async (event) => {
  // --- Step 1: Validate configuration ---
  let config;
  try {
    config = validateConfig();
  } catch (err) {
    functions.logger.error("Config validation failed", { error: err.message });
    return;
  }

  const { monitorUrls } = config;

  // --- Step 2: Process each URL sequentially ---
  for (const url of monitorUrls) {
    // a. Read previous state from Firestore
    const previousRecord = await getStatusRecord(url);

    // b. Perform the HTTP health check
    const checkResult = await checkEndpoint(url);

    // c. Determine whether a status transition occurred and send email if needed
    const previousStatus = previousRecord ? previousRecord.status : null;
    const currentStatus = checkResult.status;

    if (
      (previousStatus === null || previousStatus === "healthy") &&
      currentStatus === "unhealthy"
    ) {
      // healthy (or first check) → unhealthy: send alert
      functions.logger.info("Status changed", {
        url,
        from: previousStatus,
        to: currentStatus,
        at: checkResult.checkedAt,
      });
      await sendAlertEmail(url, checkResult.errorMessage, checkResult.checkedAt);
    } else if (previousStatus === "unhealthy" && currentStatus === "healthy") {
      // unhealthy → healthy: send recovery
      functions.logger.info("Status changed", {
        url,
        from: previousStatus,
        to: currentStatus,
        at: checkResult.checkedAt,
      });
      await sendRecoveryEmail(url, checkResult.checkedAt);
    }

    // d. Persist the updated record to Firestore
    await saveStatusRecord(url, checkResult, previousRecord);

    // e. Log the health check result
    functions.logger.info("Health check complete", {
      url: checkResult.url,
      status: checkResult.status,
      statusCode: checkResult.statusCode,
      checkedAt: checkResult.checkedAt,
    });
  }
});

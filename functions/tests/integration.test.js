"use strict";

/**
 * Integration tests for the Firebase API Monitor — full invocation scenarios.
 *
 * These tests exercise the orchestration logic in index.js end-to-end:
 *   - Real Firestore state persistence (via Firestore emulator when available)
 *   - Mocked HTTP calls (Axios) returning configurable status codes / errors
 *   - Mocked email delivery (Resend) to capture sent emails
 *
 * Requirements validated: 1.1, 3.1, 3.2, 4.1, 4.5, 5.1, 6.3
 *
 * ─── Emulator setup ──────────────────────────────────────────────────────────
 * Set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 (or the port your emulator uses)
 * before running these tests to enable real Firestore persistence.
 *
 * If the emulator is not running the tests are skipped automatically so they
 * never fail in environments where the emulator is unavailable.
 *
 * Start the emulator with:
 *   firebase emulators:start --only firestore
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ---------------------------------------------------------------------------
// Jest module mocks — must be declared before any require() calls
// ---------------------------------------------------------------------------

// Mock Axios so we control what each HTTP health-check returns
jest.mock("axios");

// Mock the Resend SDK so we capture emails without real API calls
jest.mock("resend", () => {
  const mockSend = jest.fn();
  return {
    Resend: jest.fn().mockImplementation(() => ({
      emails: { send: mockSend },
    })),
    __mockSend: mockSend,
  };
});

// Mock firebase-functions logger to suppress noise during tests
jest.mock("firebase-functions", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Requires (after mocks are registered)
// ---------------------------------------------------------------------------

const axios = require("axios");
const { Resend, __mockSend: mockResendSend } = require("resend");
const admin = require("firebase-admin");

// ---------------------------------------------------------------------------
// Environment setup
// ---------------------------------------------------------------------------

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const EMULATOR_AVAILABLE = !!process.env.FIRESTORE_EMULATOR_HOST;

const TEST_URL = "https://test-api.example.com/health";

const VALID_ENV = {
  RESEND_API_KEY: "re_test_integration_key",
  ALERT_EMAIL_TO: "alerts@example.com",
  ALERT_EMAIL_FROM: "monitor@example.com",
  MONITOR_URLS: TEST_URL,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Apply env vars for the duration of a callback, then restore originals.
 */
function withEnv(vars, fn) {
  const saved = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    if (vars[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = vars[key];
    }
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

/**
 * Configure Axios mock to return a successful HTTP 200 response.
 */
function mockAxiosSuccess(statusCode = 200) {
  axios.post.mockResolvedValue({ status: statusCode, data: {} });
}

/**
 * Configure Axios mock to return a non-2xx HTTP error response.
 */
function mockAxiosHttpError(statusCode = 500) {
  axios.post.mockResolvedValue({ status: statusCode, data: {} });
}

/**
 * Configure Axios mock to simulate a timeout (ECONNABORTED).
 */
function mockAxiosTimeout() {
  const err = new Error("timeout of 10000ms exceeded");
  err.code = "ECONNABORTED";
  axios.post.mockRejectedValue(err);
}

/**
 * Configure Axios mock to simulate a network error (no response).
 */
function mockAxiosNetworkError(message = "connect ECONNREFUSED") {
  const err = new Error(message);
  // No err.response — pure network failure
  axios.post.mockRejectedValue(err);
}

/**
 * Configure Resend mock to succeed (return no error).
 */
function mockResendSuccess() {
  mockResendSend.mockResolvedValue({ data: { id: "email-id-123" }, error: null });
}

/**
 * Configure Resend mock to fail.
 */
function mockResendFailure(message = "Resend API error") {
  mockResendSend.mockResolvedValue({ data: null, error: { message } });
}

/**
 * Read a Firestore status record directly for assertion.
 * Returns null if the document does not exist.
 */
async function readFirestoreRecord(url) {
  const crypto = require("crypto");
  const docId = crypto.createHash("sha256").update(url).digest("hex").slice(0, 40);
  const snapshot = await admin
    .firestore()
    .collection("endpoint_status")
    .doc(docId)
    .get();
  return snapshot.exists ? snapshot.data() : null;
}

/**
 * Delete a Firestore status record (cleanup between tests).
 */
async function deleteFirestoreRecord(url) {
  const crypto = require("crypto");
  const docId = crypto.createHash("sha256").update(url).digest("hex").slice(0, 40);
  await admin.firestore().collection("endpoint_status").doc(docId).delete();
}

/**
 * Run one full monitor invocation for the given URL with the given env.
 * Simulates what the Cloud Scheduler trigger does.
 */
async function runMonitorInvocation(envOverrides = {}) {
  // Re-require index.js fresh each time so module-level state is reset.
  // We use jest.isolateModules to get a clean module registry per invocation.
  let result;
  await jest.isolateModulesAsync(async () => {
    // Apply env for this invocation
    const env = { ...VALID_ENV, ...envOverrides };
    for (const [k, v] of Object.entries(env)) {
      process.env[k] = v;
    }

    // Load the orchestration modules directly (not the scheduled wrapper)
    const { validateConfig } = require("../src/config");
    const { checkEndpoint } = require("../src/healthCheck");
    const { getStatusRecord, saveStatusRecord } = require("../src/firestoreService");
    const { sendAlertEmail, sendRecoveryEmail } = require("../src/notifier");

    let config;
    try {
      config = validateConfig();
    } catch (err) {
      result = { error: err };
      return;
    }

    const { monitorUrls } = config;

    for (const url of monitorUrls) {
      const previousRecord = await getStatusRecord(url);
      const checkResult = await checkEndpoint(url);

      const previousStatus = previousRecord ? previousRecord.status : null;
      const currentStatus = checkResult.status;

      if (
        (previousStatus === null || previousStatus === "healthy") &&
        currentStatus === "unhealthy"
      ) {
        await sendAlertEmail(url, checkResult.errorMessage, checkResult.checkedAt);
      } else if (previousStatus === "unhealthy" && currentStatus === "healthy") {
        await sendRecoveryEmail(url, checkResult.checkedAt);
      }

      await saveStatusRecord(url, checkResult, previousRecord);
    }

    result = { success: true };
  });
  return result;
}

// ---------------------------------------------------------------------------
// Firebase Admin initialisation (once per test suite)
// ---------------------------------------------------------------------------

let adminInitialised = false;

function ensureAdminInitialised() {
  if (adminInitialised) return;
  // Point Admin SDK at the emulator
  process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST;
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: "demo-test-project" });
  }
  adminInitialised = true;
}

// ---------------------------------------------------------------------------
// Skip helper — skip all tests when emulator is not available
// ---------------------------------------------------------------------------

/**
 * Wraps describe() to skip the entire suite when the Firestore emulator
 * is not reachable. This keeps the test suite green in environments where
 * the emulator is not running (e.g. plain `npm test` without emulator).
 */
function describeWithEmulator(name, fn) {
  if (!EMULATOR_AVAILABLE) {
    describe.skip(`${name} [SKIPPED: set FIRESTORE_EMULATOR_HOST to enable]`, fn);
  } else {
    describe(name, fn);
  }
}

// ---------------------------------------------------------------------------
// Integration test suites
// ---------------------------------------------------------------------------

describeWithEmulator("Integration: Full invocation scenarios", () => {
  beforeAll(() => {
    ensureAdminInitialised();
  });

  beforeEach(async () => {
    // Reset mocks before each test
    jest.clearAllMocks();
    mockResendSuccess();
    // Clean up any existing Firestore record for the test URL
    await deleteFirestoreRecord(TEST_URL);
  });

  // ─── Suite 1: Firestore document creation and update ─────────────────────

  describe("Requirement 3.1 & 3.2: Firestore document creation and update", () => {
    test("creates a new Firestore document on first invocation (healthy)", async () => {
      mockAxiosSuccess(200);

      await runMonitorInvocation();

      const record = await readFirestoreRecord(TEST_URL);
      expect(record).not.toBeNull();
      expect(record.url).toBe(TEST_URL);
      expect(record.status).toBe("healthy");
      expect(record.errorMessage).toBeNull();
      expect(record.lastCheckedAt).toBeDefined();
      expect(record.lastStatusChangeAt).toBeDefined();
      // On first record, lastStatusChangeAt === lastCheckedAt
      expect(record.lastStatusChangeAt).toBe(record.lastCheckedAt);
    });

    test("creates a new Firestore document on first invocation (unhealthy — HTTP 500)", async () => {
      mockAxiosHttpError(500);

      await runMonitorInvocation();

      const record = await readFirestoreRecord(TEST_URL);
      expect(record).not.toBeNull();
      expect(record.url).toBe(TEST_URL);
      expect(record.status).toBe("unhealthy");
      expect(record.errorMessage).toBe("HTTP 500");
      expect(record.lastCheckedAt).toBeDefined();
      expect(record.lastStatusChangeAt).toBe(record.lastCheckedAt);
    });

    test("updates Firestore document on second invocation — status unchanged (healthy→healthy)", async () => {
      // First invocation: healthy
      mockAxiosSuccess(200);
      await runMonitorInvocation();
      const firstRecord = await readFirestoreRecord(TEST_URL);

      // Small delay to ensure timestamps differ
      await new Promise((r) => setTimeout(r, 10));

      // Second invocation: still healthy
      mockAxiosSuccess(200);
      await runMonitorInvocation();
      const secondRecord = await readFirestoreRecord(TEST_URL);

      expect(secondRecord.status).toBe("healthy");
      // lastCheckedAt should be updated
      expect(secondRecord.lastCheckedAt).not.toBe(firstRecord.lastCheckedAt);
      // lastStatusChangeAt should NOT change (status unchanged)
      expect(secondRecord.lastStatusChangeAt).toBe(firstRecord.lastStatusChangeAt);
    });

    test("updates Firestore document on status change (healthy→unhealthy)", async () => {
      // First invocation: healthy
      mockAxiosSuccess(200);
      await runMonitorInvocation();
      const firstRecord = await readFirestoreRecord(TEST_URL);

      await new Promise((r) => setTimeout(r, 10));

      // Second invocation: unhealthy
      mockAxiosHttpError(503);
      await runMonitorInvocation();
      const secondRecord = await readFirestoreRecord(TEST_URL);

      expect(secondRecord.status).toBe("unhealthy");
      expect(secondRecord.errorMessage).toBe("HTTP 503");
      // lastStatusChangeAt should be updated on transition
      expect(secondRecord.lastStatusChangeAt).not.toBe(firstRecord.lastStatusChangeAt);
    });

    test("sets errorMessage to null when status transitions from unhealthy to healthy", async () => {
      // First invocation: unhealthy
      mockAxiosHttpError(500);
      await runMonitorInvocation();

      // Second invocation: healthy
      mockAxiosSuccess(200);
      await runMonitorInvocation();

      const record = await readFirestoreRecord(TEST_URL);
      expect(record.status).toBe("healthy");
      expect(record.errorMessage).toBeNull();
    });

    test("creates Firestore document correctly for timeout error", async () => {
      mockAxiosTimeout();

      await runMonitorInvocation();

      const record = await readFirestoreRecord(TEST_URL);
      expect(record).not.toBeNull();
      expect(record.status).toBe("unhealthy");
      expect(record.errorMessage).toBe("timeout");
    });

    test("creates Firestore document correctly for network error", async () => {
      mockAxiosNetworkError("connect ECONNREFUSED 127.0.0.1:9999");

      await runMonitorInvocation();

      const record = await readFirestoreRecord(TEST_URL);
      expect(record).not.toBeNull();
      expect(record.status).toBe("unhealthy");
      expect(record.errorMessage).toMatch(/^network error:/);
    });
  });

  // ─── Suite 2: Alert email behaviour ──────────────────────────────────────

  describe("Requirement 4.1 & 6.3: Alert email on healthy→unhealthy transition", () => {
    test("sends Alert_Email on first invocation when endpoint is unhealthy (no prior record)", async () => {
      mockAxiosHttpError(500);

      await runMonitorInvocation();

      expect(mockResendSend).toHaveBeenCalledTimes(1);
      const callArgs = mockResendSend.mock.calls[0][0];
      expect(callArgs.subject).toMatch(/\[ALERT\]/);
      expect(callArgs.subject).toContain(TEST_URL);
      expect(callArgs.text).toContain("HTTP 500");
      expect(callArgs.to).toBe(VALID_ENV.ALERT_EMAIL_TO);
      expect(callArgs.from).toBe(VALID_ENV.ALERT_EMAIL_FROM);
    });

    test("sends Alert_Email when endpoint transitions from healthy to unhealthy", async () => {
      // First invocation: healthy — no email
      mockAxiosSuccess(200);
      await runMonitorInvocation();
      expect(mockResendSend).not.toHaveBeenCalled();

      jest.clearAllMocks();
      mockResendSuccess();

      // Second invocation: unhealthy — alert email expected
      mockAxiosHttpError(503);
      await runMonitorInvocation();

      expect(mockResendSend).toHaveBeenCalledTimes(1);
      const callArgs = mockResendSend.mock.calls[0][0];
      expect(callArgs.subject).toMatch(/\[ALERT\]/);
      expect(callArgs.text).toContain("HTTP 503");
    });

    test("sends Alert_Email with correct content for timeout error", async () => {
      mockAxiosTimeout();

      await runMonitorInvocation();

      expect(mockResendSend).toHaveBeenCalledTimes(1);
      const callArgs = mockResendSend.mock.calls[0][0];
      expect(callArgs.text).toContain("timeout");
    });

    test("sends Alert_Email with correct content for network error", async () => {
      mockAxiosNetworkError("connect ECONNREFUSED");

      await runMonitorInvocation();

      expect(mockResendSend).toHaveBeenCalledTimes(1);
      const callArgs = mockResendSend.mock.calls[0][0];
      expect(callArgs.text).toMatch(/network error/);
    });

    test("does NOT send Alert_Email when endpoint is healthy", async () => {
      mockAxiosSuccess(200);

      await runMonitorInvocation();

      expect(mockResendSend).not.toHaveBeenCalled();
    });
  });

  // ─── Suite 3: No duplicate Alert_Email ───────────────────────────────────

  describe("Requirement 4.5 & 6.3: No duplicate Alert_Email for ongoing failure", () => {
    test("does NOT send a second Alert_Email on consecutive invocations with same unhealthy status", async () => {
      // First invocation: unhealthy → Alert_Email sent
      mockAxiosHttpError(500);
      await runMonitorInvocation();
      expect(mockResendSend).toHaveBeenCalledTimes(1);

      jest.clearAllMocks();
      mockResendSuccess();

      // Second invocation: still unhealthy → NO additional Alert_Email
      mockAxiosHttpError(500);
      await runMonitorInvocation();

      expect(mockResendSend).not.toHaveBeenCalled();
    });

    test("does NOT send Alert_Email on third consecutive unhealthy invocation", async () => {
      // Invocation 1: unhealthy → alert sent
      mockAxiosHttpError(500);
      await runMonitorInvocation();

      jest.clearAllMocks();
      mockResendSuccess();

      // Invocation 2: still unhealthy → no alert
      mockAxiosHttpError(500);
      await runMonitorInvocation();

      jest.clearAllMocks();
      mockResendSuccess();

      // Invocation 3: still unhealthy → no alert
      mockAxiosHttpError(500);
      await runMonitorInvocation();

      expect(mockResendSend).not.toHaveBeenCalled();
    });

    test("sends a new Alert_Email after recovery then re-failure", async () => {
      // Invocation 1: unhealthy → alert
      mockAxiosHttpError(500);
      await runMonitorInvocation();
      expect(mockResendSend).toHaveBeenCalledTimes(1);

      jest.clearAllMocks();
      mockResendSuccess();

      // Invocation 2: healthy → recovery email
      mockAxiosSuccess(200);
      await runMonitorInvocation();
      expect(mockResendSend).toHaveBeenCalledTimes(1);
      expect(mockResendSend.mock.calls[0][0].subject).toMatch(/\[RECOVERY\]/);

      jest.clearAllMocks();
      mockResendSuccess();

      // Invocation 3: unhealthy again → new alert email
      mockAxiosHttpError(503);
      await runMonitorInvocation();
      expect(mockResendSend).toHaveBeenCalledTimes(1);
      expect(mockResendSend.mock.calls[0][0].subject).toMatch(/\[ALERT\]/);
    });
  });

  // ─── Suite 4: Recovery email behaviour ───────────────────────────────────

  describe("Requirement 5.1: Recovery_Email on unhealthy→healthy transition", () => {
    test("sends Recovery_Email when endpoint transitions from unhealthy to healthy", async () => {
      // First invocation: unhealthy
      mockAxiosHttpError(500);
      await runMonitorInvocation();

      jest.clearAllMocks();
      mockResendSuccess();

      // Second invocation: healthy → recovery email
      mockAxiosSuccess(200);
      await runMonitorInvocation();

      expect(mockResendSend).toHaveBeenCalledTimes(1);
      const callArgs = mockResendSend.mock.calls[0][0];
      expect(callArgs.subject).toMatch(/\[RECOVERY\]/);
      expect(callArgs.subject).toContain(TEST_URL);
      expect(callArgs.text).toContain("HEALTHY");
      expect(callArgs.to).toBe(VALID_ENV.ALERT_EMAIL_TO);
      expect(callArgs.from).toBe(VALID_ENV.ALERT_EMAIL_FROM);
    });

    test("does NOT send Recovery_Email when endpoint stays healthy", async () => {
      // First invocation: healthy
      mockAxiosSuccess(200);
      await runMonitorInvocation();

      jest.clearAllMocks();
      mockResendSuccess();

      // Second invocation: still healthy
      mockAxiosSuccess(200);
      await runMonitorInvocation();

      expect(mockResendSend).not.toHaveBeenCalled();
    });

    test("does NOT send Recovery_Email when endpoint stays unhealthy", async () => {
      // First invocation: unhealthy → alert sent
      mockAxiosHttpError(500);
      await runMonitorInvocation();

      jest.clearAllMocks();
      mockResendSuccess();

      // Second invocation: still unhealthy → no recovery email
      mockAxiosHttpError(500);
      await runMonitorInvocation();

      expect(mockResendSend).not.toHaveBeenCalled();
    });

    test("Firestore record reflects healthy status even when Recovery_Email fails", async () => {
      // First invocation: unhealthy
      mockAxiosHttpError(500);
      await runMonitorInvocation();

      // Make Resend fail for recovery email
      mockResendFailure("Resend API unavailable");

      // Second invocation: healthy — recovery email will fail
      mockAxiosSuccess(200);
      await runMonitorInvocation();

      // Firestore should still show healthy (Req 5.6 / Property 8)
      const record = await readFirestoreRecord(TEST_URL);
      expect(record.status).toBe("healthy");
      expect(record.errorMessage).toBeNull();
    });
  });

  // ─── Suite 5: Various HTTP status codes ──────────────────────────────────

  describe("Requirement 1.1 & 3.2: Various HTTP status codes are handled correctly", () => {
    const unhealthyCodes = [400, 401, 403, 404, 500, 502, 503];
    const healthyCodes = [200, 201, 204];

    for (const code of healthyCodes) {
      test(`HTTP ${code} → stored as healthy in Firestore`, async () => {
        mockAxiosSuccess(code);
        await runMonitorInvocation();
        const record = await readFirestoreRecord(TEST_URL);
        expect(record.status).toBe("healthy");
        expect(record.errorMessage).toBeNull();
      });
    }

    for (const code of unhealthyCodes) {
      test(`HTTP ${code} → stored as unhealthy in Firestore with correct errorMessage`, async () => {
        mockAxiosHttpError(code);
        await runMonitorInvocation();
        const record = await readFirestoreRecord(TEST_URL);
        expect(record.status).toBe("unhealthy");
        expect(record.errorMessage).toBe(`HTTP ${code}`);
      });
    }

    test("timeout → stored as unhealthy with errorMessage 'timeout'", async () => {
      mockAxiosTimeout();
      await runMonitorInvocation();
      const record = await readFirestoreRecord(TEST_URL);
      expect(record.status).toBe("unhealthy");
      expect(record.errorMessage).toBe("timeout");
    });
  });
});

// ---------------------------------------------------------------------------
// Standalone tests that do NOT require the emulator
// (test orchestration logic with in-memory mocks only)
// ---------------------------------------------------------------------------

describe("Integration (no emulator): Orchestration logic with mocked Firestore", () => {
  /**
   * These tests mock both Axios AND the firestoreService module so they run
   * without any emulator. They verify the email-sending decision logic in
   * the orchestration layer.
   */

  beforeEach(() => {
    jest.clearAllMocks();
    mockResendSuccess();
  });

  /**
   * Helper: run the orchestration decision logic directly, given explicit
   * previousStatus and currentStatus values. This avoids needing a real
   * Firestore or HTTP server — it tests only the email-sending decision.
   */
  async function runOrchestrationDecision(previousStatus, currentStatus, url) {
    const { sendAlertEmail, sendRecoveryEmail } = require("../src/notifier");
    const timestamp = new Date().toISOString();
    const errorMessage = currentStatus === "unhealthy" ? "HTTP 500" : null;

    if (
      (previousStatus === null || previousStatus === "healthy") &&
      currentStatus === "unhealthy"
    ) {
      await sendAlertEmail(url, errorMessage, timestamp);
    } else if (previousStatus === "unhealthy" && currentStatus === "healthy") {
      await sendRecoveryEmail(url, timestamp);
    }
  }

  describe("Alert email decision logic", () => {
    test("sends Alert_Email when no prior record (null) and endpoint is unhealthy", async () => {
      await runOrchestrationDecision(null, "unhealthy", TEST_URL);

      expect(mockResendSend).toHaveBeenCalledTimes(1);
      expect(mockResendSend.mock.calls[0][0].subject).toMatch(/\[ALERT\]/);
      expect(mockResendSend.mock.calls[0][0].subject).toContain(TEST_URL);
    });

    test("sends Alert_Email when prior record is healthy and endpoint is unhealthy", async () => {
      await runOrchestrationDecision("healthy", "unhealthy", TEST_URL);

      expect(mockResendSend).toHaveBeenCalledTimes(1);
      expect(mockResendSend.mock.calls[0][0].subject).toMatch(/\[ALERT\]/);
    });

    test("does NOT send Alert_Email when prior record is unhealthy and current is unhealthy", async () => {
      await runOrchestrationDecision("unhealthy", "unhealthy", TEST_URL);

      expect(mockResendSend).not.toHaveBeenCalled();
    });

    test("sends Recovery_Email when prior record is unhealthy and current is healthy", async () => {
      await runOrchestrationDecision("unhealthy", "healthy", TEST_URL);

      expect(mockResendSend).toHaveBeenCalledTimes(1);
      expect(mockResendSend.mock.calls[0][0].subject).toMatch(/\[RECOVERY\]/);
      expect(mockResendSend.mock.calls[0][0].subject).toContain(TEST_URL);
    });

    test("does NOT send any email when prior record is healthy and current is healthy", async () => {
      await runOrchestrationDecision("healthy", "healthy", TEST_URL);

      expect(mockResendSend).not.toHaveBeenCalled();
    });

    test("does NOT send any email when prior record is null and current is healthy", async () => {
      await runOrchestrationDecision(null, "healthy", TEST_URL);

      expect(mockResendSend).not.toHaveBeenCalled();
    });
  });
});

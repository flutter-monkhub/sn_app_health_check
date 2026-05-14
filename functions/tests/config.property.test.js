/**
 * Property-based tests for validateConfig() in config.js
 *
 * **Validates: Requirements 7.6, 7.7**
 */

// ---------------------------------------------------------------------------
// NOTE: Property 6 (email format validation) is defined at the bottom of
// this file and validates Requirement 7.7.
// ---------------------------------------------------------------------------

"use strict";

const fc = require("fast-check");
const { validateConfig } = require("../src/config");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Save and restore process.env around each test so mutations don't leak.
 */
function withEnv(vars, fn) {
  const saved = {};
  const keys = Object.keys(vars);

  // Save originals and apply overrides
  for (const key of keys) {
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
    // Restore originals
    for (const key of keys) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

/** Valid base env so we can isolate URL validation. */
const VALID_BASE_ENV = {
  RESEND_API_KEY: "re_test_key_123",
  ALERT_EMAIL_TO: "alerts@example.com",
  ALERT_EMAIL_FROM: "monitor@example.com",
};

// ---------------------------------------------------------------------------
// Property 5: URL validation rejects all non-HTTP(S) URLs
// ---------------------------------------------------------------------------

describe("Property 5: URL validation rejects all non-HTTP(S) URLs", () => {
  /**
   * Generator: arbitrary strings that do NOT start with 'http://' or 'https://'.
   *
   * Strategy:
   *  - Generate any printable ASCII string
   *  - Filter out strings that accidentally start with http:// or https://
   *  - Ensure the string is non-empty so it isn't treated as absent/empty
   *    (absent MONITOR_URLS falls back to the default valid URL)
   */
  const nonHttpUrlArb = fc
    .string({ minLength: 1, maxLength: 200 })
    .filter(
      (s) =>
        s.trim().length > 0 &&
        !s.startsWith("http://") &&
        !s.startsWith("https://")
    );

  test(
    "validateConfig throws for any non-HTTP(S) URL in MONITOR_URLS (min 100 iterations)",
    () => {
      fc.assert(
        fc.property(nonHttpUrlArb, (badUrl) => {
          expect(() => {
            withEnv(
              { ...VALID_BASE_ENV, MONITOR_URLS: badUrl },
              () => validateConfig()
            );
          }).toThrow();
        }),
        { numRuns: 100 }
      );
    }
  );

  test(
    "validateConfig throws when one of multiple URLs is non-HTTP(S)",
    () => {
      // Generator: a valid URL followed by a bad URL in a comma-separated list
      const validUrlArb = fc.constantFrom(
        "http://example.com",
        "https://api.example.com/health",
        "http://localhost:3000"
      );

      fc.assert(
        fc.property(validUrlArb, nonHttpUrlArb, (goodUrl, badUrl) => {
          const mixed = `${goodUrl},${badUrl}`;
          expect(() => {
            withEnv(
              { ...VALID_BASE_ENV, MONITOR_URLS: mixed },
              () => validateConfig()
            );
          }).toThrow();
        }),
        { numRuns: 100 }
      );
    }
  );

  test(
    "error message identifies the invalid URL value",
    () => {
      fc.assert(
        fc.property(nonHttpUrlArb, (badUrl) => {
          let thrownError = null;
          try {
            withEnv(
              { ...VALID_BASE_ENV, MONITOR_URLS: badUrl },
              () => validateConfig()
            );
          } catch (err) {
            thrownError = err;
          }

          expect(thrownError).not.toBeNull();
          expect(thrownError).toBeInstanceOf(Error);
          // The error message should mention the malformed URL
          expect(thrownError.message).toMatch(/malformed/i);
        }),
        { numRuns: 100 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Property 6: Email format validation rejects invalid addresses
// **Validates: Requirements 7.7**
// ---------------------------------------------------------------------------

describe("Property 6: Email format validation rejects invalid addresses", () => {
  /**
   * Generator: arbitrary strings that do NOT match the valid email pattern.
   *
   * A valid email (per config.js isValidEmail) must:
   *   - Have '@' at index >= 1
   *   - Have at least one '.' after the '@'
   *
   * We generate invalid emails by producing strings that either:
   *   (a) contain no '@' at all, or
   *   (b) have '@' but no '.' after it
   */

  // (a) Strings with no '@' character
  const noAtSignArb = fc
    .string({ minLength: 1, maxLength: 100 })
    .filter((s) => s.trim().length > 0 && !s.includes("@"));

  // (b) Strings with '@' but no '.' after the '@'
  //     e.g. "user@nodot", "@nodot", "user@"
  const atButNoDotAfterArb = fc
    .tuple(
      fc.string({ minLength: 0, maxLength: 50 }), // local part (may be empty)
      fc.string({ minLength: 0, maxLength: 50 }).filter((s) => !s.includes(".")) // domain without dot
    )
    .map(([local, domain]) => `${local}@${domain}`)
    .filter((s) => s.trim().length > 0);

  // Combined generator: pick from either category
  const invalidEmailArb = fc.oneof(noAtSignArb, atButNoDotAfterArb);

  /** Valid base env with a known-good URL so only email is under test. */
  const VALID_BASE_FOR_EMAIL = {
    RESEND_API_KEY: "re_test_key_123",
    MONITOR_URLS: "https://example.com/health",
  };

  test(
    "validateConfig throws for any invalid ALERT_EMAIL_TO (min 100 iterations)",
    () => {
      fc.assert(
        fc.property(invalidEmailArb, (badEmail) => {
          expect(() => {
            withEnv(
              {
                ...VALID_BASE_FOR_EMAIL,
                ALERT_EMAIL_TO: badEmail,
                ALERT_EMAIL_FROM: "monitor@example.com",
              },
              () => validateConfig()
            );
          }).toThrow();
        }),
        { numRuns: 100 }
      );
    }
  );

  test(
    "validateConfig throws for any invalid ALERT_EMAIL_FROM (min 100 iterations)",
    () => {
      fc.assert(
        fc.property(invalidEmailArb, (badEmail) => {
          expect(() => {
            withEnv(
              {
                ...VALID_BASE_FOR_EMAIL,
                ALERT_EMAIL_TO: "alerts@example.com",
                ALERT_EMAIL_FROM: badEmail,
              },
              () => validateConfig()
            );
          }).toThrow();
        }),
        { numRuns: 100 }
      );
    }
  );
});

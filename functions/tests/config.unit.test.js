"use strict";

/**
 * Unit tests for validateConfig() in config.js
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
 */

const { validateConfig } = require("../src/config");

// ---------------------------------------------------------------------------
// Helper: run a function with a temporary process.env override, then restore.
// ---------------------------------------------------------------------------
function withEnv(vars, fn) {
  const saved = {};
  const keys = Object.keys(vars);

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
    for (const key of keys) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

/** A fully valid environment so individual variables can be overridden. */
const VALID_ENV = {
  RESEND_API_KEY: "re_test_key_123",
  ALERT_EMAIL_TO: "alerts@example.com",
  ALERT_EMAIL_FROM: "monitor@example.com",
  MONITOR_URLS: "https://example.com/health",
};

// ---------------------------------------------------------------------------
// RESEND_API_KEY validation  (Requirement 7.1, 7.4)
// ---------------------------------------------------------------------------

describe("RESEND_API_KEY validation", () => {
  test("throws when RESEND_API_KEY is absent", () => {
    expect(() => {
      withEnv({ ...VALID_ENV, RESEND_API_KEY: undefined }, () =>
        validateConfig()
      );
    }).toThrow(/RESEND_API_KEY/);
  });

  test("throws when RESEND_API_KEY is an empty string", () => {
    expect(() => {
      withEnv({ ...VALID_ENV, RESEND_API_KEY: "" }, () => validateConfig());
    }).toThrow(/RESEND_API_KEY/);
  });

  test("throws when RESEND_API_KEY is whitespace only", () => {
    expect(() => {
      withEnv({ ...VALID_ENV, RESEND_API_KEY: "   " }, () => validateConfig());
    }).toThrow(/RESEND_API_KEY/);
  });

  test("does not throw when RESEND_API_KEY is a non-empty string", () => {
    expect(() => {
      withEnv({ ...VALID_ENV, RESEND_API_KEY: "re_valid_key" }, () =>
        validateConfig()
      );
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ALERT_EMAIL_TO validation  (Requirement 7.2, 7.4, 7.7)
// ---------------------------------------------------------------------------

describe("ALERT_EMAIL_TO validation", () => {
  test("throws when ALERT_EMAIL_TO is absent", () => {
    expect(() => {
      withEnv({ ...VALID_ENV, ALERT_EMAIL_TO: undefined }, () =>
        validateConfig()
      );
    }).toThrow(/ALERT_EMAIL_TO/);
  });

  test("throws when ALERT_EMAIL_TO is an empty string", () => {
    expect(() => {
      withEnv({ ...VALID_ENV, ALERT_EMAIL_TO: "" }, () => validateConfig());
    }).toThrow(/ALERT_EMAIL_TO/);
  });

  test("throws when ALERT_EMAIL_TO has no '@' sign", () => {
    expect(() => {
      withEnv({ ...VALID_ENV, ALERT_EMAIL_TO: "notanemail" }, () =>
        validateConfig()
      );
    }).toThrow(/ALERT_EMAIL_TO/);
  });

  test("throws when ALERT_EMAIL_TO has '@' but no '.' in domain", () => {
    expect(() => {
      withEnv({ ...VALID_ENV, ALERT_EMAIL_TO: "user@nodot" }, () =>
        validateConfig()
      );
    }).toThrow(/ALERT_EMAIL_TO/);
  });

  test("throws when ALERT_EMAIL_TO starts with '@'", () => {
    expect(() => {
      withEnv({ ...VALID_ENV, ALERT_EMAIL_TO: "@example.com" }, () =>
        validateConfig()
      );
    }).toThrow(/ALERT_EMAIL_TO/);
  });

  test("does not throw for a valid ALERT_EMAIL_TO", () => {
    expect(() => {
      withEnv({ ...VALID_ENV, ALERT_EMAIL_TO: "user@domain.com" }, () =>
        validateConfig()
      );
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ALERT_EMAIL_FROM validation  (Requirement 7.3, 7.4, 7.7)
// ---------------------------------------------------------------------------

describe("ALERT_EMAIL_FROM validation", () => {
  test("throws when ALERT_EMAIL_FROM is absent", () => {
    expect(() => {
      withEnv({ ...VALID_ENV, ALERT_EMAIL_FROM: undefined }, () =>
        validateConfig()
      );
    }).toThrow(/ALERT_EMAIL_FROM/);
  });

  test("throws when ALERT_EMAIL_FROM is an empty string", () => {
    expect(() => {
      withEnv({ ...VALID_ENV, ALERT_EMAIL_FROM: "" }, () => validateConfig());
    }).toThrow(/ALERT_EMAIL_FROM/);
  });

  test("throws when ALERT_EMAIL_FROM has no '@' sign", () => {
    expect(() => {
      withEnv({ ...VALID_ENV, ALERT_EMAIL_FROM: "notanemail" }, () =>
        validateConfig()
      );
    }).toThrow(/ALERT_EMAIL_FROM/);
  });

  test("throws when ALERT_EMAIL_FROM has '@' but no '.' in domain", () => {
    expect(() => {
      withEnv({ ...VALID_ENV, ALERT_EMAIL_FROM: "sender@nodot" }, () =>
        validateConfig()
      );
    }).toThrow(/ALERT_EMAIL_FROM/);
  });

  test("throws when ALERT_EMAIL_FROM starts with '@'", () => {
    expect(() => {
      withEnv({ ...VALID_ENV, ALERT_EMAIL_FROM: "@example.com" }, () =>
        validateConfig()
      );
    }).toThrow(/ALERT_EMAIL_FROM/);
  });

  test("does not throw for a valid ALERT_EMAIL_FROM", () => {
    expect(() => {
      withEnv({ ...VALID_ENV, ALERT_EMAIL_FROM: "sender@domain.org" }, () =>
        validateConfig()
      );
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// MONITOR_URLS — default fallback  (Requirement 7.6)
// ---------------------------------------------------------------------------

describe("MONITOR_URLS default fallback", () => {
  const DEFAULT_URL = "https://apineuronv2.monkhub.com/user/login";

  test("falls back to default URL when MONITOR_URLS is absent", () => {
    const config = withEnv({ ...VALID_ENV, MONITOR_URLS: undefined }, () =>
      validateConfig()
    );
    expect(config.monitorUrls).toEqual([DEFAULT_URL]);
  });

  test("falls back to default URL when MONITOR_URLS is an empty string", () => {
    const config = withEnv({ ...VALID_ENV, MONITOR_URLS: "" }, () =>
      validateConfig()
    );
    expect(config.monitorUrls).toEqual([DEFAULT_URL]);
  });

  test("falls back to default URL when MONITOR_URLS is whitespace only", () => {
    const config = withEnv({ ...VALID_ENV, MONITOR_URLS: "   " }, () =>
      validateConfig()
    );
    expect(config.monitorUrls).toEqual([DEFAULT_URL]);
  });
});

// ---------------------------------------------------------------------------
// MONITOR_URLS — parsing and trimming  (Requirement 7.6)
// ---------------------------------------------------------------------------

describe("MONITOR_URLS parsing and trimming", () => {
  test("parses a single URL", () => {
    const config = withEnv(
      { ...VALID_ENV, MONITOR_URLS: "https://api.example.com/health" },
      () => validateConfig()
    );
    expect(config.monitorUrls).toEqual(["https://api.example.com/health"]);
  });

  test("parses multiple comma-separated URLs", () => {
    const config = withEnv(
      {
        ...VALID_ENV,
        MONITOR_URLS:
          "https://api.example.com/health,http://other.example.com/ping",
      },
      () => validateConfig()
    );
    expect(config.monitorUrls).toEqual([
      "https://api.example.com/health",
      "http://other.example.com/ping",
    ]);
  });

  test("trims whitespace around each URL", () => {
    const config = withEnv(
      {
        ...VALID_ENV,
        MONITOR_URLS:
          "  https://api.example.com/health  ,  http://other.example.com/ping  ",
      },
      () => validateConfig()
    );
    expect(config.monitorUrls).toEqual([
      "https://api.example.com/health",
      "http://other.example.com/ping",
    ]);
  });

  test("ignores empty segments between commas", () => {
    const config = withEnv(
      {
        ...VALID_ENV,
        MONITOR_URLS: "https://api.example.com/health,,https://b.example.com",
      },
      () => validateConfig()
    );
    expect(config.monitorUrls).toEqual([
      "https://api.example.com/health",
      "https://b.example.com",
    ]);
  });

  test("returns the config object with correct shape on success", () => {
    const config = withEnv({ ...VALID_ENV }, () => validateConfig());
    expect(config).toMatchObject({
      resendApiKey: expect.any(String),
      alertEmailTo: expect.any(String),
      alertEmailFrom: expect.any(String),
      monitorUrls: expect.any(Array),
    });
  });
});

// ---------------------------------------------------------------------------
// MONITOR_URLS — URL scheme validation  (Requirement 7.7)
// ---------------------------------------------------------------------------

describe("MONITOR_URLS URL scheme validation", () => {
  test("throws for a URL starting with ftp://", () => {
    expect(() => {
      withEnv({ ...VALID_ENV, MONITOR_URLS: "ftp://example.com" }, () =>
        validateConfig()
      );
    }).toThrow();
  });

  test("throws for a URL with no scheme", () => {
    expect(() => {
      withEnv({ ...VALID_ENV, MONITOR_URLS: "example.com/health" }, () =>
        validateConfig()
      );
    }).toThrow();
  });

  test("throws for a URL starting with ws://", () => {
    expect(() => {
      withEnv({ ...VALID_ENV, MONITOR_URLS: "ws://example.com/socket" }, () =>
        validateConfig()
      );
    }).toThrow();
  });

  test("throws when one URL in a list is invalid", () => {
    expect(() => {
      withEnv(
        {
          ...VALID_ENV,
          MONITOR_URLS:
            "https://valid.example.com,ftp://invalid.example.com",
        },
        () => validateConfig()
      );
    }).toThrow();
  });

  test("error message mentions 'malformed' for invalid URL scheme", () => {
    expect(() => {
      withEnv({ ...VALID_ENV, MONITOR_URLS: "not-a-url" }, () =>
        validateConfig()
      );
    }).toThrow(/malformed/i);
  });

  test("accepts http:// URLs", () => {
    expect(() => {
      withEnv(
        { ...VALID_ENV, MONITOR_URLS: "http://example.com/health" },
        () => validateConfig()
      );
    }).not.toThrow();
  });

  test("accepts https:// URLs", () => {
    expect(() => {
      withEnv(
        { ...VALID_ENV, MONITOR_URLS: "https://example.com/health" },
        () => validateConfig()
      );
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// MONITOR_URLS — max 50 URLs limit  (Requirement 7.6)
// ---------------------------------------------------------------------------

describe("MONITOR_URLS maximum URL count", () => {
  function buildUrlList(count) {
    return Array.from(
      { length: count },
      (_, i) => `https://endpoint-${i + 1}.example.com`
    ).join(",");
  }

  test("accepts exactly 50 URLs", () => {
    expect(() => {
      withEnv({ ...VALID_ENV, MONITOR_URLS: buildUrlList(50) }, () =>
        validateConfig()
      );
    }).not.toThrow();
  });

  test("throws for 51 URLs", () => {
    expect(() => {
      withEnv({ ...VALID_ENV, MONITOR_URLS: buildUrlList(51) }, () =>
        validateConfig()
      );
    }).toThrow();
  });

  test("throws for 100 URLs", () => {
    expect(() => {
      withEnv({ ...VALID_ENV, MONITOR_URLS: buildUrlList(100) }, () =>
        validateConfig()
      );
    }).toThrow();
  });

  test("error message mentions the maximum limit when exceeded", () => {
    expect(() => {
      withEnv({ ...VALID_ENV, MONITOR_URLS: buildUrlList(51) }, () =>
        validateConfig()
      );
    }).toThrow(/50/);
  });
});

// ---------------------------------------------------------------------------
// Error aggregation — multiple invalid fields at once  (Requirement 7.4)
// ---------------------------------------------------------------------------

describe("Error aggregation", () => {
  test("throws a single error listing all missing required variables", () => {
    let thrownError = null;
    try {
      withEnv(
        {
          RESEND_API_KEY: undefined,
          ALERT_EMAIL_TO: undefined,
          ALERT_EMAIL_FROM: undefined,
          MONITOR_URLS: "https://example.com",
        },
        () => validateConfig()
      );
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).not.toBeNull();
    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError.message).toMatch(/RESEND_API_KEY/);
    expect(thrownError.message).toMatch(/ALERT_EMAIL_TO/);
    expect(thrownError.message).toMatch(/ALERT_EMAIL_FROM/);
  });
});

# Firebase API Monitor

A Firebase Cloud Functions v2 scheduled health monitor that checks configured API endpoints every 5 minutes, persists state in Firestore, and sends alert/recovery emails via Resend.

---

## Prerequisites

Before deploying, make sure you have the following installed and configured:

1. **Node.js 18** — required by the Cloud Functions runtime.
   ```bash
   node --version   # should print v18.x.x
   ```

2. **Firebase CLI** — used to deploy functions and manage the project.
   ```bash
   npm install -g firebase-tools
   firebase --version   # should print 13.x or later
   ```

3. **A Firebase project** — create one at [console.firebase.google.com](https://console.firebase.google.com) if you don't have one yet.

4. **Firestore enabled** — in the Firebase console, navigate to **Build → Firestore Database** and create a database (Native mode recommended).

5. **A Resend account** — sign up at [resend.com](https://resend.com) and verify a sending domain. You will need an API key and a verified sender address.

6. **Billing enabled on your Firebase project** — Cloud Functions v2 requires the Blaze (pay-as-you-go) plan. Upgrade in the Firebase console under **Project Settings → Usage and billing**.

---

## Environment Variable Setup

All sensitive credentials are managed via environment variables. Never commit real values to source control.

1. Copy the example file into the `functions/` directory:
   ```bash
   cp functions/.env.example functions/.env
   ```

2. Open `functions/.env` and fill in each variable:

   | Variable | Required | Description |
   |---|---|---|
   | `RESEND_API_KEY` | Yes | Your Resend API key. Obtain from [resend.com/api-keys](https://resend.com/api-keys). |
   | `ALERT_EMAIL_TO` | Yes | Recipient email address for alert and recovery notifications (e.g. `ops@yourcompany.com`). |
   | `ALERT_EMAIL_FROM` | Yes | Sender email address — must be a verified domain in Resend (e.g. `alerts@yourverifieddomain.com`). |
   | `MONITOR_URLS` | No | Comma-separated list of URLs to monitor (max 50). Each must start with `http://` or `https://`. Falls back to `https://apineuronv2.monkhub.com/user/login` if omitted. |
   | `FIREBASE_PROJECT_ID` | No | Your Firebase project ID. Used by the Admin SDK if not auto-detected. |

   Example `functions/.env`:
   ```dotenv
   RESEND_API_KEY=re_abc123xyz
   ALERT_EMAIL_TO=ops-team@yourcompany.com
   ALERT_EMAIL_FROM=alerts@yourverifieddomain.com
   MONITOR_URLS=https://api.example.com/health,https://api2.example.com/status
   FIREBASE_PROJECT_ID=your-firebase-project-id
   ```

3. Verify the format rules before deploying:
   - `ALERT_EMAIL_TO` and `ALERT_EMAIL_FROM` must contain `@` followed by a domain with at least one `.`.
   - Each URL in `MONITOR_URLS` must start with `http://` or `https://`.
   - The list in `MONITOR_URLS` must not exceed 50 entries.

---

## Firebase Project Setup

1. Log in to the Firebase CLI:
   ```bash
   firebase login
   ```

2. Link the local project to your Firebase project:
   ```bash
   firebase use --add
   ```
   When prompted, select your project from the list and assign it the alias `default`.

   Alternatively, edit `.firebaserc` directly:
   ```json
   {
     "projects": {
       "default": "your-firebase-project-id"
     }
   }
   ```

3. Enable the required Google Cloud APIs for your project (these are needed by Cloud Functions v2 and Cloud Scheduler):
   - Cloud Functions API
   - Cloud Scheduler API
   - Cloud Build API

   You can enable them from the [Google Cloud Console APIs & Services page](https://console.cloud.google.com/apis/library) or via the gcloud CLI:
   ```bash
   gcloud services enable cloudfunctions.googleapis.com cloudscheduler.googleapis.com cloudbuild.googleapis.com --project your-firebase-project-id
   ```

4. Install function dependencies:
   ```bash
   cd functions
   npm install
   cd ..
   ```

5. Confirm Firestore is initialized in your project by visiting **Build → Firestore Database** in the Firebase console. The `endpoint_status` collection will be created automatically on the first function invocation.

---

## Deployment Steps

1. Make sure you are in the project root (the directory containing `firebase.json`):
   ```bash
   ls firebase.json   # should exist
   ```

2. Deploy the Cloud Function:
   ```bash
   firebase deploy --only functions
   ```

   This command:
   - Packages the `functions/` directory
   - Uploads and builds the function on Google Cloud
   - Creates or updates the Cloud Scheduler job to trigger the function every 5 minutes

3. Verify the deployment in the Firebase console:
   - Navigate to **Build → Functions** and confirm `apiHealthMonitor` appears with status **Enabled**.
   - Navigate to **Build → Scheduler** (or the Google Cloud Scheduler console) and confirm the job is active.

4. Set environment variables for the deployed function using the Firebase CLI:
   ```bash
   firebase functions:secrets:set RESEND_API_KEY
   ```
   Enter the value when prompted. Repeat for each required variable, or use the `.env` file approach — Firebase Functions v2 automatically picks up `functions/.env` during deployment.

   > **Note:** The `functions/.env` file is deployed alongside your function code. Do not commit it to source control. Add `functions/.env` to your `.gitignore`.

5. Trigger a manual test invocation from the Google Cloud Console:
   - Go to **Cloud Scheduler**, find the `apiHealthMonitor` job, and click **Force run**.
   - Check **Cloud Logging** (Logs Explorer) for log entries from `apiHealthMonitor` to confirm the function ran successfully.

---

## Local Testing

### Running Unit and Property-Based Tests

All tests are located in `functions/tests/` and use Jest with fast-check for property-based testing.

1. Install dependencies (if not already done):
   ```bash
   cd functions
   npm install
   ```

2. Run the full test suite:
   ```bash
   npm test
   ```

3. Run tests with coverage report:
   ```bash
   npm run test:coverage
   ```

### Running the Function Locally with the Firebase Emulator

The Firebase Emulator Suite lets you run Cloud Functions and Firestore locally without deploying.

1. Install the emulators (one-time setup):
   ```bash
   firebase setup:emulators:firestore
   firebase setup:emulators:functions
   ```

2. Create a local environment file for the emulator (if not already done):
   ```bash
   cp functions/.env.example functions/.env
   # Edit functions/.env with real or test values
   ```

3. Start the emulators:
   ```bash
   firebase emulators:start --only functions,firestore
   ```

4. The emulator UI is available at `http://localhost:4000`. You can inspect Firestore documents and function logs there.

5. Trigger the scheduled function manually via the emulator shell or by sending an HTTP request to the emulated function endpoint shown in the emulator output:
   ```bash
   curl -X POST http://127.0.0.1:5001/your-firebase-project-id/us-central1/apiHealthMonitor
   ```

6. Check the emulator terminal output for structured log entries confirming health check results, Firestore writes, and any email send attempts.

7. Stop the emulators when done:
   ```bash
   # Press Ctrl+C in the terminal running the emulators
   ```

### Validating Environment Variables Locally

To confirm your `.env` values pass validation before deploying:

```bash
cd functions
node -e "require('./src/config.js').validateConfig(); console.log('Config is valid');"
```

If any variable is missing or malformed, the script will print a descriptive error listing each invalid value.

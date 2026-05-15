# Super Neuron API Health Monitor

A Vercel-hosted cron job that checks the Super Neuron API endpoint daily at 9 AM IST and sends alert emails via EmailJS when the endpoint is down.

## How It Works

- **Vercel Cron** triggers `GET /api/monitor` at 9:00 AM IST (3:30 AM UTC) every day
- The function calls the configured API with an `X-Custom-Token` header
- If the API returns a non-2xx response or times out, an alert email is sent via EmailJS
- If the API is healthy, no email is sent

## Project Structure

```
├── api/monitor.js      # Vercel serverless function (cron target)
├── monitor.js          # Standalone script for local/CI testing
├── public/index.html   # Landing page
├── vercel.json         # Vercel cron configuration
├── package.json        # Dependencies
└── .github/workflows/monitor.yml  # GitHub Actions backup cron
```

## Environment Variables

Set these in Vercel (Settings → Environment Variables) and GitHub Secrets:

| Variable | Description |
|---|---|
| `EMAILJS_SERVICE_ID` | EmailJS service ID |
| `EMAILJS_TEMPLATE_ID` | EmailJS template ID |
| `EMAILJS_PUBLIC_KEY` | EmailJS public key |
| `API_TOKEN` | X-Custom-Token value for API auth |

## Local Testing

```bash
# Install dependencies
npm install

# Add your credentials to .env (see .env format below)
# EMAILJS_SERVICE_ID=service_xxx
# EMAILJS_TEMPLATE_ID=template_xxx
# EMAILJS_PUBLIC_KEY=xxx
# API_TOKEN=your_jwt_token

# Run the monitor
node monitor.js
```

## Deployment

Push to `main` — Vercel auto-deploys. The cron job runs daily at 9 AM IST.

## EmailJS Template Variables

Your EmailJS template should use: `{{endpoint_url}}`, `{{error_reason}}`, `{{detected_at}}`, `{{status}}`

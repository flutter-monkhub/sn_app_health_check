const axios = require("axios");
const { Resend } = require("resend");

const APIS = [
  "https://apineuronv2.monkhub.com/user/login",
];

async function checkApis() {
  for (const url of APIS) {
    try {
      const res = await axios.get(url, { timeout: 5000 });

      if (res.status >= 200 && res.status < 300) {
        console.log(`OK: ${url}`);
      } else {
        console.log(`FAIL: ${url} -> ${res.status}`);
        await sendAlert(url, `HTTP ${res.status}`);
      }
    } catch (err) {
      console.log(`DOWN: ${url} -> ${err.message}`);
      await sendAlert(url, err.message);
    }
  }
}

async function sendAlert(url, error) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL_TO;
  const from = process.env.ALERT_EMAIL_FROM;

  if (!apiKey || !to || !from) {
    console.error("Missing email env vars: RESEND_API_KEY, ALERT_EMAIL_TO, ALERT_EMAIL_FROM");
    return;
  }

  const resend = new Resend(apiKey);
  const timestamp = new Date().toISOString();

  try {
    const { error: sendError } = await resend.emails.send({
      from,
      to,
      subject: `[ALERT] API endpoint down: ${url}`,
      text: `Endpoint: ${url}\nStatus: UNHEALTHY\nReason: ${error}\nDetected at: ${timestamp}`,
    });

    if (sendError) {
      console.error("Failed to send alert email:", sendError);
    } else {
      console.log(`Alert email sent for ${url}`);
    }
  } catch (err) {
    console.error("Error sending alert email:", err.message);
  }
}

checkApis();

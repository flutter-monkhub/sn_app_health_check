const axios = require("axios");

const APIS = [
  "https://apineuronv2.monkhub.com/user/getStreakAndStoryBlogs",
];

async function checkApis() {
  for (const url of APIS) {
    try {
      const res = await axios.get(url, {
        headers: {
          "X-Custom-Token": process.env.API_TOKEN,
          "Cookie": process.env.API_COOKIE || "",
        },
        timeout: 5000,
      });

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
  const serviceId  = process.env.EMAILJS_SERVICE_ID;
  const templateId = process.env.EMAILJS_TEMPLATE_ID;
  const publicKey  = process.env.EMAILJS_PUBLIC_KEY;

  if (!serviceId || !templateId || !publicKey) {
    console.error(
      "Missing EmailJS env vars: EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY"
    );
    return;
  }

  const timestamp = new Date().toISOString();

  try {
    const response = await axios.post(
      "https://api.emailjs.com/api/v1.0/email/send",
      {
        service_id:  serviceId,
        template_id: templateId,
        user_id:     publicKey,
        template_params: {
          endpoint_url: url,
          error_reason: error,
          detected_at:  timestamp,
          status:       "UNHEALTHY",
        },
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 10000,
      }
    );

    if (response.status === 200) {
      console.log(`Alert email sent for ${url}`);
    } else {
      console.error(`EmailJS returned unexpected status ${response.status} for ${url}`);
    }
  } catch (err) {
    const detail = err.response ? JSON.stringify(err.response.data) : err.message;
    console.error(`Failed to send alert email for ${url}:`, detail);
  }
}

checkApis();

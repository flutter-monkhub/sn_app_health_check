const axios = require("axios");

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
        await sendAlert(url, res.status);
      }
    } catch (err) {
      console.log(`DOWN: ${url}`);
      await sendAlert(url, err.message);
    }
  }
}

async function sendAlert(url, error) {
  console.log("ALERT:", url, error);

  // Resend email alert
  // const { Resend } = require("resend");
  // const resend = new Resend(process.env.RESEND_API_KEY);
  // await resend.emails.send({
  //   from: process.env.ALERT_EMAIL_FROM,
  //   to: process.env.ALERT_EMAIL_TO,
  //   subject: `[ALERT] API endpoint down: ${url}`,
  //   text: `Endpoint: ${url}\nError: ${error}\nDetected at: ${new Date().toISOString()}`,
  // });
}

checkApis();

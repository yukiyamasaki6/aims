const MAILPIT_URL = "http://127.0.0.1:54324";

export async function getOtpCodeFromMailpit(email: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const listRes = await fetch(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    const list = await listRes.json();
    const found = list.messages?.[0];

    if (found) {
      const detailRes = await fetch(
        `${MAILPIT_URL}/api/v1/message/${found.ID}`,
      );
      const detail = await detailRes.json();
      const match = /(\d{6})/.exec(detail.HTML);

      if (match) {
        return match[1];
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`OTP code email not found for ${email}`);
}

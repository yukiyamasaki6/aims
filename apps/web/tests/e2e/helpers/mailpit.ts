import { expect } from "@playwright/test";

const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";
type Message = { id: string };
async function messages(email: string, subject?: string): Promise<Message[]> {
  const query = `to:${email}${subject ? ` subject:"${subject}"` : ""}`;
  const response = await fetch(
    `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(query)}`,
  );
  if (!response.ok) throw new Error("Mailpit search failed");
  return ((await response.json()).messages ?? []).map(
    (message: Record<string, string>) => ({ id: message.ID }),
  );
}
export async function mailIds(email: string): Promise<string[]> {
  return (await messages(email)).map(({ id }) => id);
}
export async function getEmailFromMailpit(
  email: string,
  subject?: string,
  previous: readonly string[] = [],
): Promise<{ subject: string; html: string }> {
  let found: Message | undefined;
  await expect
    .poll(
      async () => {
        found = (await messages(email, subject)).find(
          ({ id }) => !previous.includes(id),
        );
        return Boolean(found);
      },
      { timeout: 15000, message: "新着メールが到着する" },
    )
    .toBe(true);
  const response = await fetch(`${MAILPIT_URL}/api/v1/message/${found?.id}`);
  const detail = await response.json();
  return { subject: detail.Subject, html: detail.HTML };
}
export async function getOtpCodeFromMailpit(
  email: string,
  previous: readonly string[] = [],
): Promise<string> {
  const { html } = await getEmailFromMailpit(email, undefined, previous);
  // 宛先に連続した数字があってもコードと取り違えない。
  const match = /(?:^|>)\s*(\d{6})\s*(?:<|$)/m.exec(html);
  if (!match) throw new Error("OTP code missing from email body");
  return match[1];
}

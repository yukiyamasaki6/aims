import { createServer } from "node:http";

// 履歴パネルのブラウザ結合専用。DBも実際の認証サービスも使わない。
const user = {
  id: "11111111-1111-4111-8111-111111111111",
  aud: "authenticated",
  role: "authenticated",
  email: "history-panel@example.test",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};
createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Content-Type", "application/json");
  if (request.method === "OPTIONS") return response.end();
  if (request.url === "/auth/v1/user")
    return response.end(JSON.stringify(user));
  if (request.url === "/health") return response.end("{}");
  // 未設定の境界を成功扱いにしない。
  response.statusCode = 501;
  response.end(
    JSON.stringify({ message: `Unconfigured boundary: ${request.url}` }),
  );
}).listen(54329, "127.0.0.1");

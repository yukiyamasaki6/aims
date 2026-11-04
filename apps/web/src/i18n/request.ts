import { getRequestConfig } from "next-intl/server";
import { intlConfig } from "./messages";

// ロケールは固定で、headers()とcookies()を読まない(ページを静的に保つ)。
export default getRequestConfig(async () => intlConfig);

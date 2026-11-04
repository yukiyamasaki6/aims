import type { MetadataRoute } from "next";
import { createTranslator } from "next-intl";
import { ROUNDS_PATH } from "@/features/rounds/domain/round-routes";
import { intlConfig } from "@/i18n/messages";

export default function manifest(): MetadataRoute.Manifest {
  const t = createTranslator({ ...intlConfig, namespace: "shared" });
  return {
    name: t("appName"),
    short_name: t("appName"),
    description: t("appDescription"),
    start_url: ROUNDS_PATH,
    display: "standalone",
    background_color: "#FFFFFF",
    theme_color: "#FFFFFF",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-192-maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

import type { MetadataRoute } from "next";
import { APP_DESCRIPTION } from "./pwa-constants";

const ICON_SIZES = [192, 384, 512, 1024] as const;
const ICON_PURPOSES = ["any", "maskable"] as const;

export default function manifest(): MetadataRoute.Manifest {
  return {
    // 識別子を明示し、インストール済みのアプリが別のアプリとして扱われないようにする。
    id: "/rounds",
    name: "AIMS",
    short_name: "AIMS",
    description: APP_DESCRIPTION,
    start_url: "/rounds",
    scope: "/",
    display: "standalone",
    // 横向きの側パネルがあるため、端末の回転の固定に従う。
    orientation: "any",
    lang: "ja",
    dir: "ltr",
    categories: ["sports"],
    launch_handler: { client_mode: "focus-existing" },
    background_color: "#FFFFFF",
    theme_color: "#FFFFFF",
    icons: ICON_SIZES.flatMap((size) =>
      ICON_PURPOSES.map((purpose) => ({
        src:
          purpose === "any"
            ? `/icons/icon-${size}.png`
            : `/icons/icon-${size}-maskable.png`,
        sizes: `${size}x${size}`,
        type: "image/png",
        purpose,
      })),
    ),
  };
}

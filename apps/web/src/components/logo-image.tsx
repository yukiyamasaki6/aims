import Image from "next/image";
import { useTranslations } from "next-intl";

// public/logo.svgのviewBoxの比で、高さ24pxのときの幅。ロゴを作り直して比が変わったら合わせる。
const LOGO_WIDTH = 87;
const DEFAULT_HEIGHT = 24;

// height: 表示する高さ(px)。幅は縦横比に応じる。
export function LogoImage({ height = DEFAULT_HEIGHT }: { height?: number }) {
  const t = useTranslations("shared");
  return (
    <Image
      src="/logo.svg"
      alt={t("logoAlt")}
      width={Math.round((LOGO_WIDTH * height) / DEFAULT_HEIGHT)}
      height={height}
      style={{ height }}
      className="block w-auto"
    />
  );
}

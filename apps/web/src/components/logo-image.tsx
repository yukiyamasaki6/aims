import Image from "next/image";

// public/logo.svgのviewBoxの比で、高さ24pxのときの幅。ロゴを作り直して比が変わったら合わせる。
const LOGO_WIDTH = 87;

export function LogoImage() {
  return (
    <Image
      src="/logo.svg"
      alt="AIMS"
      width={LOGO_WIDTH}
      height={24}
      unoptimized
      className="block h-6 w-auto"
    />
  );
}

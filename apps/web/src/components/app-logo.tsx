import Link from "next/link";
import { LogoImage } from "@/components/logo-image";
import { HOME_PATH } from "@/routes";

export function AppLogo() {
  return (
    <Link href={HOME_PATH} className="fixed top-4 left-4">
      <LogoImage />
    </Link>
  );
}

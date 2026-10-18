import Link from "next/link";
import { LogoImage } from "@/components/logo-image";

export function AppLogo() {
  return (
    <Link href="/" className="fixed top-4 left-4">
      <LogoImage />
    </Link>
  );
}

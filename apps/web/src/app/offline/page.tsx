import { AuthCard } from "@/components/auth-card";

export default function OfflinePage() {
  return (
    <AuthCard
      title="オフラインです"
      description="インターネットに接続されていません。接続を確認してから、もう一度お試しください。"
    >
      {null}
    </AuthCard>
  );
}

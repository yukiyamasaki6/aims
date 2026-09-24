export default function OfflinePage() {
  return (
    <main className="mx-auto flex h-dvh w-full max-w-sm flex-col items-center justify-center gap-4 overflow-y-auto p-8">
      <div className="flex flex-col gap-1 text-center">
        <h1 className="font-heading text-2xl leading-snug font-medium">
          オフラインです
        </h1>
        <p className="text-sm text-muted-foreground">
          インターネットに接続されていません。接続を確認してから、もう一度お試しください。
        </p>
      </div>
    </main>
  );
}

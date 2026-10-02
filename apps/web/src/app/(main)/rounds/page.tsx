import { RoundsListClient } from "./rounds-list-client";

export default function RoundsPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-8">
      <h1 className="font-heading text-2xl leading-snug font-medium">
        ラウンド一覧
      </h1>

      <RoundsListClient />
    </main>
  );
}

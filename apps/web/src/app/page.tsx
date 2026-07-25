import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-24">
      <div className="flex items-center gap-2">
        <h1 className="text-3xl font-bold">AIMS Frontend</h1>
        <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800 dark:bg-blue-900 dark:text-blue-300">
          Vercel Preview Test
        </span>
      </div>
      <p className="text-muted-foreground text-sm">
        Deployment pipeline verification in progress.
      </p>
      <Button>shadcn/ui Button Test</Button>
    </main>
  );
}

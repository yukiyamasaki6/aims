#!/usr/bin/env node
// Sets up local dev environment files (see CONTRIBUTING.md "Setup").
// Safe to re-run — existing files are left untouched. Useful after a fresh
// clone or a new git worktree, where these gitignored files aren't present
// yet.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const rootDir = path.join(import.meta.dirname, "..");

function ensureRootEnv() {
  const target = path.join(rootDir, ".env");
  if (existsSync(target)) {
    console.log(".env already exists, skipping.");
    return;
  }
  const template = readFileSync(path.join(rootDir, ".env.example"), "utf-8");
  writeFileSync(target, template);
  console.log("Wrote .env");
}

function ensureWebEnvLocal() {
  const target = path.join(rootDir, "apps/web/.env.local");
  if (existsSync(target)) {
    console.log("apps/web/.env.local already exists, skipping.");
    return;
  }

  // `supabase start` must run after `.env` is written above: config.toml's
  // env(TURNSTILE_SECRET_KEY) substitution is only picked up when the
  // container is (re)created. Safe to call even if already running.
  execSync("pnpm exec supabase start", { cwd: rootDir, stdio: "inherit" });

  const statusOutput = execSync("pnpm exec supabase status -o json", {
    cwd: rootDir,
    encoding: "utf-8",
  });
  const jsonStart = statusOutput.indexOf("{");
  const jsonEnd = statusOutput.lastIndexOf("}");
  const status = JSON.parse(statusOutput.slice(jsonStart, jsonEnd + 1));

  const template = readFileSync(
    path.join(rootDir, "apps/web/.env.example"),
    "utf-8",
  );
  const filled = template
    .replace(
      /NEXT_PUBLIC_SUPABASE_URL=".*"/,
      `NEXT_PUBLIC_SUPABASE_URL="${status.API_URL}"`,
    )
    .replace(
      /NEXT_PUBLIC_SUPABASE_ANON_KEY=".*"/,
      `NEXT_PUBLIC_SUPABASE_ANON_KEY="${status.PUBLISHABLE_KEY}"`,
    )
    .replace(
      /SUPABASE_SECRET_KEY=".*"/,
      `SUPABASE_SECRET_KEY="${status.SECRET_KEY}"`,
    );

  writeFileSync(target, filled);
  console.log("Wrote apps/web/.env.local");
}

ensureRootEnv();
ensureWebEnvLocal();

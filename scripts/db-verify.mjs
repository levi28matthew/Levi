#!/usr/bin/env node
/**
 * Applies every migration to a throwaway PostgreSQL database and runs the engine
 * assertions against it. This is how the SQL layer is verified — the migrations are
 * never trusted just because they were written.
 *
 *   npm run db:test
 *
 * Requires Docker and the `postgres:17-alpine` image (pulled automatically). The
 * container is removed afterwards; no project data is touched and no Supabase
 * credentials are read.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const container = `levi-os-db-verify-${process.pid}`;
const image = process.env.LEVI_TEST_PG_IMAGE ?? "postgres:17-alpine";
const password = "levi_local_test_only";
const db = "postgres";

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function docker(args, options = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  return result;
}

/** Runs one SQL file through psql inside the container, stopping at the first error. */
function psqlFile(file) {
  const sql = readFileSync(file, "utf8");
  const result = docker(
    ["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-U", "postgres", "-d", db, "-f", "-"],
    { input: sql },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`Failed while applying ${file}`);
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

async function waitForPostgres() {
  for (let attempt = 1; attempt <= 90; attempt += 1) {
    if (docker(["exec", container, "pg_isready", "-U", "postgres", "-q"]).status === 0) {
      // Accept a connection end to end before handing over to psql.
      if (docker(["exec", container, "psql", "-U", "postgres", "-d", db, "-tAc", "select 1"]).status === 0) return;
    }
    await sleep(500);
  }
  throw new Error("PostgreSQL did not become ready in time");
}

async function main() {
  if (docker(["version", "--format", "{{.Server.Version}}"]).status !== 0) {
    console.error("Docker is not available. Install Docker, or run this check in CI, to verify the migrations.");
    process.exit(2);
  }

  const migrationsDir = join(root, "supabase", "migrations");
  const migrations = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
  if (migrations.length === 0) throw new Error("No migrations found in supabase/migrations");

  const testsDir = join(root, "supabase", "tests");
  const bootstrapName = "00_bootstrap.sql";
  const tests = readdirSync(testsDir).filter((name) => name !== bootstrapName && name.endsWith(".sql")).sort();
  if (tests.length === 0) throw new Error("No SQL test files found in supabase/tests");

  docker(["rm", "-f", container]);
  const start = docker([
    "run", "-d", "--name", container,
    "-e", `POSTGRES_PASSWORD=${password}`,
    "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
    "--tmpfs", "/var/lib/postgresql/data",
    image,
  ]);
  if (start.status !== 0) {
    process.stderr.write(start.stderr ?? "");
    throw new Error(`Could not start a ${image} container`);
  }

  try {
    await waitForPostgres();
    console.log(`\nPostgreSQL ${image} ready (${container})\n`);

    psqlFile(join(testsDir, bootstrapName));
    console.log(`  applied  supabase/tests/${bootstrapName}`);
    for (const name of migrations) {
      psqlFile(join(migrationsDir, name));
      console.log(`  applied  supabase/migrations/${name}`);
    }

    let assertions = 0;
    for (const name of tests) {
      const output = psqlFile(join(testsDir, name));
      const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const results = lines.filter((line) => line.includes("ok -"));
      assertions += results.length;
      console.log(`\n  ran      supabase/tests/${name} — ${results.length} assertions`);
      for (const line of results) console.log(`    \u2713 ${line.split("ok -")[1].trim()}`);
      for (const line of lines.filter((l) => l.includes("NOTICE:") && !l.includes("ok -"))) {
        console.log(`    ${line}`);
      }
    }

    console.log(`\nDatabase verification passed: ${migrations.length} migrations applied, ${assertions} assertions held.\n`);
  } finally {
    docker(["rm", "-f", container]);
  }
}

main().catch((error) => {
  console.error(`\nDatabase verification FAILED: ${error.message}\n`);
  process.exit(1);
});

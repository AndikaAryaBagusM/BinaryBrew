import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { jobEnv, JOB_DIR, jobPython } from "@/modules/recommendations/service";
import { emptyTestDatabaseUrl } from "../tests/integration/databases";
import setupTestDatabases from "../tests/integration/global-setup";

// The Python recommendation job (Tech §10, P1-15):
//   npm run reco:setup   create jobs/apriori/.venv and install the pinned
//                        packages (requirements-dev.txt includes pytest)
//   npm run reco:run     run the job against DATABASE_URL
//   npm run test:reco    reset the test databases, then run pytest

function run(command: string, args: string[], env = jobEnv()): number {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function requirePython(): string {
  const python = jobPython();
  if (!existsSync(python)) {
    throw new Error("Python environment missing: run `npm run reco:setup`");
  }
  return python;
}

function setup(): number {
  if (!existsSync(jobPython())) {
    // Python 3.13 (docs/versions.md): the py launcher on Windows.
    const [command, args] =
      process.platform === "win32"
        ? ["py", ["-3.13"]]
        : ["python3.13", [] as string[]];
    const created = run(command, [
      ...args,
      "-m",
      "venv",
      path.join(JOB_DIR, ".venv"),
    ]);
    if (created !== 0) return created;
  }
  return run(jobPython(), [
    "-m",
    "pip",
    "install",
    "--disable-pip-version-check",
    "-r",
    path.join(JOB_DIR, "requirements-dev.txt"),
  ]);
}

async function test(args: string[]): Promise<number> {
  const python = requirePython();
  if (existsSync(".env")) process.loadEnvFile(".env");
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error("TEST_DATABASE_URL is not set");
  // The same fresh, migrated empty database the integration tests use.
  await setupTestDatabases();
  return run(
    python,
    ["-m", "pytest", "-q", "-c", "jobs/apriori/pytest.ini", ...args],
    {
      ...jobEnv(),
      RECO_TEST_DATABASE_URL: emptyTestDatabaseUrl(testUrl),
    },
  );
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "setup":
      return setup();
    case "run":
      return run(requirePython(), [path.join(JOB_DIR, "run.py"), ...args]);
    case "test":
      return test(args);
    default:
      throw new Error("Usage: tsx scripts/reco.ts setup|run|test");
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });

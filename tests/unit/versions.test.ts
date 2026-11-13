import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// docs/versions.md is the single record of pinned versions (Tech §2, P0-07).
const doc = readFileSync("docs/versions.md", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

// Rows look like: | `name` | 1.2.3 |
function tableUnder(heading: string): Record<string, string> {
  const section = doc.split(`## ${heading}\n`)[1]?.split("\n## ")[0] ?? "";
  return Object.fromEntries(
    [...section.matchAll(/^\| `([^`]+)`\s*\| ([^ |]+)\s*\|$/gm)].map((m) => [
      m[1],
      m[2],
    ]),
  );
}

describe("docs/versions.md", () => {
  it("lists every dependency at its exact package.json version", () => {
    expect(tableUnder("Dependencies")).toEqual(pkg.dependencies);
  });

  it("lists every dev dependency at its exact package.json version", () => {
    expect(tableUnder("Dev dependencies")).toEqual(pkg.devDependencies);
  });

  it("only uses exact versions in package.json", () => {
    const ranges = Object.entries({
      ...pkg.dependencies,
      ...pkg.devDependencies,
    }).filter(([, version]) => !/^\d+\.\d+\.\d+$/.test(version));
    expect(ranges).toEqual([]);
  });

  // Direct packages are listed above the "# Indirect" line of each file.
  const requirementLines = (file: string) =>
    readFileSync(`jobs/apriori/${file}`, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim());

  it("lists the Apriori job's direct Python packages at their pinned versions", () => {
    const pins = (file: string) => {
      const lines = requirementLines(file);
      return Object.fromEntries(
        lines
          .slice(0, lines.indexOf("# Indirect"))
          .map((line) => /^([A-Za-z0-9_.-]+)==(\S+)$/.exec(line))
          .filter((match) => match !== null)
          .map((match) => [match[1], match[2]]),
      );
    };
    expect(tableUnder("Python packages (Apriori job)")).toEqual({
      ...pins("requirements.txt"),
      ...pins("requirements-dev.txt"),
    });
  });

  it("pins every Python package exactly", () => {
    for (const file of ["requirements.txt", "requirements-dev.txt"]) {
      const loose = requirementLines(file)
        .filter(
          (line) => line && !line.startsWith("#") && !line.startsWith("-r"),
        )
        .filter((line) => !/^[A-Za-z0-9_.-]+==[^\s;]+(;.*)?$/.test(line));
      expect(loose).toEqual([]);
    }
  });

  it("matches the PostgreSQL image in docker-compose.yml", () => {
    const image = readFileSync("docker-compose.yml", "utf8").match(
      /image: postgres:(\S+)/,
    )?.[1];
    expect(image).toMatch(/^16\.\d+$/);
    expect(doc).toContain(`| PostgreSQL | ${image} `);
    expect(doc).toContain(`image \`postgres:${image}\``);
  });
});

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeSql, getDb } from "@/db/client";
import { associationRuleRuns } from "@/db/schema";
import {
  type JobSummary,
  resetNightlyRunState,
  runAprioriJob,
  startNightlyRecommendationRun,
} from "@/modules/recommendations/service";

// P1-15 (Tech §10): the worker starts the Apriori job once between 03:00 and
// 04:00 Jakarta, unless a run already started in that window. The job itself
// is tested with pytest (npm run test:reco); here it is a stub, except for
// one real run that checks the Node–Python handover.
//
// Runs persist in the shared database, so each test uses its own far-future
// night, later than the one before.

afterAll(() => closeSql());
beforeEach(() => resetNightlyRunState());

const summary: JobSummary = {
  status: "succeeded",
  runId: null,
  baskets: 0,
  seeded: 0,
  rules: 0,
  note: "",
};

// 03:00 Jakarta on 1 January of the given year, plus minutes.
const night = (year: number, minutes: number) =>
  new Date(Date.UTC(year - 1, 11, 31, 20, minutes));

describe("startNightlyRecommendationRun", () => {
  it("starts the job once in the window", async () => {
    const launch = vi.fn(async () => summary);
    expect(
      await startNightlyRecommendationRun({ now: night(2301, 5), launch }),
    ).toBe(true);
    expect(
      await startNightlyRecommendationRun({ now: night(2301, 6), launch }),
    ).toBe(false);
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("tries once per window even when the job cannot run", async () => {
    const launch = vi.fn(async () => {
      throw new Error("Python environment missing");
    });
    expect(
      await startNightlyRecommendationRun({ now: night(2302, 0), launch }),
    ).toBe(true);
    expect(
      await startNightlyRecommendationRun({ now: night(2302, 30), launch }),
    ).toBe(false);
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("does nothing when a run started in the window already", async () => {
    await getDb()
      .insert(associationRuleRuns)
      .values({
        startedAt: night(2303, 2),
        status: "succeeded",
        minSupport: "0.02",
        minConfidence: "0.15",
        minLift: "1.05",
      });
    const launch = vi.fn(async () => summary);
    expect(
      await startNightlyRecommendationRun({ now: night(2303, 10), launch }),
    ).toBe(false);
    expect(launch).not.toHaveBeenCalled();
  });

  it("does nothing outside the window", async () => {
    const launch = vi.fn(async () => summary);
    expect(
      await startNightlyRecommendationRun({ now: night(2304, 60), launch }),
    ).toBe(false);
    expect(
      await startNightlyRecommendationRun({ now: night(2304, -1), launch }),
    ).toBe(false);
    expect(launch).not.toHaveBeenCalled();
  });
});

describe("runAprioriJob", () => {
  // The real Python job against the test database: few paid orders there,
  // so the run is skipped and recorded. Needs `npm run reco:setup`.
  it("runs the job and returns its summary", { timeout: 60_000 }, async () => {
    const result = await runAprioriJob();
    expect(result).toMatchObject({
      status: "skipped_insufficient_data",
      runId: expect.any(String),
    });
    const [run] = await getDb()
      .select()
      .from(associationRuleRuns)
      .where(eq(associationRuleRuns.id, result.runId!));
    expect(run).toMatchObject({
      status: "skipped_insufficient_data",
      transactionsCount: result.baskets,
      library: "mlxtend 0.25.0",
    });
  });
});

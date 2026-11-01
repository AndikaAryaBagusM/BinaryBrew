// URLs of the integration test databases (Tech §12).
//
// - TEST_DATABASE_URL (…_test): shared by the integration files, which run one
//   at a time and leave rows behind (audit rows can never be removed).
// - The "empty" copy (…_empty_test): cloned from the freshly migrated test
//   database before any test runs, for tests that need an empty database. They
//   must roll back what they write.
export function emptyTestDatabaseUrl(testUrl: string): string {
  const url = new URL(testUrl);
  url.pathname = url.pathname.replace(/_test$/, "_empty_test");
  return url.toString();
}

export function maintenanceDatabaseUrl(testUrl: string): string {
  const url = new URL(testUrl);
  url.pathname = "/postgres";
  return url.toString();
}

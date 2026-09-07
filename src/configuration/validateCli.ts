/**
 * Configuration validation CLI.
 *
 * Run in CI and as a deployment gate: `npm run validate:config`.
 * Exits non-zero on any error, so a configuration that would let the system misbehave cannot be
 * merged or deployed.
 */

import { JsonConfigurationStore } from './jsonConfigurationStore.js';
import { validateConfiguration } from './validate.js';

async function main(): Promise<void> {
  const store = new JsonConfigurationStore(process.argv[2]);
  const report = await validateConfiguration(store);

  const errors = report.issues.filter((i) => i.severity === 'error');
  const warnings = report.issues.filter((i) => i.severity === 'warning');

  for (const issue of errors) {
    process.stderr.write(`ERROR   ${issue.code} [${issue.subject}] ${issue.message}\n`);
  }
  for (const issue of warnings) {
    // Warnings are expected: they are the open BRD gaps, reported every run so they stay visible.
    process.stdout.write(`WARNING ${issue.code} [${issue.subject}] ${issue.message}\n`);
  }

  process.stdout.write(
    `\nConfiguration ${report.valid ? 'VALID' : 'INVALID'} - ${errors.length} error(s), ${warnings.length} warning(s).\n`,
  );

  if (!report.valid) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`Configuration validation failed to run: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});

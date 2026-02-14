import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackup } from './backup.js';
import { restoreBackup, postRestoreRun } from './restore.js';
import { verifyArchive } from './verify.js';
import { diffArchiveVsWorkspace, diffArchiveVsArchive, formatDiff } from './diff.js';
import { getArchiveInfo, formatInfo } from './info.js';
import { discoverWorkspace } from './discovery.js';
import { containerize } from './containerize.js';
import { writeStdout, writeStderr, writeLine } from './output.js';
import { resolveArchive, cleanupTempArchive, type ResolvedArchive } from './archive-reader.js';
import { promptForPassword } from './credentials.js';

const pkg = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf-8'),
);

/**
 * Resolve archive path — if encrypted, prompt for password and decrypt to temp file.
 */
async function resolveArchivePath(file: string, password?: string): Promise<ResolvedArchive> {
  try {
    return resolveArchive(file, password);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'ENCRYPTED_ARCHIVE') {
      const pw = await promptForPassword('Enter decryption password: ', false);
      return resolveArchive(file, pw);
    }
    throw err;
  }
}

export function createCli(): Command {
  const program = new Command();

  program
    .name('clawback')
    .description('Backup & Disaster Recovery for OpenClaw Agents')
    .version(pkg.version);

  program
    .command('backup')
    .description('Back up an OpenClaw agent workspace')
    .option('--workspace <path>', 'OpenClaw workspace path (auto-detected if not set)')
    .option('--output <path>', 'Output file path')
    .option('--with-credentials', 'Include encrypted credential vault')
    .option('--password <password>', 'Password for credential vault (non-interactive)')
    .option('--include-credential <path>', 'Include extra credential file', (val: string, prev: string[]) => prev.concat([val]), [] as string[])
    .option('--include <dirs...>', 'Include additional directories beyond defaults')
    .option('--include-data', 'Include large skill data directories')
    .option('--exclude <pattern>', 'Exclude files matching glob pattern', (val: string, prev: string[]) => prev.concat([val]), [] as string[])
    .option('--encrypt', 'Encrypt entire archive — includes credentials automatically')
    .action(async (options) => {
      try {
        // --encrypt implies --with-credentials
        const withCredentials = options.withCredentials || options.encrypt;
        const result = await createBackup({
          workspace: options.workspace,
          output: options.output,
          exclude: options.exclude,
          include: options.include,
          withCredentials,
          includeData: options.includeData,
          password: options.password,
          includeCredential: options.includeCredential,
          encrypt: options.encrypt,
        });
        await writeLine(`Backup created: ${result.outputPath}`);
        await writeLine(`  Files: ${result.fileCount}`);
        await writeLine(`  Size: ${result.totalBytes} bytes`);
        process.exit(0);
      } catch (err: unknown) {
        if (err instanceof Error && err.message === 'OPENCLAW_NOT_FOUND') {
          process.exit(1);
        } else {
          const message = err instanceof Error ? err.message : String(err);
          await writeStderr(`Error: ${message}\n`);
          process.exit(1);
        }
      }
    });

  program
    .command('restore <file>')
    .description('Restore an OpenClaw agent from a backup')
    .option('--workspace <path>', 'Target workspace directory')
    .option('--dry-run', 'Show what would change without applying')
    .option('--force', 'Skip confirmation prompt')
    .option('--skip-credentials', 'Skip credential restoration')
    .option('--password <password>', 'Password for credential vault (non-interactive)')
    .option('--run', 'Start OpenClaw gateway after restore')
    .action(async (file, options) => {
      let resolved: ResolvedArchive | null = null;
      try {
        resolved = await resolveArchivePath(file, options.password);
        const result = await restoreBackup(resolved.path, {
          workspace: options.workspace,
          dryRun: options.dryRun,
          force: options.force,
          skipCredentials: options.skipCredentials,
          password: options.password,
        });

        if (result.dryRun) {
          await writeLine('Dry run — no files written.');
          await writeLine('');
        }

        // Identity warnings
        for (const warning of result.identityWarnings) {
          await writeLine(`  ⚠ ${warning}`);
        }

        // File list
        await writeLine(
          `${result.dryRun ? 'Would restore' : 'Restored'} ${result.restoredFiles.length} files to ${result.targetDir}`,
        );
        for (const f of result.restoredFiles) {
          const tag = f.remapped ? ' (paths remapped)' : '';
          await writeLine(`  ${result.dryRun ? '→' : '✓'} ${f.path}${tag}`);
        }

        // Missing dependencies
        if (result.missingDeps.length > 0) {
          await writeLine('');
          await writeLine(`⚠ Missing dependencies: ${result.missingDeps.join(', ')}`);
        }

        if (!result.dryRun) {
          await writeLine('');
          await writeLine(
            '⚠️  If OpenClaw overwrites your files on first boot, run: bash restore-fixup.sh',
          );
        }

        if (!result.dryRun && options.run) {
          await writeLine('');
          await postRestoreRun(result.targetDir, result.agentName, result.manifest, result.archivePath);
        }
        process.exit(0);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        await writeStderr(`Error: ${message}\n`);
        process.exit(1);
      } finally {
        if (resolved) cleanupTempArchive(resolved);
      }
    });

  program
    .command('verify <file>')
    .description('Verify backup archive integrity')
    .option('--password <password>', 'Password for encrypted archive')
    .action(async (file, options) => {
      let resolved: ResolvedArchive | null = null;
      try {
        resolved = await resolveArchivePath(file, options.password);
        const result = await verifyArchive(resolved.path);

        if (result.error) {
          await writeStderr(`Error: ${result.error}\n`);
          process.exit(1);
        }

        for (const fileResult of result.files) {
          if (fileResult.status === 'ok') {
            await writeLine(`  ✓ ${fileResult.path}`);
          } else if (fileResult.status === 'missing') {
            await writeLine(`  ✗ ${fileResult.path} (missing from archive)`);
          } else {
            await writeLine(`  ✗ ${fileResult.path} (checksum mismatch)`);
          }
        }

        if (result.valid) {
          await writeLine('');
          await writeLine('Archive is valid.');
          process.exit(0);
        } else {
          await writeLine('');
          await writeLine('Archive is CORRUPTED.');
          process.exit(1);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        await writeStderr(`Error: ${message}\n`);
        process.exit(1);
      } finally {
        if (resolved) cleanupTempArchive(resolved);
      }
    });

  program
    .command('diff <file> [fileB]')
    .description('Compare backup to live state or two backups')
    .option('--workspace <path>', 'Workspace to compare against')
    .option('--password <password>', 'Password for encrypted archive')
    .action(async (file, fileB, options) => {
      let resolved: ResolvedArchive | null = null;
      let resolvedB: ResolvedArchive | null = null;
      try {
        resolved = await resolveArchivePath(file, options.password);
        let result;
        if (fileB) {
          resolvedB = await resolveArchivePath(fileB, options.password);
          result = await diffArchiveVsArchive(resolved.path, resolvedB.path);
        } else {
          const workspace = options.workspace
            ? options.workspace
            : discoverWorkspace({});
          if (!workspace) {
            await writeStderr(
              'Error: No workspace found. Use --workspace to specify the path.\n',
            );
            process.exit(1);
          }
          result = await diffArchiveVsWorkspace(resolved.path, workspace);
        }
        await writeStdout(`${formatDiff(result)}\n`);
        process.exit(0);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        await writeStderr(`Error: ${message}\n`);
        process.exit(1);
      } finally {
        if (resolved) cleanupTempArchive(resolved);
        if (resolvedB) cleanupTempArchive(resolvedB);
      }
    });

  program
    .command('containerize <file>')
    .description('Generate Docker deployment files from a backup')
    .option('--output <dir>', 'Output directory', 'deploy')
    .option('--run', 'Build and run container interactively (OpenClaw wizard handles setup)')
    .action(async (file, options) => {
      try {
        const result = await containerize(file, {
          outputDir: options.output,
          run: options.run,
        });
        await writeLine(`Generated Docker deployment for agent "${result.agentName}":`);
        for (const f of result.files) {
          await writeLine(`  ${result.outputDir}/${f}`);
        }
        if (!options.run) {
          await writeLine('');
          await writeLine('Next steps:');
          await writeLine(`  cd ${result.outputDir}`);
          await writeLine('  docker compose run -it agent   # first run: OpenClaw setup wizard');
          await writeLine('  docker compose up -d            # then run in background');
        } else if (result.started) {
          await writeLine('');
          await writeLine(`✅ Agent "${result.agentName}" is running in Docker`);
          await writeLine('To run in background: docker compose up -d');
        }
        process.exit(0);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        await writeStderr(`Error: ${message}\n`);
        process.exit(1);
      }
    });

  program
    .command('info <file>')
    .description('Show backup summary information')
    .option('--password <password>', 'Password for encrypted archive')
    .action(async (file, options) => {
      let resolved: ResolvedArchive | null = null;
      try {
        resolved = await resolveArchivePath(file, options.password);
        const info = await getArchiveInfo(resolved.path);
        await writeStdout(`${formatInfo(info)}\n`);
        process.exit(0);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        await writeStderr(`Error: ${message}\n`);
        process.exit(1);
      } finally {
        if (resolved) cleanupTempArchive(resolved);
      }
    });

  return program;
}

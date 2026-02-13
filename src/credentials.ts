import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import {
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  utimesSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { applyRemap, unapplyRemap, type EnvMap } from './pathmap.js';

const REDACTED_VALUE = 'REDACTED';
const CREDENTIAL_KEY_PATTERN = /api[_-]?key|token|secret|access[_-]?token|refresh[_-]?token/i;

export type CredentialSource =
  | 'gateway-config'
  | 'env-file'
  | 'cookies'
  | 'oauth-token'
  | 'include-credential';

export interface CredentialManifestEntry {
  name: string;
  source: CredentialSource;
  required: boolean;
  originalPath?: string;
  keyPath?: string;
}

export interface CredentialManifest {
  credentials: CredentialManifestEntry[];
}

export interface GatewayCredentialValue {
  name: string;
  keyPath: string;
  value: string;
  provider?: string;
  required: boolean;
}

export interface GatewayCredentialTarget {
  keyPath: string;
  provider?: string;
  keyName: string;
}

export interface CredentialFileEntry {
  name: string;
  source: CredentialSource;
  originalPath: string;
  required: boolean;
}

export interface CredentialVaultPayload {
  version: number;
  created: string;
  gateway: Array<{
    name: string;
    keyPath: string;
    value: string;
  }>;
  files: Array<{
    originalPath: string;
    data: string;
    mode: number;
    mtimeMs: number;
  }>;
}

export interface PromptProvider {
  promptPassword?(message: string, confirm: boolean): Promise<string>;
  promptSecret?(message: string): Promise<string>;
}

export interface GatewayExtraction {
  sanitizedConfig: string;
  credentials: GatewayCredentialValue[];
}

export function extractGatewayCredentials(configText: string): GatewayExtraction {
  try {
    const parsed = parseYaml(configText) as unknown;
    const credentials: GatewayCredentialValue[] = [];

    const walk = (value: unknown, pathParts: string[]): unknown => {
      if (Array.isArray(value)) {
        return value.map((item, idx) => walk(item, [...pathParts, String(idx)]));
      }
      if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        const updated: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(obj)) {
          if (typeof val === 'string' && CREDENTIAL_KEY_PATTERN.test(key) && val.trim()) {
            const keyPath = [...pathParts, key].join('.');
            const provider = deriveProvider(pathParts);
            const name = buildCredentialName(provider, key);
            credentials.push({
              name,
              keyPath,
              value: val,
              provider,
              required: true,
            });
            updated[key] = REDACTED_VALUE;
          } else {
            updated[key] = walk(val, [...pathParts, key]);
          }
        }
        return updated;
      }
      return value;
    };

    const sanitized = walk(parsed, []);
    const sanitizedConfig = stringifyYaml(sanitized);

    return { sanitizedConfig, credentials };
  } catch {
    return extractGatewayCredentialsFallback(configText);
  }
}

function extractGatewayCredentialsFallback(configText: string): GatewayExtraction {
  const lines = configText.split(/\r?\n/);
  const credentials: GatewayCredentialValue[] = [];
  const sanitizedLines = lines.map((line) => {
    const match = line.match(/^(\s*)([A-Za-z0-9_-]+)\s*:\s*(.+)$/);
    if (!match) return line;
    const key = match[2];
    const value = match[3];
    if (!CREDENTIAL_KEY_PATTERN.test(key) || !value.trim()) {
      return line;
    }
    const name = buildCredentialName(undefined, key);
    credentials.push({
      name,
      keyPath: key,
      value: value.trim(),
      required: true,
    });
    return `${match[1]}${key}: ${REDACTED_VALUE}`;
  });

  return {
    sanitizedConfig: sanitizedLines.join('\n'),
    credentials,
  };
}

export function findGatewayCredentialTargets(configText: string): GatewayCredentialTarget[] {
  try {
    const parsed = parseYaml(configText) as unknown;
    const targets: GatewayCredentialTarget[] = [];

    const walk = (value: unknown, pathParts: string[]): void => {
      if (Array.isArray(value)) {
        value.forEach((item, idx) => walk(item, [...pathParts, String(idx)]));
        return;
      }
      if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        for (const [key, val] of Object.entries(obj)) {
          if (
            typeof val === 'string' &&
            CREDENTIAL_KEY_PATTERN.test(key) &&
            (!val.trim() || val.trim().toUpperCase() === REDACTED_VALUE)
          ) {
            const keyPath = [...pathParts, key].join('.');
            const provider = deriveProvider(pathParts);
            targets.push({ keyPath, provider, keyName: key });
          } else {
            walk(val, [...pathParts, key]);
          }
        }
      }
    };

    walk(parsed, []);
    return targets;
  } catch {
    return [];
  }
}

export function injectGatewayCredentials(
  configText: string,
  values: Array<{ keyPath: string; value: string }>,
): string {
  if (values.length === 0) return configText;
  try {
    const parsed = parseYaml(configText) as unknown;
    for (const { keyPath, value } of values) {
      const parts = keyPath.split('.').filter(Boolean);
      setNestedValue(parsed, parts, value);
    }
    return stringifyYaml(parsed);
  } catch {
    let updated = configText;
    for (const { keyPath, value } of values) {
      const key = keyPath.split('.').slice(-1)[0];
      if (!key) continue;
      const pattern = new RegExp(`(^\\s*${escapeRegex(key)}\\s*:)\\s*.+$`, 'm');
      updated = updated.replace(pattern, `$1 ${value}`);
    }
    return updated;
  }
}

export function detectCredentialFiles(
  workspace: string,
  includeCredential: string[] = [],
): CredentialFileEntry[] {
  const entries: CredentialFileEntry[] = [];
  const workspaceAbs = resolve(workspace);

  const seen = new Set<string>();
  const pushEntry = (entry: CredentialFileEntry): void => {
    if (seen.has(entry.originalPath)) return;
    seen.add(entry.originalPath);
    entries.push(entry);
  };

  // Workspace root scans
  let dirItems: string[] = [];
  try {
    dirItems = readdirSync(workspaceAbs);
  } catch {
    dirItems = [];
  }

  for (const name of dirItems) {
    const candidatePath = join(workspaceAbs, name);
    if (!existsSync(candidatePath)) continue;

    // .env files in workspace root
    if (name === '.env' || name.startsWith('.env.')) {
      pushEntry({
        name,
        source: 'env-file',
        originalPath: candidatePath,
        required: false,
      });
      continue;
    }

    // *-cookies.json in workspace root
    if (name.endsWith('-cookies.json')) {
      pushEntry({
        name,
        source: 'cookies',
        originalPath: candidatePath,
        required: false,
      });
      continue;
    }

    // auth-profiles.json / models.json
    if (name === 'auth-profiles.json' || name === 'models.json') {
      pushEntry({
        name,
        source: 'oauth-token',
        originalPath: candidatePath,
        required: false,
      });
      continue;
    }

    // *.token files
    if (name.endsWith('.token')) {
      pushEntry({
        name,
        source: 'oauth-token',
        originalPath: candidatePath,
        required: false,
      });
    }
  }

  // OAuth tokens / credential caches
  const oauthCandidates = [
    join(workspaceAbs, '.openclaw', 'auth.json'),
    join(workspaceAbs, '.openclaw', 'oauth.json'),
    join(workspaceAbs, '.openclaw', 'credentials.json'),
    join(workspaceAbs, 'config', 'auth.json'),
    join(workspaceAbs, 'config', 'oauth.json'),
  ];
  for (const candidate of oauthCandidates) {
    if (existsSync(candidate)) {
      pushEntry({
        name: basename(candidate),
        source: 'oauth-token',
        originalPath: candidate,
        required: false,
      });
    }
  }

  // include-credential paths
  for (const p of includeCredential) {
    const resolved = resolve(p);
    if (!existsSync(resolved)) {
      throw new Error(`Included credential not found: ${p}`);
    }
    entries.push({
      name: basename(resolved),
      source: 'include-credential',
      originalPath: resolved,
      required: false,
    });
  }

  return entries;
}

export function buildCredentialManifest(
  gatewayCredentials: GatewayCredentialValue[],
  files: CredentialFileEntry[],
): CredentialManifest {
  const credentials: CredentialManifestEntry[] = [];

  for (const gateway of gatewayCredentials) {
    credentials.push({
      name: gateway.name,
      source: 'gateway-config',
      required: gateway.required,
      keyPath: gateway.keyPath,
    });
  }

  for (const file of files) {
    credentials.push({
      name: file.name,
      source: file.source,
      required: file.required,
      originalPath: file.originalPath,
    });
  }

  return { credentials };
}

export function buildCredentialVaultPayload(
  gatewayCredentials: GatewayCredentialValue[],
  files: CredentialFileEntry[],
): CredentialVaultPayload {
  const filePayloads = files.map((file) => {
    const content = readFileSync(file.originalPath);
    const stat = statSync(file.originalPath);
    return {
      originalPath: file.originalPath,
      data: content.toString('base64'),
      mode: stat.mode,
      mtimeMs: stat.mtimeMs,
    };
  });

  return {
    version: 1,
    created: new Date().toISOString(),
    gateway: gatewayCredentials.map((cred) => ({
      name: cred.name,
      keyPath: cred.keyPath,
      value: cred.value,
    })),
    files: filePayloads,
  };
}

export async function encryptCredentialVault(
  payload: CredentialVaultPayload,
  password: string,
): Promise<Buffer> {
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = scryptSync(password, salt, 32);

  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf-8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const envelope = {
    v: 1,
    kdf: 'scrypt',
    alg: 'aes-256-gcm',
    salt: salt.toString('base64'),
    nonce: nonce.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };

  return Buffer.from(JSON.stringify(envelope), 'utf-8');
}

export async function decryptCredentialVault(
  payload: Buffer,
  password: string,
): Promise<CredentialVaultPayload> {
  let envelope: {
    salt: string;
    nonce: string;
    tag: string;
    ciphertext: string;
  };

  try {
    envelope = JSON.parse(payload.toString('utf-8'));
  } catch {
    throw new Error('Invalid credentials vault format');
  }

  const salt = Buffer.from(envelope.salt, 'base64');
  const nonce = Buffer.from(envelope.nonce, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');

  const key = scryptSync(password, salt, 32);

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString('utf-8')) as CredentialVaultPayload;
  } catch {
    throw new Error('Invalid password or corrupted credentials vault');
  }
}

export function restoreCredentialFiles(
  files: CredentialVaultPayload['files'],
  oldEnvMap: EnvMap,
  newEnvMap: EnvMap,
): string[] {
  const restoredPaths: string[] = [];
  for (const file of files) {
    const targetPath = remapCredentialPath(file.originalPath, oldEnvMap, newEnvMap);
    mkdirSync(dirname(targetPath), { recursive: true });
    const data = Buffer.from(file.data, 'base64');
    writeFileSync(targetPath, data);
    try {
      chmodSync(targetPath, file.mode);
    } catch {
      // ignore
    }
    try {
      const mtime = new Date(file.mtimeMs);
      utimesSync(targetPath, mtime, mtime);
    } catch {
      // ignore
    }
    restoredPaths.push(targetPath);
  }
  return restoredPaths;
}

export function remapCredentialPath(
  originalPath: string,
  oldEnvMap: EnvMap,
  newEnvMap: EnvMap,
): string {
  if (Object.keys(oldEnvMap).length === 0) return originalPath;
  const withPlaceholders = applyRemap(originalPath, oldEnvMap);
  return unapplyRemap(withPlaceholders, newEnvMap);
}

export async function promptForPassword(
  message: string,
  confirm: boolean,
  promptProvider?: PromptProvider,
): Promise<string> {
  if (promptProvider?.promptPassword) {
    return promptProvider.promptPassword(message, confirm);
  }

  const input = process.stdin;
  const output = process.stdout;
  const rl = createInterface({ input, output });

  try {
    const first = await rl.question(message);
    if (!confirm) {
      return first;
    }
    const second = await rl.question('Confirm password: ');
    if (first !== second) {
      throw new Error('Passwords do not match');
    }
    return first;
  } finally {
    rl.close();
  }
}

export async function promptForSecret(
  message: string,
  promptProvider?: PromptProvider,
): Promise<string> {
  if (promptProvider?.promptSecret) {
    return promptProvider.promptSecret(message);
  }
  const input = process.stdin;
  const output = process.stdout;
  const rl = createInterface({ input, output });
  try {
    return await rl.question(message);
  } finally {
    rl.close();
  }
}

export function formatProviderName(provider?: string): string {
  if (!provider) return 'AI provider';
  const normalized = provider.replace(/[_-]+/g, ' ').trim();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function resolveCredentialPathsInWorkspace(
  workspace: string,
  files: CredentialFileEntry[],
): string[] {
  const workspaceAbs = resolve(workspace);
  const paths: string[] = [];
  for (const file of files) {
    const absPath = resolve(file.originalPath);
    if (isPathInside(workspaceAbs, absPath)) {
      paths.push(relative(workspaceAbs, absPath));
    }
  }
  return paths;
}

function deriveProvider(pathParts: string[]): string | undefined {
  const ignore = new Set(['providers', 'models', 'gateway', 'config']);
  for (let i = pathParts.length - 1; i >= 0; i -= 1) {
    const part = pathParts[i];
    if (!ignore.has(part)) return part;
  }
  return undefined;
}

function buildCredentialName(provider: string | undefined, key: string): string {
  const base = provider ? `${provider}_${key}` : key;
  return base
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function setNestedValue(value: unknown, pathParts: string[], newValue: string): void {
  if (!value || typeof value !== 'object') return;
  let current = value as Record<string, unknown>;
  for (let i = 0; i < pathParts.length; i += 1) {
    const part = pathParts[i];
    if (i === pathParts.length - 1) {
      current[part] = newValue;
      return;
    }
    if (!current[part] || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel && !rel.startsWith('..') && !rel.startsWith('/') && rel !== '';
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

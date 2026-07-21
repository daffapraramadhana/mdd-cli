import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand } from '../tools/exec.js';
import { globalPluginsDir, loadPlugins, readManifest, type PluginInfo } from './index.js';

export type Runner = (cmd: string, cwd: string) => Promise<{ ok: boolean; output: string }>;

const defaultRun: Runner = async (cmd, cwd) => {
  const res = await runCommand(cmd, cwd);
  return { ok: !res.isError, output: res.content };
};

export function resolveGitUrl(spec: string): string {
  if (spec.includes('://') || spec.startsWith('git@')) return spec;
  if (/^[\w.-]+\/[\w.-]+$/.test(spec)) return `https://github.com/${spec}`;
  return spec;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// Real git remotes never contain shell metacharacters; reject anything that could break out of the command.
function assertSafeGitUrl(url: string): void {
  if (!/^(https?:\/\/|git@|ssh:\/\/)/.test(url) || /[\s;'"`$(){}<>|&\\]/.test(url)) {
    throw new Error(`refusing to install from suspicious source: ${url}`);
  }
}

export async function addPlugin(spec: string, opts: { run?: Runner } = {}): Promise<{ name: string; message: string }> {
  const run = opts.run ?? defaultRun;
  const root = globalPluginsDir();
  await mkdir(root, { recursive: true });
  const staging = join(root, `.staging-${spec.replace(/[^\w-]/g, '_')}`);
  await rm(staging, { recursive: true, force: true });
  const url = resolveGitUrl(spec);
  assertSafeGitUrl(url);
  const res = await run(`git clone --depth 1 '${url}' "${staging}"`, root);
  if (!res.ok) {
    await rm(staging, { recursive: true, force: true });
    throw new Error(`clone failed: ${res.output}`);
  }
  const manifest = await readManifest(staging);
  if (!manifest) {
    await rm(staging, { recursive: true, force: true });
    throw new Error('plugin has no valid mdd-plugin.json or .claude-plugin/plugin.json');
  }
  const name: string | number | undefined = manifest.name || spec.split('/').pop() || spec;
  if (typeof name !== 'string' || !/^[\w][\w.-]*$/.test(name) || name.includes('..')) {
    await rm(staging, { recursive: true, force: true });
    throw new Error(`plugin manifest has an unsafe name: ${String(name)}`);
  }
  const dest = join(root, name);
  if (await exists(dest)) {
    await rm(staging, { recursive: true, force: true });
    throw new Error(`'${name}' is already installed — use 'mdd plugin update ${name}'`);
  }
  try {
    await rename(staging, dest);
  } catch (err) {
    await rm(staging, { recursive: true, force: true });
    throw err;
  }
  return { name, message: `installed ${name}` };
}

export async function listPlugins(cwd: string): Promise<PluginInfo[]> {
  return (await loadPlugins(cwd)).plugins;
}

/** A plugin with the names of the `/slash` commands it provides, for discoverable listings. */
export interface PluginListing extends PluginInfo {
  commandNames: string[];
}

/** Like {@link listPlugins} but also resolves each plugin's command names, so callers can
 *  show users what `/slash` commands an installed plugin actually provides. */
export async function listPluginsDetailed(cwd: string): Promise<PluginListing[]> {
  const loaded = await loadPlugins(cwd);
  const commands = [...loaded.commands.values()];
  return loaded.plugins.map((p) => ({
    ...p,
    commandNames: commands.filter((c) => c.plugin === p.name).map((c) => c.name).sort(),
  }));
}

/** One-line human summary of a plugin, including its command names when it has any. */
export function formatPluginListing(p: PluginListing): string {
  const cmds = p.commandNames.length ? `, cmds: ${p.commandNames.map((n) => `/${n}`).join(' ')}` : '';
  const ver = p.version ? `  v${p.version}` : '';
  return `${p.name}  [${p.scope}]  ${p.skillCount} skills, ${p.commandCount} commands${cmds}${ver}`;
}

export async function removePlugin(name: string): Promise<{ removed: boolean; message: string }> {
  if (!/^[\w][\w.-]*$/.test(name) || name.includes('..')) {
    return { removed: false, message: `invalid plugin name: ${name}` };
  }
  const dest = join(globalPluginsDir(), name);
  if (!(await exists(dest))) {
    return {
      removed: false,
      message: `no global plugin named '${name}' (project plugins live in .mdd/plugins and are managed in-repo)`,
    };
  }
  await rm(dest, { recursive: true, force: true });
  return { removed: true, message: `removed ${name}` };
}

export async function updatePlugin(name: string | undefined, opts: { run?: Runner } = {}): Promise<{ message: string }> {
  const run = opts.run ?? defaultRun;
  const infos = (await loadPlugins(process.cwd())).plugins.filter((p) => p.scope === 'global' && (!name || p.name === name));
  if (name && infos.length === 0) return { message: `no global plugin named '${name}'` };
  const done: string[] = [];
  for (const info of infos) {
    if (!(await exists(join(info.dir, '.git')))) {
      done.push(`skipped ${info.name} (not a git checkout)`);
      continue;
    }
    const res = await run('git pull --ff-only', info.dir);
    done.push(res.ok ? `updated ${info.name}` : `failed ${info.name}: ${res.output}`);
  }
  return { message: done.join('\n') || 'nothing to update' };
}

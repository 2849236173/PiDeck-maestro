import { execFile, execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { delimiter, join } from "node:path";
import { app } from "electron";
import type { AppSettings, PiInstallStatus } from "../../shared/types";

type PiProxySettings = Pick<
  AppSettings,
  "piProxyEnabled" | "piProxyUrl" | "piProxyBypass"
>;

/** Resolves the pi CLI across packaged Electron environments where shell PATH is often incomplete. */
export class PiLocator {
  resolveCommand() {
    const candidates = this.getCandidates();
    return candidates.find(candidate => existsSync(candidate)) ?? "pi";
  }

  getSearchDirs() {
    const home = app.getPath("home");
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    const localAppData = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    const dirs = [
      ...this.pathDirs(),
      join(appData, "npm"),
      join(localAppData, "pnpm"),
      join(localAppData, "Yarn", "bin"),
      join(localAppData, "Volta", "bin"),
      join(localAppData, "mise", "shims"),
      ...this.listChildDirs(join(localAppData, "mise", "installs", "node")),
      join(home, ".bun", "bin"),
      join(home, ".deno", "bin"),
      join(home, ".local", "bin"),
      join(home, ".npm-global", "bin"),
      join(home, ".nvm", "current", "bin"),
      ...this.listChildDirs(join(home, ".nvm", "versions", "node")).map(dir => join(dir, "bin")),
      join(home, ".asdf", "shims"),
      join(home, ".volta", "bin"),
    ];

    // These directories only locate an existing pi installation; pi itself is not bundled yet.
    return [...new Set(dirs.filter(Boolean))];
  }

  createProcessEnv(settings?: PiProxySettings) {
    const env = {
      ...process.env,
      PATH: this.getSearchDirs().join(delimiter),
    };

    return this.applyPiProxyEnv(env, settings);
  }

  private applyPiProxyEnv(
    env: NodeJS.ProcessEnv,
    settings?: PiProxySettings,
  ) {
    if (!settings?.piProxyEnabled) return env;
    const proxyUrl = settings.piProxyUrl.trim();
    if (!proxyUrl) return env;
    const bypass = settings.piProxyBypass.trim();

    // 这里只给 pi agent 子进程注入标准代理环境变量，避免误影响 desktop 自身的更新、外链和配置管理请求。
    return {
      ...env,
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl,
      ALL_PROXY: proxyUrl,
      http_proxy: proxyUrl,
      https_proxy: proxyUrl,
      all_proxy: proxyUrl,
      ...(bypass ? { NO_PROXY: bypass, no_proxy: bypass } : {}),
    };
  }

  async check(): Promise<PiInstallStatus> {
    const command = this.resolveCommand();
    const searchedDirs = this.getSearchDirs();

    return new Promise(resolve => {
      // --version is a lightweight health check: it verifies both executable discovery and Node shim startup.
      // Windows 的 .cmd shim 需要 shell 才能可靠执行；否则 execFile 可能误报不可用，但 spawn(shell:true) 实际能打开 agent。
      execFile(command, ["--version"], { env: this.createProcessEnv(), shell: process.platform === "win32", windowsHide: true, timeout: 8_000 }, (error, stdout, stderr) => {
        if (error) {
          resolve({ installed: false, command, searchedDirs, error: stderr.trim() || error.message });
          return;
        }

        resolve({ installed: true, command, searchedDirs, version: stdout.trim() });
      });
    });
  }

  private getCandidates() {
    const names = process.platform === "win32" ? ["pi.cmd", "pi.exe", "pi"] : ["pi"];
    return this.getSearchDirs().flatMap(dir => names.map(name => join(dir, name)));
  }

  private pathDirs() {
    const fromEnv = process.env.PATH ?? process.env.Path ?? "";
    const fromShell = this.readLoginShellPath();
    return [...fromEnv.split(delimiter), ...fromShell.split(delimiter)].filter(Boolean);
  }

  private readLoginShellPath() {
    try {
      if (process.platform === "win32") {
        return execFileSync("powershell.exe", ["-NoProfile", "-Command", "[Environment]::GetEnvironmentVariable('Path','User') + ';' + [Environment]::GetEnvironmentVariable('Path','Machine')"], { encoding: "utf8", windowsHide: true, timeout: 3000 }).trim();
      }
      return execFileSync("/bin/sh", ["-lc", "printf %s \"$PATH\""], { encoding: "utf8", timeout: 3000 }).trim();
    } catch {
      return "";
    }
  }

  private listChildDirs(parent: string) {
    try {
      return readdirSync(parent, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => join(parent, entry.name));
    } catch {
      return [];
    }
  }
}

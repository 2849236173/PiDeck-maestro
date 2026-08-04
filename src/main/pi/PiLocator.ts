import { execFile, execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { delimiter, dirname, extname, join } from "node:path";
import { app } from "electron";
import type { AgentShellCandidate, AgentShellValidationResult, AppSettings, PiInstallStatus } from "../../shared/types";

export type { AgentShellCandidate, AgentShellValidationResult } from "../../shared/types";

export function isLegacyWslShellPath(value: string): boolean {
  return /^[a-z]:[\\/]windows[\\/](?:system32|sysnative)[\\/]bash(?:\.exe)?$/i.test(value.trim());
}

type PiProxySettings = Pick<
  AppSettings,
  "piProxyEnabled" | "piProxyUrl" | "piProxyBypass"
>;

export type PiCommandInvocation = {
  command: string;
  args: string[];
  shell: boolean;
  pathPrefix?: string;
  /**
   * Windows 下通过 cmd.exe /c 启动 .cmd shim 时，命令行里已经手动完成引号包装。
   * 必须禁止 Node 再次转义参数，否则路径中含空格会被 cmd 误解析为不存在的路径。
   */
  windowsVerbatimArguments?: boolean;
  /**
   * 当 pi 位于 WSL 中时，command 固定为 wsl.exe，args 会携带 distro/user/pi 参数。
   * 下游 PiProcess 需要用此标志决定是否把 Windows cwd 转为 Linux 路径。
   */
  wsl?: {
    distro: string;
    user: string;
    piCommand: string;
  };
};

/** Resolves the pi CLI across packaged Electron environments where shell PATH is often incomplete. */
export class PiLocator {
  /**
   * Resolves the pi CLI across packaged Electron environments where shell PATH is often incomplete.
   * When `customPath` is provided, it takes priority over auto-detection —
   * this is the user's manually specified path from settings.
   */
  resolveCommand(customPath?: string, wslEnabled?: boolean, wslDistro?: string, wslUser?: string) {
    const normalizedCustomPath = this.normalizeCustomPath(customPath);
    // 用户手动指定路径优先，适用于 npm/pnpm/yarn 全局安装、nvm/volta/asdf/mise 等极端情况。
    // 旧版本可能已保存 pi.ps1；Windows 现在不再调用 PowerShell shim，遇到时忽略并回退自动检测。
    if (normalizedCustomPath && !this.isUnsupportedPowerShellShim(normalizedCustomPath)) {
      return normalizedCustomPath;
    }
    // 用户显式开启 WSL 时优先使用 WSL 中的 pi，不轮询本地 PATH 中的 Windows 版本
    if (wslEnabled && process.platform === "win32" && wslDistro && wslUser) {
      const wslCommand = this.resolveWslCommand(wslDistro, wslUser);
      if (wslCommand) return wslCommand;
    }

    const candidates = this.getCandidates();
    const found = candidates.find(candidate => existsSync(candidate));
    if (found) return found;
    return "pi";
  }

  getSearchDirs() {
    const home = app.getPath("home");
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    const localAppData = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    // Git\bin 必须排在 pathDirs（含 System32）之前：pi 的 Windows shell 解析用
    // `where bash.exe` 取第一个命中；若 System32\bash.exe（坏掉的 WSL 壳）排在前面，
    // 所有 bash 工具（pwd/df/wmic…）都会失败。portable Git（如 E:\runtime\git）尤其依赖此顺序。
    const dirs = [
      ...this.getGitBashDirs(),
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

  /**
   * Git for Windows is often installed outside Program Files (for example in
   * a portable/runtime directory). Pi's Windows shell resolver only sees
   * bash.exe when its Git bin directory is present on PATH; otherwise it can
   * fall back to C:\Windows\System32\bash.exe (WSL).
   */
  private getGitBashDirs() {
    if (process.platform !== "win32") return [];

    const candidates = new Set<string>();
    const addFromPath = (entry: string) => {
      const normalized = entry.replace(/[\\/]+$/, "");
      if (/(?:[\\/])Git(?:[\\/])cmd$/i.test(normalized)) {
        candidates.add(join(dirname(normalized), "bin"));
      } else if (/(?:[\\/])Git(?:[\\/])bin$/i.test(normalized)) {
        candidates.add(normalized);
      }
    };

    for (const entry of this.pathDirs()) addFromPath(entry);

    const installRoots = [
      process.env.ProgramFiles,
      process.env["ProgramFiles(x86)"],
    ].filter((value): value is string => Boolean(value));
    if (process.env.GIT_INSTALL_ROOT) installRoots.push(process.env.GIT_INSTALL_ROOT);
    for (const root of installRoots) {
      const gitRoot = root === process.env.GIT_INSTALL_ROOT ? root : join(root, "Git");
      candidates.add(join(gitRoot, "bin"));
    }

    return [...candidates].filter((dir) => existsSync(join(dir, "bash.exe")));
  }

  createProcessEnv(settings?: PiProxySettings, pathPrefix?: string, wsl?: PiCommandInvocation["wsl"]) {
    if (wsl) {
      // WSL 模式：保留原始 PATH 以便找到 wsl.exe（在 System32 中），
      // 同时注入代理环境变量（wsl.exe 子进程通过 Windows 网络栈访问外网）。
      const base = {
        ...process.env,
        PATH: pathPrefix || process.env.PATH || "",
      };
      return this.applyPiProxyEnv(base, settings);
    }
    const searchDirs = pathPrefix
      ? [pathPrefix, ...this.getSearchDirs().filter(dir => dir !== pathPrefix)]
      : this.getSearchDirs();
    // pathPrefix（pi 所在 Node bin）可能插到最前；再保证 Git\bin 仍优先于 System32。
    const gitBashDirs = process.platform === "win32" && !wsl ? this.getGitBashDirs() : [];
    const orderedDirs =
      gitBashDirs.length > 0
        ? [...gitBashDirs, ...searchDirs.filter((dir) => !gitBashDirs.includes(dir))]
        : searchDirs;
    const env = {
      ...process.env,
      PATH: orderedDirs.join(delimiter),
    };


    return this.applyPiProxyEnv(env, settings);
  }

  async listAgentShellCandidates(options: { probeHealth?: boolean } = {}): Promise<AgentShellCandidate[]> {
    const candidates = new Map<string, AgentShellCandidate>();
    const add = (path: string, source: AgentShellCandidate["source"]) => {
      const normalized = path.trim();
      if (!normalized || isLegacyWslShellPath(normalized) || !existsSync(normalized)) return;
      const key = process.platform === "win32" ? normalized.toLowerCase() : normalized;
      if (!candidates.has(key)) {
        candidates.set(key, {
          id: `${source}:${candidates.size}`,
          label: `${source === "git" ? "Git Bash" : source === "cygwin" ? "Cygwin" : source === "msys2" ? "MSYS2" : source === "linux" ? "Linux" : source === "mac" ? "macOS" : "Shell"} (${normalized})`,
          path: normalized,
          source,
          healthy: false,
        });
      }
    };

    if (process.platform === "win32") {
      for (const dir of this.getGitBashDirs()) add(join(dir, "bash.exe"), "git");
      for (const dir of this.pathDirs()) add(join(dir, "bash.exe"), this.shellSourceForPath(dir));
      const roots = [
        process.env.ProgramFiles,
        process.env["ProgramFiles(x86)"],
        process.env.GIT_INSTALL_ROOT,
      ].filter((value): value is string => Boolean(value));
      for (const root of roots) {
        const gitRoot = root === process.env.GIT_INSTALL_ROOT ? root : join(root, "Git");
        add(join(gitRoot, "bin", "bash.exe"), "git");
        add(join(gitRoot, "usr", "bin", "bash.exe"), "git");
      }
      add(join(process.env.SystemDrive || "C:", "cygwin64", "bin", "bash.exe"), "cygwin");
      add(join(process.env.SystemDrive || "C:", "msys64", "usr", "bin", "bash.exe"), "msys2");
      add(join(process.env.SystemDrive || "C:", "msys64", "usr", "bin", "sh.exe"), "msys2");
    } else {
      const names = process.platform === "darwin"
        ? [["/bin/bash", "mac"], ["/usr/bin/bash", "mac"], ["/bin/zsh", "mac"], ["/usr/bin/zsh", "mac"]]
        : [["/bin/bash", "linux"], ["/usr/bin/bash", "linux"], ["/bin/sh", "linux"], ["/usr/bin/sh", "linux"]];
      for (const [path, source] of names) add(path, source as AgentShellCandidate["source"]);
      for (const dir of this.pathDirs()) add(join(dir, "bash"), process.platform === "darwin" ? "mac" : "linux");
    }

    const list = [...candidates.values()];
    if (options.probeHealth !== false) {
      await Promise.all(list.map(async (candidate) => {
        candidate.healthy = await this.validateAgentShell(candidate.path).then(result => result.ok).catch(() => false);
      }));
    }
    return list;
  }

  async resolveAutoAgentShell(): Promise<string | undefined> {
    const candidates = await this.listAgentShellCandidates({ probeHealth: true });
    return candidates.find(candidate => candidate.healthy && !isLegacyWslShellPath(candidate.path))?.path;
  }

  async validateAgentShell(shellPath: string): Promise<AgentShellValidationResult> {
    const path = shellPath.trim();
    if (!path) return { ok: false, error: "Shell path is required" };
    if (isLegacyWslShellPath(path)) return { ok: false, error: "System32/Sysnative WSL bash is not an Agent Shell" };
    if (!existsSync(path)) return { ok: false, error: "Shell path does not exist" };
    return new Promise((resolve) => {
      execFile(path, ["-c", "echo __pideok__"], {
        encoding: "utf8",
        timeout: 5_000,
        windowsHide: true,
      }, (error, stdout, stderr) => {
        if (error || !stdout.includes("__pideok__")) {
          resolve({ ok: false, error: (stderr || error?.message || "Shell health check failed").trim() });
          return;
        }
        resolve({ ok: true, version: stdout.trim() });
      });
    });
  }

  private shellSourceForPath(dir: string): AgentShellCandidate["source"] {
    if (/[\\/]cygwin(?:64)?[\\/]bin$/i.test(dir)) return "cygwin";
    if (/[\\/]msys(?:64|2)?[\\/](?:usr[\\/])?bin$/i.test(dir)) return "msys2";
    if (/[\\/]Git[\\/](?:usr[\\/])?bin$/i.test(dir)) return "git";
    return process.platform === "darwin" ? "mac" : "linux";
  }

  /**
   * 构造实际启动 pi 的子进程参数。优先复用用户在 settings 里配置的 Agent Shell 路径，
   * WSL 模式固定走 wsl.exe，否则按平台选择 cmd.exe / 裸命令。返回的对象会直接交给
   * PiProcess，避免在那里再次拼接 shell 路径或字符串。
   */
  createInvocation(command: string, args: string[], options: { wslCwd?: string } = {}): PiCommandInvocation {
    // WSL 模式：command 为 "wsl://<distro>/<user>/pi" 形式的标记
    if (command.startsWith("wsl://")) {
      const parsed = this.parseWslUrl(command);
      if (!parsed) return { command, args, shell: false };
      const { distro, user, piCommand } = parsed;
      const wslExe = this.resolveWslExe();
      const wslArgs = [
        "-d", distro,
        "-u", user,
        ...(options.wslCwd ? ["--cd", options.wslCwd] : []),
        piCommand,
        ...args,
      ];
      console.log('[PiLocator] WSL invocation:', wslExe.command, wslArgs.join(' '), 'shell:', wslExe.shell);
      return {
        command: wslExe.command,
        args: wslArgs,
        shell: wslExe.shell,
        wsl: { distro, user, piCommand },
      };
    }

    if (process.platform !== "win32") {
      return { command, args, shell: false, pathPrefix: this.getCommandBinDir(command) };
    }

    // Windows 仅支持 .cmd/.exe/裸命令，不再走 PowerShell .ps1。
    // npm/yarn/pnpm 生成的 pi.ps1 与 pi.cmd 指向同一个包入口，但 PowerShell 的执行策略、编码和引号规则更复杂；
    // 对桌面端来说，统一使用 cmd shim 能减少检测与 agent 启动路径差异。
    // Windows npm 全局命令通常是 .cmd shim；cmd.exe /s /c 解析这类 shim 时，
    // 即使路径没有空格也必须使用外层引号，
    // 否则 npm 生成的 pi.cmd 可能一直等待而不是返回 --version。
    const isBatchShim = /(?:[\\/]|^)(?:pi|[^\\/]+)\.(?:cmd|bat)$/i.test(command);
    const commandPart = isBatchShim
      ? `"${command.replace(/"/g, '""')}"`
      : this.quoteCmdArgument(command);
    const innerCommand = [commandPart, ...args]
      .map((part, index) => index === 0 ? part : this.quoteCmdArgument(part))
      .join(" ");
    const commandLine = isBatchShim || this.needsCmdQuote(command) ? `"${innerCommand}"` : innerCommand;
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", commandLine],
      shell: false,
      pathPrefix: this.getCommandBinDir(command),
      // 关键：cmd /c 的最后一个参数是完整命令行，里面的引号由 quoteCmdArgument/control 逻辑维护。
      // 若让 Node 再转义一次，`D:\\foo bar\\pi.cmd` 会变成 cmd 无法识别的路径。
      windowsVerbatimArguments: true,
    };
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

  /**
   * 验证用户手动输入的 pi 路径是否可用。
   * 直接对给定路径执行 --version，绕过 getCandidates 的目录扫描，
   * 适用于用户从终端复制完整路径（如 D:\nodejs\pi.cmd）后手动粘贴的场景。
   */
  async validateCustomPath(customPath: string): Promise<PiInstallStatus> {
    const command = this.normalizeCustomPath(customPath);
    if (!command) {
      return { installed: false, searchedDirs: [], error: "请输入 pi.cmd 或 pi 路径。" };
    }
    if (this.isUnsupportedPowerShellShim(command)) return this.unsupportedPowerShellStatus(command);
    if (command.startsWith("wsl://")) {
      const parsed = this.parseWslUrl(command);
      if (!parsed) return { installed: false, searchedDirs: [], error: "Invalid wsl:// URL" };
      return this.checkWslCommand(parsed.distro, parsed.user, parsed.piCommand);
    }
    return this.runCheck(command, []);
  }

  async check(customPath?: string, wslEnabled?: boolean, wslDistro?: string, wslUser?: string): Promise<PiInstallStatus> {
    const normalizedCustomPath = this.normalizeCustomPath(customPath);
    if (normalizedCustomPath && this.isUnsupportedPowerShellShim(normalizedCustomPath)) {
      return this.unsupportedPowerShellStatus(normalizedCustomPath, this.getSearchDirs());
    }
    const command = normalizedCustomPath
      || await this.discoverCommand(wslEnabled, wslDistro, wslUser)
      || this.resolveCommand(customPath, wslEnabled, wslDistro, wslUser);
    const searchedDirs = this.getSearchDirs();

    if (command.startsWith("wsl://")) {
      const parsed = this.parseWslUrl(command);
      if (!parsed) return { installed: false, command, searchedDirs: [], error: "Invalid wsl:// URL" };
      const wslStatus = await this.checkWslCommand(parsed.distro, parsed.user, parsed.piCommand);
      return {
        ...wslStatus,
        command: `wsl -d ${parsed.distro} -u ${parsed.user} ${parsed.piCommand}`,
        searchedDirs: [],
      };
    }

    return this.runCheck(command, searchedDirs);
  }

  /**
   * 使用系统命令发现 pi 的真实入口。
   * Windows 优先 where.exe pi.cmd，Unix 使用 which pi；失败时由 check() 回退目录扫描。
   */
  async discoverCommand(wslEnabled?: boolean, wslDistro?: string, wslUser?: string): Promise<string | undefined> {
    if (wslEnabled && process.platform === "win32" && wslDistro && wslUser) {
      return this.resolveWslCommand(wslDistro, wslUser);
    }

    const env = this.createProcessEnv();
    if (process.platform === "win32") {
      const whereExe = join(process.env.SystemRoot || "C:\\Windows", "System32", "where.exe");
      const executable = existsSync(whereExe) ? whereExe : "where.exe";
      for (const name of ["pi.cmd", "pi.exe", "pi"]) {
        const found = await new Promise<string | undefined>((resolve) => {
          execFile(executable, [name], {
            env,
            windowsHide: true,
            timeout: 3_000,
            encoding: "utf8",
          }, (error, stdout) => {
            if (error) {
              resolve(undefined);
              return;
            }
            const command = stdout
              .split(/\r?\n/)
              .map(line => line.trim())
              .find(line => line && existsSync(line) && !line.toLowerCase().endsWith(".ps1"));
            resolve(command);
          });
        });
        if (found) return found;
      }
      return undefined;
    }

    return new Promise<string | undefined>((resolve) => {
      execFile("which", ["pi"], {
        env,
        windowsHide: true,
        timeout: 3_000,
        encoding: "utf8",
      }, (error, stdout) => {
        if (error) {
          resolve(undefined);
          return;
        }
        const command = stdout
          .split(/\r?\n/)
          .map(line => line.trim())
          .find(line => line && existsSync(line));
        resolve(command);
      });
    });
  }

  /**
   * 归一化用户粘贴的路径：去除首尾引号，兼容 JSON 风格双反斜杠，并在 Windows 下优先补全同目录 pi.cmd。
   * 这样 UI 校验、settings 保存和 agent 启动都使用同一条路径规则，避免不同入口行为不一致。
   */
  normalizeCustomPath(rawPath?: string) {
    let value = rawPath?.trim() ?? "";
    if (!value) return "";

    const quotePairs: Array<[string, string]> = [["\"", "\""], ["'", "'"], ["“", "”"], ["‘", "’"]];
    let stripped = true;
    while (stripped && value.length >= 2) {
      stripped = false;
      for (const [left, right] of quotePairs) {
        if (value.startsWith(left) && value.endsWith(right)) {
          value = value.slice(left.length, -right.length).trim();
          stripped = true;
        }
      }
    }

    if (process.platform === "win32") {
      // 用户从 JSON/日志里复制时可能得到 D:\\foo\\pi.cmd；只在疑似 Windows 盘符/UNC 路径时折叠双反斜杠。
      if (/^(?:[a-zA-Z]:\\\\|\\\\\\\\)/.test(value)) {
        value = value.replace(/\\\\/g, "\\");
      }

      // npm 有时同时生成无扩展名脚本和 .cmd；Windows 启动 agent 时优先使用 .cmd shim，
      // 可避免裸 `pi` 被当作 shell 内部命令或文本文件处理。
      if (!extname(value)) {
        const cmdCandidate = `${value}.cmd`;
        if (existsSync(cmdCandidate)) return cmdCandidate;
        const exeCandidate = `${value}.exe`;
        if (existsSync(exeCandidate)) return exeCandidate;
      }
    }

    return value;
  }

  private isUnsupportedPowerShellShim(command: string) {
    return process.platform === "win32" && command.trim().toLowerCase().endsWith(".ps1");
  }

  private unsupportedPowerShellStatus(
    command: string,
    searchedDirs: string[] = [],
  ): PiInstallStatus {
    return {
      installed: false,
      command,
      searchedDirs,
      error: "暂不支持 PowerShell 的 pi.ps1，请使用 CMD 的 where pi 查到的 pi.cmd 或 pi.exe 路径。",
    };
  }

  /**
   * 执行 --version 轻量健康检查：验证可执行文件发现和 Node shim 启动是否正常。
   * validateCustomPath 和 check 共用此方法，仅 searchedDirs 有差异：
   * - validateCustomPath: searchedDirs 为空（用户已手动指定路径）
   * - check: searchedDirs 为自动扫描的目录列表
   *
   * 使用 encoding: 'buffer' 避免 Windows 中文环境下 stderr 的 GBK 输出被 utf8 错误解码导致乱码。
   */
  private async runCheck(command: string, searchedDirs: string[]): Promise<PiInstallStatus> {
    const maxAttempts = process.platform === "win32" ? 2 : 1;
    // pi CLI 启动时会加载 provider 和扩展，Windows Electron 环境下首次启动可能超过 8 秒。
    const timeoutMs = 20_000;

    return new Promise(resolve => {
      const runAttempt = (attempt: number) => {
        const invocation = this.createInvocation(command, ["--version"]);
        execFile(invocation.command, invocation.args, {
          env: this.createProcessEnv(undefined, invocation.pathPrefix, invocation.wsl),
          shell: invocation.shell,
          windowsHide: true,
          timeout: timeoutMs,
          encoding: 'buffer',
          windowsVerbatimArguments: invocation.windowsVerbatimArguments,
        }, (error, stdout, stderr) => {
          if (error) {
            // Windows 上 cmd shim 偶发会在进程创建/退出竞态中返回空 stderr；
            // 短退避重试一次，避免一次瞬态失败直接阻断 Pi 更新检查。
            if (attempt < maxAttempts) {
              setTimeout(() => runAttempt(attempt + 1), 250);
              return;
            }

            // 优先使用 stderr 中的实际错误信息（如"系统找不到指定的文件"），
            // 并处理 Windows GBK 编码问题。兜底用 error.message，但补充退出码/超时
            // 信息，避免日志只剩一条无法区分原因的完整 cmd 命令行。
            const childError = error as NodeJS.ErrnoException & {
              killed?: boolean;
              signal?: string;
            };
            const stderrText = this.decodeBuffer(stderr).trim();
            const detail = stderrText || this.cleanExecError(error.message);
            const code = childError.code ? ` [${childError.code}]` : "";
            const killed = childError.killed ? "（进程被终止）" : "";
            const signal = childError.signal ? `（signal: ${childError.signal}）` : "";
            resolve({
              installed: false,
              command,
              searchedDirs,
              error: `${detail}${code}${killed}${signal}`,
            });
            return;
          }

          const version = this.decodeBuffer(stdout).trim();
          resolve({ installed: true, command, searchedDirs, version });
        });
      };

      runAttempt(1);
    });
  }

  /**
   * 尝试在 WSL 中检测 pi 是否可用。
   * 返回 "wsl://<distro>/<user>/pi" 标记字符串，供 resolveCommand/createInvocation 识别。
   */
  /**
   * wsl.exe 完整路径。32 位进程在 64 位 Windows 上访问 System32 会被文件系统重定向到
   * SysWOW64，而 wsl.exe 仅存在于真实 System32 中。使用 Sysnative 别名绕过重定向。
   */
  /**
   * wsl.exe 完整路径（优先绝对路径，fopen 失败时回退到 PATH）。
   * 32 位进程在 64 位 Windows 上访问 System32 会被文件系统重定向，
   * Sysnative 别名可绕过；若均不可用则通过 shell PATH 查找。
   */
  private resolveWslExe(): { command: string; shell: boolean } {
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    // 尝试真实 System32（通过 Sysnative 处理 32-bit 重定向）
    const candidates = process.arch === "ia32"
      ? [join(systemRoot, "Sysnative", "wsl.exe"), join(systemRoot, "System32", "wsl.exe")]
      : [join(systemRoot, "System32", "wsl.exe")];
    for (const candidate of candidates) {
      const ok = existsSync(candidate);
      console.log('[PiLocator] resolveWslExe candidate:', candidate, 'exists:', ok);
      if (ok) return { command: candidate, shell: false };
    }
    // 绝对路径均不存在：通过 cmd.exe PATH 查找 wsl.exe
    console.log('[PiLocator] resolveWslExe fallback: shell mode with "wsl"');
    return { command: "wsl", shell: true };
  }
  /** @deprecated 使用 resolveWslExe() 代替，支持 PATH 回退 */
  private get wslExePath(): string {
    return this.resolveWslExe().command;
  }

  /**
   * 解析 "wsl://<distro>/<user>/<piCommand>" 格式的 URL。
   * 使用正则代替 .split("/") 避免 wsl:// 的双斜杠产生空字符串元素导致解析错位。
   */
  private parseWslUrl(url: string): { distro: string; user: string; piCommand: string } | null {
    const match = url.match(/^wsl:\/\/([^/]+)\/([^/]+)\/(.+)$/);
    if (!match) return null;
    return { distro: match[1], user: match[2], piCommand: match[3] };
  }

  private resolveWslCommand(distro: string, user: string): string | undefined {
    try {
      const wslExe = this.resolveWslExe();
      const wslArgs = ["-d", distro, "-u", user, "which", "pi"];
      const result = execFileSync(wslExe.command, wslArgs, {
        encoding: "utf8",
        timeout: 8_000,
        windowsHide: true,
        shell: wslExe.shell,
      }).trim();
      if (result && result.length > 0 && !result.includes("not found")) {
        return `wsl://${distro}/${user}/pi`;
      }
    } catch {
      // WSL 不可用或未安装 pi，静默忽略，回退到普通 "pi"
    }
    return undefined;
  }

  private checkWslCommand(distro: string, user: string, piCommand: string): Promise<PiInstallStatus> {
    return new Promise(resolve => {
      const wslExe = this.resolveWslExe();
      const wslArgs = ["-d", distro, "-u", user, piCommand, "--version"];
      execFile(wslExe.command, wslArgs, {
        env: this.createProcessEnv(undefined, undefined, { distro, user, piCommand }),
        shell: wslExe.shell,
        windowsHide: true,
        timeout: 8_000,
        encoding: "utf8",
      }, (error, stdout, stderr) => {
        if (error) {
          const raw = stderr?.trim() || this.cleanExecError(error.message);
          resolve({ installed: false, searchedDirs: [], error: raw });
          return;
        }
        resolve({ installed: true, command: `wsl -d ${distro} -u ${user} ${piCommand}`, version: stdout.trim(), searchedDirs: [] });
      });
    });
  }

  private decodeBuffer(buf: Buffer | null): string {
    if (!buf || buf.length === 0) return '';
    const utf8 = buf.toString('utf8');
    // UTF-8 解码后不含 Unicode 替换字符（\ufffd），说明解码正确
    if (!utf8.includes('\ufffd')) return utf8;
    // Windows 中文环境下，cmd/powershell 的错误输出通常是 GBK (codepage 936)
    try {
      return new TextDecoder('gbk', { fatal: false }).decode(buf);
    } catch {
      // 极少数环境不支持 gbk TextDecoder（如某些精简 Node.js），保留原始字节
      return buf.toString('latin1');
    }
  }

  /**
   * 清理 execFile 默认错误消息，去掉冗余的 "Command failed: ..." 命令行前缀，
   * 只保留有意义的错误描述。
   */
  private cleanExecError(message: string): string {
    // Node.js execFile 错误格式："Command failed: powershell.exe ..."
    // 去掉前缀，只保留后半段或返回简洁提示
    const cleaned = message.replace(/^Command failed:\s*/i, '').trim();
    // 如果去掉前缀后仍是完整命令行（太长），截断为友好提示
    if (cleaned.length > 120) {
      return cleaned.slice(0, 100) + '…';
    }
    return cleaned;
  }

  private quoteCmdArgument(value: string) {
    if (!this.needsCmdQuote(value)) return value;
    return `"${value.replace(/"/g, '""')}"`;
  }

  private needsCmdQuote(value: string) {
    return /[\s&()\[\]{}^=;!'+,`~|<>]/.test(value);
  }

  private getCommandBinDir(command: string) {
    if (!/[\\/]/.test(command) || !existsSync(command)) return undefined;
    const binDir = dirname(command);
    // npm/nvm/asdf/mise shims resolve Node through env/PATH. Prepending the shim's own
    // bin directory keeps that lookup on the Node version that installed pi, instead
    // of a different Node inherited from Finder/Explorer/Electron.
    const nodeName = process.platform === "win32" ? "node.exe" : "node";
    return existsSync(join(binDir, nodeName)) ? binDir : undefined;
  }

  private getCandidates() {
    // Windows 不再自动检测 pi.ps1：PowerShell shim 与 .cmd 指向同一入口，但执行策略/编码/引号规则更复杂。
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
        // Windows 检测链路不再依赖 PowerShell；Explorer 启动的 Electron 通常已经拿到系统合并 PATH，
        // 其他包管理器特殊路径由 getSearchDirs 和用户手动输入兜底。
        return "";
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

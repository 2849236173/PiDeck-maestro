import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitBranchInfo } from "../../shared/types";

const execFileAsync = promisify(execFile);

export class GitService {
  async getBranches(cwd: string): Promise<GitBranchInfo> {
    try {
      const [{ stdout: currentRaw }, { stdout: branchesRaw }] = await Promise.all([
        execFileAsync("git", ["branch", "--show-current"], { cwd }),
        execFileAsync("git", ["branch", "--format=%(refname:short)"], { cwd }),
      ]);

      const current = currentRaw.trim() || null;
      const branches = branchesRaw.split(/\r?\n/).map(branch => branch.trim()).filter(Boolean);
      return { current, branches };
    } catch {
      // 非 Git 目录或未安装 git 时只返回空信息，UI 可以降级展示为 no git。
      return { current: null, branches: [] };
    }
  }

  async checkout(cwd: string, branch: string): Promise<GitBranchInfo> {
    // 分支切换会改变工作区状态，先只支持切换已有本地分支，避免隐式创建或修改远端跟踪关系。
    await execFileAsync("git", ["checkout", branch], { cwd });
    return this.getBranches(cwd);
  }
}

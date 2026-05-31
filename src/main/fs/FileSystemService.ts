import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { FileTreeNode } from "../../shared/types";

const ignoredNames = new Set([".git", "node_modules", "dist", "build", ".next", "coverage", ".venv", "__pycache__"]);

export class FileSystemService {
  async listTree(root: string, maxDepth = 2): Promise<FileTreeNode[]> {
    return this.readDirectory(root, root, 0, maxDepth);
  }

  private async readDirectory(root: string, current: string, depth: number, maxDepth: number): Promise<FileTreeNode[]> {
    const entries = await readdir(current, { withFileTypes: true });
    const nodes: FileTreeNode[] = [];

    for (const entry of entries) {
      if (ignoredNames.has(entry.name)) continue;

      const absolutePath = join(current, entry.name);
      const relativePath = relative(root, absolutePath).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        nodes.push({
          name: entry.name,
          path: absolutePath,
          relativePath,
          type: "directory",
          // 第一版限制深度，避免打开大仓库时一次性读取过多目录导致 UI 卡顿。
          children: depth < maxDepth ? await this.readDirectory(root, absolutePath, depth + 1, maxDepth) : [],
        });
      } else if (entry.isFile()) {
        nodes.push({
          name: entry.name,
          path: absolutePath,
          relativePath,
          type: "file",
        });
      }
    }

    return nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }
}

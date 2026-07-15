import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    // Windows 上 localhost 可能优先解析到 IPv6 ::1，Electron 加载 dev server 时会超时；固定 IPv4 保证本机访问稳定。
    server: {
      host: "127.0.0.1",
      // 5173 落在部分 Windows/Hyper-V 动态端口排除范围内时会 EACCES；使用相邻的未保留端口保证 dev server 可监听。
      port: 5181,
    },
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
        "@shared": resolve("src/shared"),
      },
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        // 多入口：主窗口 index.html + 桌面宠物悬浮窗 pet.html
        input: {
          index: resolve("src/renderer/index.html"),
          pet: resolve("src/renderer/pet.html"),
        },
        output: {
          // 将大体积的第三方依赖拆分为独立 chunk，减少首屏需要加载和解析的 JS 体积。
          // 拆分策略：React 全家桶、Monaco Editor、图标库、Markdown 渲染栈各归一类。
          // 利用 Rollup 的 chunk 缓存机制：vendor 不变时浏览器复用缓存，加快二次加载。
          // Mermaid 已在渲染层用 dynamic import 惰性加载，此处不额外聚合，避免破坏已有 code splitting。
          manualChunks(id) {
            if (id.includes("/node_modules/react/") || id.includes("/node_modules/react-dom/") || id.includes("/node_modules/scheduler/")) {
              return "vendor-react";
            }
            if (id.includes("/node_modules/monaco-editor/")) {
              return "vendor-monaco";
            }
            if (id.includes("/node_modules/lucide-react/")) {
              return "vendor-icons";
            }
            if (id.includes("/node_modules/react-markdown/") || id.includes("/node_modules/remark-") || id.includes("/node_modules/rehype-") || id.includes("/node_modules/unified/") || id.includes("/node_modules/katex/") || id.includes("/node_modules/mdast-") || id.includes("/node_modules/hast-") || id.includes("/node_modules/micromark-") || id.includes("/node_modules/vfile") || id.includes("/node_modules/unist-") || id.includes("/node_modules/trough") || id.includes("/node_modules/bail") || id.includes("/node_modules/dequal") || id.includes("/node_modules/devlop") || id.includes("/node_modules/html-to-image/")) {
              return "vendor-markdown";
            }
          },
        },
      },
    },
  },
});
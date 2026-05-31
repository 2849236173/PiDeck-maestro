import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";
import { is } from "@electron-toolkit/utils";
import { ipcChannels } from "../shared/ipc";
import type { CreateAgentInput, SendPromptInput } from "../shared/types";
import { ProjectStore } from "./projects/ProjectStore";
import { FileSystemService } from "./fs/FileSystemService";
import { AgentManager } from "./pi/AgentManager";
import { SessionScanner } from "./sessions/SessionScanner";
import { SettingsStore } from "./settings/SettingsStore";
import { GitService } from "./git/GitService";

let mainWindow: BrowserWindow | null = null;
let projectStore: ProjectStore;
let fileSystemService: FileSystemService;
let sessionScanner: SessionScanner;
let settingsStore: SettingsStore;
let gitService: GitService;
let agentManager: AgentManager;

function createWindow() {
  const windowOptions = settingsStore.createWindowOptions();

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 660,
    title: "",
    frame: windowOptions.frame,
    titleBarStyle: windowOptions.titleBarStyle,
    trafficLightPosition: windowOptions.trafficLightPosition,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function registerIpc() {
  ipcMain.handle(ipcChannels.projectsList, () => projectStore.list());
  ipcMain.handle(ipcChannels.projectsAdd, async () => projectStore.chooseAndAdd());
  ipcMain.handle(ipcChannels.projectsRemove, async (_event, id: string) => {
    await projectStore.remove(id);
    return projectStore.list();
  });

  ipcMain.handle(ipcChannels.filesList, async (_event, projectId: string) => {
    const project = projectStore.get(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    return fileSystemService.listTree(project.path);
  });

  ipcMain.handle(ipcChannels.filesOpen, async (_event, path: string) => {
    await shell.openPath(path);
  });

  ipcMain.handle(ipcChannels.filesShowInFolder, async (_event, path: string) => {
    shell.showItemInFolder(path);
  });

  ipcMain.handle(ipcChannels.sessionsList, async (_event, projectId?: string) => {
    const project = projectId ? projectStore.get(projectId) : undefined;
    return sessionScanner.list(project?.path);
  });

  ipcMain.handle(ipcChannels.gitBranches, async (_event, projectId: string) => {
    const project = projectStore.get(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    return gitService.getBranches(project.path);
  });

  ipcMain.handle(ipcChannels.gitCheckout, async (_event, projectId: string, branch: string) => {
    const project = projectStore.get(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    return gitService.checkout(project.path, branch);
  });

  ipcMain.handle(ipcChannels.settingsGet, () => settingsStore.get());
  ipcMain.handle(ipcChannels.settingsUpdate, async (_event, patch) => {
    const settings = await settingsStore.update(patch);
    settingsStore.notifyTitleBarChange(mainWindow);
    return settings;
  });

  ipcMain.handle(ipcChannels.agentsList, () => agentManager.list());
  ipcMain.handle(ipcChannels.agentsCreate, (_event, input: CreateAgentInput) => agentManager.create(input));
  ipcMain.handle(ipcChannels.agentsStop, (_event, agentId: string) => agentManager.stop(agentId));
  ipcMain.handle(ipcChannels.agentsPrompt, (_event, input: SendPromptInput) => agentManager.sendPrompt(input));
  ipcMain.handle(ipcChannels.agentsExportHtml, (_event, agentId: string) => agentManager.exportHtml(agentId));
  ipcMain.handle(ipcChannels.agentsReload, (_event, agentId: string) => agentManager.reload(agentId));
  ipcMain.handle(ipcChannels.agentsRuntimeState, (_event, agentId: string) => agentManager.getRuntimeState(agentId));
  ipcMain.handle(ipcChannels.agentsCycleModel, (_event, agentId: string) => agentManager.cycleModel(agentId));
  ipcMain.handle(ipcChannels.agentsAvailableModels, (_event, agentId: string) => agentManager.getAvailableModels(agentId));
  ipcMain.handle(ipcChannels.agentsSetModel, (_event, agentId: string, provider: string, modelId: string) => agentManager.setModel(agentId, provider, modelId));
  ipcMain.handle(ipcChannels.agentsCycleThinking, (_event, agentId: string) => agentManager.cycleThinking(agentId));
  ipcMain.handle(ipcChannels.agentsSetThinking, (_event, agentId: string, level: string) => agentManager.setThinking(agentId, level));
  ipcMain.handle("agents:commands", (_event, agentId: string) => agentManager.getCommands(agentId));
}

app.whenReady().then(async () => {
  projectStore = new ProjectStore();
  fileSystemService = new FileSystemService();
  sessionScanner = new SessionScanner();
  settingsStore = new SettingsStore();
  gitService = new GitService();
  agentManager = new AgentManager(id => projectStore.get(id), () => mainWindow);

  await Promise.all([projectStore.load(), settingsStore.load()]);
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  agentManager?.stopAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

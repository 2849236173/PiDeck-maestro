/**
 * NSIS preInit hook: 检测并静默卸载旧版 PiDeck（appId com.ayuayue.pi-desktop）。
 *
 * 为什么需要这个：
 *   v0.6.6.15 将 appId 从 com.ayuayue.pi-desktop 改为 com.personal.pideck-maestro。
 *   由于 appId 不同，Windows Add/Remove Programs 不会自动识别为"同一种应用"，
 *   导致 NSIS 安装新版本时不会先卸载旧版，两个安装并存。
 *   这个钩子在文件复制之前，先找旧版的卸载字符串，然后静默执行卸载。
 *
 * electron-builder 会自动在 !include 时注入：
 *   - ${INSTALL_REGISTRY_KEY}  → "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.personal.pideck-maestro"
 *   - $appExe                 → 新版 exe 路径
 *   - $installMode             → "currentuser" | "allusers"
 *   - ${isDeleteAppData}       → NSIS 变量
 *
 * 旧 appId 的注册表路径（需手动搜索，因为 ${INSTALL_REGISTRY_KEY} 只针对新版 appId）：
 *   HKLM / HKCU \SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\com.ayuayue.pi-desktop
 *   HKLM / HKCU \SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\com.ayuayue.pi-desktop
 */
!macro preInit

  ; ---------------------------------------------------------------
  ; 搜索旧版 PiDeck（com.ayuayue.pi-desktop）的 UninstallString
  ; 32-bit view
  ; ---------------------------------------------------------------
  SetRegView 32

  ; HKCU 32-bit
  ReadRegStr $0 HKCU "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\com.ayuayue.pi-desktop" "UninstallString"
  ${If} $0 != ""
    DetailPrint "Found old PiDeck (32-bit HKCU), uninstalling silently..."
    ExecWait '$0 /S /CURRENTUSER /NORESTART'
  ${EndIf}

  ; HKLM 32-bit
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\com.ayuayue.pi-desktop" "UninstallString"
  ${If} $0 != ""
    DetailPrint "Found old PiDeck (32-bit HKLM), uninstalling silently..."
    ExecWait '$0 /S /ALLUSERS /NORESTART'
  ${EndIf}

  ; HKLM WOW6432Node (32-bit app on 64-bit Windows)
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\com.ayuayue.pi-desktop" "UninstallString"
  ${If} $0 != ""
    DetailPrint "Found old PiDeck (WOW6432Node), uninstalling silently..."
    ExecWait '$0 /S /ALLUSERS /NORESTART'
  ${EndIf}

  ; ---------------------------------------------------------------
  ; 搜索旧版 PiDeck（com.ayuayue.pi-desktop）的 UninstallString
  ; 64-bit view
  ; ---------------------------------------------------------------
  SetRegView 64

  ; HKCU 64-bit
  ReadRegStr $0 HKCU "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\com.ayuayue.pi-desktop" "UninstallString"
  ${If} $0 != ""
    DetailPrint "Found old PiDeck (64-bit HKCU), uninstalling silently..."
    ExecWait '$0 /S /CURRENTUSER /NORESTART'
  ${EndIf}

  ; HKLM 64-bit
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\com.ayuayue.pi-desktop" "UninstallString"
  ${If} $0 != ""
    DetailPrint "Found old PiDeck (64-bit HKLM), uninstalling silently..."
    ExecWait '$0 /S /ALLUSERS /NORESTART'
  ${EndIf}

  ; ---------------------------------------------------------------
  ; 清理旧版注册表残留（可选，减少 Add/Remove Programs 列表噪音）
  ; ---------------------------------------------------------------
  SetRegView 32
  DeleteRegKey HKCU "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\com.ayuayue.pi-desktop"
  DeleteRegKey HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\com.ayuayue.pi-desktop"
  DeleteRegKey HKLM "SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\com.ayuayue.pi-desktop"

  SetRegView 64
  DeleteRegKey HKCU "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\com.ayuayue.pi-desktop"
  DeleteRegKey HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\com.ayuayue.pi-desktop"

  ; 恢复默认 registry view
  SetRegView 64

!macroend

; VOR Windows installer (Inno Setup)
; Built by .github/workflows/build-windows.yml with /DAppBase /DOutputName
#ifndef AppBase
#define AppBase "VOR"
#endif
#ifndef AppVersion
#define AppVersion "1.0.0"
#endif

[Setup]
AppId={{7C1F5B7E-8E0D-4A6F-9C3A-VOR00000001}
AppName={#AppBase}
AppVersion={#AppVersion}
AppPublisher=VOR Engineering (Admin)
DefaultDirName={autopf}\{#AppBase}
DefaultGroupName={#AppBase}
OutputBaseFilename={#OutputName}
Compression=lzma2/max
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
PrivilegesRequired=admin

[Files]
Source: "stage\{#AppBase}\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\{#AppBase}"; Filename: "{app}\{#AppBase}.exe"
Name: "{autodesktop}\{#AppBase}"; Filename: "{app}\{#AppBase}.exe"; Tasks: desktop

[Tasks]
Name: "desktop"; Description: "Create desktop shortcut"; Flags: unchecked

[Run]
Filename: "{app}\{#AppBase}.exe"; Description: "Launch {#AppBase}"; Flags: nowait postinstall skipifsilent

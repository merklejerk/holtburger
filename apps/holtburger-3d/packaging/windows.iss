; Install one verified release payload. User profiles and game assets live elsewhere.
#ifndef PayloadDir
  #error PayloadDir is required
#endif
#ifndef InstallerAppId
  #error InstallerAppId is required
#endif
#ifndef DisplayName
  #error DisplayName is required
#endif
#ifndef ReleaseVersion
  #error ReleaseVersion is required
#endif
#ifndef NumericVersion
  #error NumericVersion is required
#endif
#ifndef InstallerName
  #error InstallerName is required
#endif
#ifndef InstallerDir
  #error InstallerDir is required
#endif

[Setup]
AppId={#InstallerAppId}
AppName={#DisplayName}
AppVersion={#ReleaseVersion}
VersionInfoVersion={#NumericVersion}
DefaultDirName={localappdata}\Programs\{#DisplayName}
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#InstallerDir}
OutputBaseFilename={#InstallerName}
UninstallDisplayIcon={app}\payload\h3d\holtburger-3d.exe
UninstallDisplayName={#DisplayName}
; Fixtures exercise installation behavior with the full payload, without recompressing Electron.
#ifdef FixtureInstaller
Compression=none
SolidCompression=no
#else
Compression=lzma2
SolidCompression=yes
#endif
CloseApplications=no
RestartApplications=no
DisableProgramGroupPage=yes
WizardStyle=modern

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}\payload"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\{#DisplayName}"; Filename: "{app}\payload\h3d\holtburger-3d.exe"

[Code]
#if Ver < EncodeVer(7, 0, 0)
type
  { Inno 6 runs a 32-bit installer VM even when installing a 64-bit payload. }
  NativeUInt = LongWord;
#endif

const
  { Windows file attributes, delete access, and sharing flags. }
  DirectoryAttribute = $10;
  ReparsePointAttribute = $400;
  DeleteAccess = $10000;
  ShareReadWriteDelete = 7;
  OpenExisting = 3;

function OpenForDeletion(FileName: String; DesiredAccess, ShareMode: Cardinal;
  SecurityAttributes: NativeUInt; CreationDisposition, Flags: Cardinal;
  TemplateFile: NativeUInt): NativeUInt;
  external 'CreateFileW@kernel32.dll stdcall';
function CloseFileHandle(Handle: NativeUInt): Boolean;
  external 'CloseHandle@kernel32.dll stdcall';

{ Preflight never edits files. Reject links and locks before removing the owned payload. }
function CheckPayload(const Directory: String): String;
var
  Entry: TFindRec;
  Path: String;
  Handle: NativeUInt;
begin
  Result := '';
  if not DirExists(Directory) then exit;
  if not FindFirst(Directory, Entry) then
    RaiseException('Cannot inspect the installed payload directory: ' + Directory);
  try
    if (Entry.Attributes and ReparsePointAttribute) <> 0 then begin
      Result := 'The program payload must not be a link: ' + Directory;
      exit;
    end;
  finally
    FindClose(Entry);
  end;
  if not FindFirst(Directory + '\*', Entry) then
    RaiseException('Cannot inspect the installed payload: ' + Directory);
  try
    repeat
      if (Entry.Name <> '.') and (Entry.Name <> '..') then begin
        Path := Directory + '\' + Entry.Name;
        if (Entry.Attributes and ReparsePointAttribute) <> 0 then begin
          Result := 'Remove the link from the program payload before continuing: ' + Path;
          exit;
        end;
        if (Entry.Attributes and DirectoryAttribute) <> 0 then
          Result := CheckPayload(Path)
        else begin
          { Readers sharing deletion do not prevent whole-payload replacement.
            Ask for the delete access cleanup needs; never open payload files for writing. }
          Handle := OpenForDeletion(Path, DeleteAccess, ShareReadWriteDelete, 0, OpenExisting, 0, 0);
          if Handle = NativeUInt(-1) then
            Result := 'Quit Holtburger and its host, then retry. Cannot replace: ' + Path + #13#10 + SysErrorMessage(DLLGetLastError)
          else if not CloseFileHandle(Handle) then
            RaiseException('Cannot close the payload preflight handle: ' + Path);
        end;
        if Result <> '' then exit;
      end;
    until not FindNext(Entry);
  finally
    FindClose(Entry);
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  NeedsRestart := False;
  Result := CheckPayload(ExpandConstant('{app}\payload'));
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Payload: String;
begin
  if CurStep = ssInstall then begin
    Payload := ExpandConstant('{app}\payload');
    { Check again immediately before cleanup. Never schedule a mixed install for reboot. }
    if CheckPayload(Payload) <> '' then
      RaiseException('The installed payload became unavailable. Quit Holtburger and retry.');
    if DirExists(Payload) and not DelTree(Payload, True, True, True) then
      RaiseException('Cannot remove the old program payload. Rerun setup to repair.');
  end;
end;

function InitializeUninstall: Boolean;
var
  Failure: String;
begin
  Failure := CheckPayload(ExpandConstant('{app}\payload'));
  Result := Failure = '';
  if not Result then begin
    Log(Failure);
    if not UninstallSilent then MsgBox(Failure, mbError, MB_OK);
  end;
end;

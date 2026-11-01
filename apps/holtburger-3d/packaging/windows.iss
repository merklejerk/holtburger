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
Compression=lzma2
SolidCompression=yes
CloseApplications=no
RestartApplications=no
DisableProgramGroupPage=yes
WizardStyle=modern

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}\payload"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\{#DisplayName}"; Filename: "{app}\payload\h3d\holtburger-3d.exe"

[Code]
const
  { Windows file attributes and Delphi stream access/share modes. }
  DirectoryAttribute = $10;
  ReparsePointAttribute = $400;
  OpenReadWriteExclusive = $12;

{ Preflight never edits files. Reject links and locks before removing the owned payload. }
function CheckPayload(const Directory: String): String;
var
  Entry: TFindRec;
  Path: String;
  Stream: TFileStream;
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
          try
            Stream := TFileStream.Create(Path, OpenReadWriteExclusive);
            Stream.Free;
          except
            Result := 'Quit Holtburger and its host, then retry. Cannot replace: ' + Path + #13#10 + GetExceptionMessage;
          end;
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

; CactusPOS setup program for Windows 10 and 11 (64-bit): one file a person double-clicks.
; Built with Inno Setup 6 by `node scripts/make-setup.mjs`, which passes the three values below:
;   ISCC /DAppVersion=0.2.0 /DStage=<dist\redist\CactusPOS> /DOutDir=<dist\redist> ops\windows\setup.iss
;
; What the setup does on the computer:
;   1. Checks the computer: Windows 10 (1809) or newer, 64-bit; says so when neither Edge nor Chrome is there.
;   2. Stops a CactusPOS that is running from an earlier install, and copies the ready-made package (program,
;      libraries, screens, its own Node.js, the manual) to %LOCALAPPDATA%\Programs\CactusPOS.
;   3. Runs ops\windows\install.ps1 for the settings and the shortcuts.
;   4. Asks Windows, with its one permission question, to let tablets and phones on the local network reach the till.
;   5. Offers to start the till.
; It installs for the signed-in Windows user and needs no administrator rights apart from step 4.
; Sales data lives in %LOCALAPPDATA%\CactusPOS, outside the program folder: updating and removing never touch it.
;
; Keep this file plain ASCII: Inno Setup reads a file without a byte order mark in the Windows code page.
;
; For checking the setup without touching this Windows user's real shortcuts, firewall or sales data:
;   set CACTUS_HOME=<empty folder>
;   CactusPOS-Setup-x.y.z.exe /VERYSILENT /DIR=<folder> /SHORTCUTROOT=<folder> /PORT=3190 /LOG=<file>
; /SHORTCUTROOT puts the shortcuts under that folder, skips the firewall and leaves no entry under Apps.
; Remove such a copy with <folder>\unins000.exe /VERYSILENT (it remembers the shortcut folder).

#ifndef AppVersion
  #error AppVersion is not set. Build the setup with: node scripts/make-setup.mjs
#endif
#ifndef Stage
  #error Stage (the ready-made package folder) is not set. Build the setup with: node scripts/make-setup.mjs
#endif
#ifndef OutDir
  #define OutDir Stage + "\.."
#endif

[Setup]
; Never change AppId: Windows recognises an update of the same program by it.
AppId={{9CF29B2F-ABE4-4B03-8AA8-0D0EFDF176B1}
AppName=CactusPOS
AppVersion={#AppVersion}
AppVerName=CactusPOS {#AppVersion}
AppPublisher=CactusPOS
AppPublisherURL=https://github.com/Pyrodrifter/CactusPOS
VersionInfoVersion={#AppVersion}
VersionInfoDescription=CactusPOS setup
DefaultDirName={localappdata}\Programs\CactusPOS
; Nothing to choose: no folder page, no Start menu page, no "ready" page.
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableWelcomePage=no
DisableReadyPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; The shortcuts start the launcher through "conhost --headless", which Windows has since version 1809.
MinVersion=10.0.17763
OutputDir={#OutDir}
OutputBaseFilename=CactusPOS-Setup-{#AppVersion}
SetupIconFile=cactuspos.ico
UninstallDisplayIcon={app}\ops\windows\cactuspos.ico
UninstallDisplayName=CactusPOS
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ShowLanguageDialog=yes
; The server is stopped by stop.ps1 (see PrepareToInstall); Windows' own "close these programs" page would only confuse.
CloseApplications=no
RestartApplications=no
SetupLogging=yes
CreateUninstallRegKey=not IsTestInstall

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "nl"; MessagesFile: "compiler:Languages\Dutch.isl"

[Messages]
en.WelcomeLabel2=This puts [name/ver] on this computer: the till and everything it needs. Nothing else has to be installed, and no internet is needed.%n%nIt takes about a minute. Near the end Windows asks once for permission, so that a kitchen tablet and phones can connect to the till: choose Yes.%n%nSales that are already on this computer are kept.
nl.WelcomeLabel2=Hiermee komt [name/ver] op deze computer: de kassa en alles wat daarvoor nodig is. U hoeft niets anders te installeren en er is geen internet nodig.%n%nHet duurt ongeveer een minuut. Tegen het einde vraagt Windows een keer om toestemming, zodat een keukentablet en telefoons verbinding kunnen maken met de kassa: kies Ja.%n%nVerkopen die al op deze computer staan, blijven bewaard.
en.FinishedLabelNoIcons=[name] is on this computer now. Start the till with the CactusPOS icon on the Desktop.%n%nOn a new till, sign in with PIN 1234. Then give every person a PIN of their own under Admin, Staff.%n%nThe manual is in the Start menu, under CactusPOS.
en.FinishedLabel=[name] is on this computer now. Start the till with the CactusPOS icon on the Desktop.%n%nOn a new till, sign in with PIN 1234. Then give every person a PIN of their own under Admin, Staff.%n%nThe manual is in the Start menu, under CactusPOS.
nl.FinishedLabelNoIcons=[name] staat nu op deze computer. Start de kassa met het CactusPOS-pictogram op het bureaublad.%n%nBij een nieuwe kassa logt u in met pincode 1234. Geef daarna iedereen een eigen pincode onder Beheer, Personeel.%n%nDe handleiding vindt u in het menu Start, onder CactusPOS.
nl.FinishedLabel=[name] staat nu op deze computer. Start de kassa met het CactusPOS-pictogram op het bureaublad.%n%nBij een nieuwe kassa logt u in met pincode 1234. Geef daarna iedereen een eigen pincode onder Beheer, Personeel.%n%nDe handleiding vindt u in het menu Start, onder CactusPOS.
en.WizardSelectTasks=One choice
nl.WizardSelectTasks=Een keuze
en.SelectTasksDesc=Should the till start by itself?
nl.SelectTasksDesc=Moet de kassa vanzelf starten?
en.SelectTasksLabel2=Leave the box ticked on the computer that is the till. Then click Next: the installation starts.
nl.SelectTasksLabel2=Laat het vakje aangevinkt op de computer die de kassa is. Klik daarna op Volgende: de installatie begint.
en.ClickFinish=Click Finish to close this window.
nl.ClickFinish=Klik op Voltooien om dit venster te sluiten.
en.ConfirmUninstall=Remove %1 from this computer?%n%nThe sales records and the settings are kept.
nl.ConfirmUninstall=%1 van deze computer verwijderen?%n%nDe verkoopgegevens en de instellingen blijven bewaard.
en.UninstalledAll=%1 was removed from this computer.%n%nThe sales records and the settings were kept. They are in the folder AppData\Local\CactusPOS of your Windows account.
nl.UninstalledAll=%1 is van deze computer verwijderd.%n%nDe verkoopgegevens en de instellingen zijn bewaard. Ze staan in de map AppData\Local\CactusPOS van uw Windows-account.

[CustomMessages]
en.TaskAutostart=Start CactusPOS by itself when this computer is switched on
nl.TaskAutostart=CactusPOS vanzelf starten als deze computer wordt aangezet
en.RunStart=Start CactusPOS now
nl.RunStart=CactusPOS nu starten
en.RunManual=Open the manual
nl.RunManual=De handleiding openen
en.ManualFile=CactusPOS-Manual-English.pdf
nl.ManualFile=CactusPOS-Handleiding-Nederlands.pdf
en.StatusSettingUp=Making the shortcuts and the settings...
nl.StatusSettingUp=Snelkoppelingen en instellingen maken...
en.StatusFirewall=Asking Windows for permission...
nl.StatusFirewall=Windows om toestemming vragen...
en.NoBrowser=CactusPOS shows the till in a window of Microsoft Edge or Google Chrome. Neither was found on this computer.%n%nYou can go on: the till then opens in your normal web browser. For the best result, install Microsoft Edge or Google Chrome afterwards.
nl.NoBrowser=CactusPOS toont de kassa in een venster van Microsoft Edge of Google Chrome. Geen van beide is op deze computer gevonden.%n%nU kunt doorgaan: de kassa opent dan in uw gewone webbrowser. Installeer daarna Microsoft Edge of Google Chrome voor het beste resultaat.
en.FirewallAsk=One more step.%n%nWindows will now ask: "Do you want to allow this app to make changes to your device?"%n%nChoose Yes. This lets a kitchen tablet and phones on your own WiFi reach the till. Nothing is opened to the internet.
nl.FirewallAsk=Nog een stap.%n%nWindows vraagt nu: "Wilt u toestaan dat deze app wijzigingen aan uw apparaat aanbrengt?"%n%nKies Ja. Daardoor kunnen een keukentablet en telefoons op uw eigen wifi bij de kassa. Er wordt niets naar het internet opengezet.
en.FirewallDeclined=Windows did not get permission, so tablets and phones cannot connect to the till yet.%n%nThe till on this computer works normally. To allow tablets later, run this setup program again and choose Yes.
nl.FirewallDeclined=Windows heeft geen toestemming gekregen. Tablets en telefoons kunnen daardoor nog geen verbinding maken met de kassa.%n%nDe kassa op deze computer werkt gewoon. Wilt u later tablets gebruiken, start dit installatieprogramma dan opnieuw en kies Ja.
en.SetupStepFailed=CactusPOS was copied to this computer, but the shortcuts and the settings could not be made.%n%nRun this setup program once more. If it happens again, send this file to the person who helps you with CactusPOS:%n%n%1%n%nOpen that file now?
nl.SetupStepFailed=CactusPOS is naar deze computer gekopieerd, maar de snelkoppelingen en de instellingen konden niet worden gemaakt.%n%nStart dit installatieprogramma nog een keer. Gebeurt het opnieuw, stuur dan dit bestand naar degene die u met CactusPOS helpt:%n%n%1%n%nDit bestand nu openen?

[Tasks]
Name: "autostart"; Description: "{cm:TaskAutostart}"

[Files]
; The whole ready-made package. Its "read me" only explains the zip route.
Source: "{#Stage}\*"; DestDir: "{app}"; Excludes: "\READ ME FIRST.txt"; Flags: recursesubdirs createallsubdirs ignoreversion
; Needed before the files are copied (to stop an earlier copy), so it also travels inside the setup itself.
Source: "stop.ps1"; Flags: dontcopy

[InstallDelete]
; An update must not leave libraries of the previous version behind.
Type: filesandordirs; Name: "{app}\node_modules"
Type: filesandordirs; Name: "{app}\packages"

[INI]
; Read back when CactusPOS is removed (see CurUninstallStepChanged).
Filename: "{app}\setup.ini"; Section: "setup"; Key: "shortcutRoot"; String: "{param:SHORTCUTROOT|}"

[UninstallDelete]
Type: files; Name: "{app}\setup.ini"
Type: files; Name: "{app}\install.log"

[Run]
Filename: "{sys}\conhost.exe"; Parameters: "--headless ""{app}\runtime\node\node.exe"" ""{app}\ops\app\launch.mjs"" --gui"; WorkingDir: "{app}"; Description: "{cm:RunStart}"; Flags: postinstall nowait skipifsilent; Check: InstallSucceeded
Filename: "{app}\Manual\{cm:ManualFile}"; Description: "{cm:RunManual}"; Flags: postinstall nowait skipifsilent shellexec unchecked; Check: ManualExists

[Code]
var
  InstallOk: Boolean;

function Param(const Name: String): String;
begin
  Result := ExpandConstant('{param:' + Name + '|}');
end;

{ A copy made for checking the setup: its shortcuts go to a folder of their own. }
function IsTestInstall: Boolean;
begin
  Result := Param('SHORTCUTROOT') <> '';
end;

function InstallSucceeded: Boolean;
begin
  Result := InstallOk;
end;

function ManualExists: Boolean;
begin
  Result := FileExists(ExpandConstant('{app}\Manual\{cm:ManualFile}'));
end;

function PowerShell: String;
begin
  Result := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
end;

{ Runs a PowerShell script hidden and waits. False when it could not start or did not end with code 0. }
function RunScript(const Script, Args: String): Boolean;
var
  Code: Integer;
begin
  Result := Exec(PowerShell, '-NoProfile -ExecutionPolicy Bypass -File "' + Script + '" ' + Args, '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0);
end;

{ The same places ops\app\lib.mjs looks for a browser with an "app window" mode. }
function BrowserFound: Boolean;
var
  Roots, Apps: TArrayOfString;
  I, J: Integer;
begin
  Result := False;
  SetArrayLength(Roots, 3);
  Roots[0] := ExpandConstant('{commonpf32}');
  Roots[1] := ExpandConstant('{commonpf64}');
  Roots[2] := ExpandConstant('{localappdata}');
  SetArrayLength(Apps, 4);
  Apps[0] := 'Microsoft\Edge\Application\msedge.exe';
  Apps[1] := 'Google\Chrome\Application\chrome.exe';
  Apps[2] := 'Chromium\Application\chrome.exe';
  Apps[3] := 'BraveSoftware\Brave-Browser\Application\brave.exe';
  for I := 0 to GetArrayLength(Roots) - 1 do
    for J := 0 to GetArrayLength(Apps) - 1 do
      if FileExists(Roots[I] + '\' + Apps[J]) then
        Result := True;
end;

function InitializeSetup: Boolean;
begin
  InstallOk := False;
  Result := True;
  if not BrowserFound then
    SuppressibleMsgBox(CustomMessage('NoBrowser'), mbInformation, MB_OK, IDOK);
end;

{ An update: the server of the copy that is there holds its files open. Stop it before they are replaced. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if DirExists(ExpandConstant('{app}\runtime')) then
  begin
    ExtractTemporaryFile('stop.ps1');
    RunScript(ExpandConstant('{tmp}\stop.ps1'), '-Root "' + ExpandConstant('{app}') + '"');
  end;
end;

{ Settings and shortcuts (install.ps1), then the firewall. }
procedure FinishInstall;
var
  LogFile, ResultFile, Args, Port: String;
  Code: Integer;
begin
  WizardForm.StatusLabel.Caption := CustomMessage('StatusSettingUp');
  WizardForm.FilenameLabel.Caption := '';
  LogFile := ExpandConstant('{app}\install.log');
  ResultFile := ExpandConstant('{tmp}\install-result.ini');
  { The firewall is asked for below, by this window, so that the Windows permission question comes to the front. }
  Args := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\ops\windows\install.ps1') + '" -SkipFirewall -NoStart -ResultFile "' + ResultFile + '"';
  if not WizardIsTaskSelected('autostart') then
    Args := Args + ' -NoAutostart';
  if IsTestInstall then
    Args := Args + ' -ShortcutRoot "' + Param('SHORTCUTROOT') + '"';
  if StrToIntDef(Param('PORT'), 0) > 0 then
    Args := Args + ' -Port ' + IntToStr(StrToIntDef(Param('PORT'), 0));
  { Through cmd, so that everything the script says lands in a file someone can send along when it fails. }
  if (not Exec(ExpandConstant('{cmd}'), '/s /c ""' + PowerShell + '" ' + Args + ' > "' + LogFile + '" 2>&1"', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code)) or (Code <> 0) then
  begin
    Log('install.ps1 failed with code ' + IntToStr(Code) + '; see ' + LogFile);
    if SuppressibleMsgBox(FmtMessage(CustomMessage('SetupStepFailed'), [LogFile]), mbError, MB_YESNO, IDNO) = IDYES then
      ShellExec('open', LogFile, '', '', SW_SHOWNORMAL, ewNoWait, Code);
    exit;
  end;
  InstallOk := True;

  Port := GetIniString('result', 'port', '3000', ResultFile);
  if GetIniString('result', 'firewall', 'ok', ResultFile) <> 'needed' then
    exit;
  if IsTestInstall or WizardSilent then
  begin
    Log('Firewall rule not asked for (silent or test install). Tablets cannot connect until the setup is run normally.');
    exit;
  end;
  WizardForm.StatusLabel.Caption := CustomMessage('StatusFirewall');
  MsgBox(CustomMessage('FirewallAsk'), mbInformation, MB_OK);
  if (not ShellExec('runas', PowerShell, '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\ops\windows\firewall.ps1') + '" -Port ' + Port + ' -LanPort ' + GetIniString('result', 'lanPort', '80', ResultFile), '', SW_HIDE, ewWaitUntilTerminated, Code)) or (Code <> 0) then
  begin
    Log('Firewall rule not made (declined, or code ' + IntToStr(Code) + ').');
    MsgBox(CustomMessage('FirewallDeclined'), mbInformation, MB_OK);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    FinishInstall;
end;

{ Removing: shortcuts and server first (uninstall.ps1), then the firewall rule, then Inno Setup deletes the files. }
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  App, ShortcutRoot, Args: String;
  Code: Integer;
begin
  if CurUninstallStep <> usUninstall then
    exit;
  App := ExpandConstant('{app}');
  ShortcutRoot := GetIniString('setup', 'shortcutRoot', '', App + '\setup.ini');
  Args := '-SkipFirewall';
  if ShortcutRoot <> '' then
    Args := Args + ' -ShortcutRoot "' + ShortcutRoot + '"';
  RunScript(App + '\ops\windows\uninstall.ps1', Args);
  RunScript(App + '\ops\windows\stop.ps1', '-Root "' + App + '"');
  { Only when a rule is there, and never for a test copy: it would take away the real till's rule. }
  if (ShortcutRoot = '') and (not UninstallSilent) and RunScript(App + '\ops\windows\firewall.ps1', '-Check -Port 0') then
    ShellExec('runas', PowerShell, '-NoProfile -ExecutionPolicy Bypass -File "' + App + '\ops\windows\firewall.ps1" -Remove', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

# Holtburger 3D for Windows

## Install and open

1. Run the downloaded `holtburger-3d-…-setup.exe`. It installs for your user;
   administrator access is not required.
2. Open **Holtburger 3D** from the Start menu.

For the portable ZIP, extract the entire archive and open `holtburger-3d.exe`
inside `h3d`. Keep that folder's files together.

## Connect

You need an Asheron's Call server address, an account on that server, and your own
game data. Have the server's port ready too; the usual port is 9000.

1. In the launcher, add your server and enter your account name and password.
2. Press Play. When asked for game data, choose your retail installation folder.
3. Select or create a character to enter the game.

The game folder should contain `client_portal.dat`, `client_cell_1.dat`, and
`client_local_English.dat`. `client_highres.dat` is optional. A full HBA archive
is also supported. The compact data bundled with the terminal client is not enough.
Your selected folder is remembered. Disconnecting returns to the launcher.

## Update or uninstall

Quit Holtburger before running a newer installer. Run setup again to repair an
interrupted installation. If setup says files are in use, close Holtburger and
its remaining host process in Task Manager, then retry.

For portable downloads, extract each update into a fresh folder. Keep your game
data outside the application folder. Remove an old portable copy when finished.
Uninstall an installed copy through Windows Settings → Apps → Installed apps.
Uninstalling leaves saved settings and external game data in place.

Beta and nightly builds share the same installation and saved settings; installing
one replaces the other. Nightlies do not check for updates.

## Troubleshooting

Windows may warn because the download is not publisher-signed. Check that you
obtained it from https://github.com/merklejerk/holtburger/releases before choosing
to run it.

If game data cannot be loaded, select the folder containing the files listed above,
rather than an individual DAT file. Keep all files from the portable ZIP together.

## Optional: offline Explorer

In PowerShell, from an extracted portable archive:

```powershell
.\h3d\holtburger-3d.exe explorer --content 'C:\path\to\retail'
```

Explorer lets you browse game content without connecting to a server.

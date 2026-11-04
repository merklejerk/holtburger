# Holtburger 3D for macOS (Apple Silicon)

## Install and open

1. Open the downloaded DMG.
2. Drag `holtburger-3d` onto the Applications shortcut beside it.
3. Open `holtburger-3d` from Applications, then eject the DMG.

For the portable ZIP, extract the entire archive and open `holtburger-3d.app`
inside `h3d`. Keep the extracted files together.

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

## If macOS blocks launch

These downloads are not signed by an Apple-verified publisher. Try opening the
program once, dismiss the warning, then open System Settings → Privacy & Security.
Under Security, choose Open Anyway for Holtburger and confirm Open.

If macOS instead reports that a trusted download from this project's releases is
damaged, you can remove quarantine from that downloaded copy with the command below.
Run it only for a download you trust.

```sh
xattr -dr com.apple.quarantine /Applications/holtburger-3d.app
```

For the portable ZIP, run this from the extracted archive instead:

```sh
xattr -dr com.apple.quarantine ./h3d/holtburger-3d.app
```

## Update or uninstall

Quit Holtburger, open the new DMG, and drag the app into Applications again.
Choose Replace. For portable ZIPs, extract the update into a fresh folder.
Keep your game data outside the application folder.

To uninstall, quit and move the app to Trash. Saved settings and your external
game data remain in place.

Beta and nightly builds share the same installation and saved settings; installing
one replaces the other. Nightlies do not check for updates.

## Optional: offline Explorer

```sh
/Applications/holtburger-3d.app/Contents/MacOS/holtburger-3d explorer --content '/path/to/retail'
```

Explorer lets you browse game content without connecting to a server. For a
portable ZIP, use `./h3d/holtburger-3d.app/Contents/MacOS/holtburger-3d` instead.

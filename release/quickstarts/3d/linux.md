# Holtburger 3D for Linux (x86-64)

## Install and open

For a Flatpak download, install it from a terminal in your download folder.
Replace VERSION with the version in the downloaded filename:

```sh
flatpak install --user --reinstall ./holtburger-3d-VERSION-x86_64.flatpak
flatpak run io.github.merklejerk.holtburger-3d
```

For a portable `.tar.gz`, extract the entire archive. Open a terminal in the
extracted folder and run:

```sh
./h3d/holtburger-3d
```

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

## Troubleshooting

The Flatpak's folder picker needs a working desktop file portal. If the picker
cannot grant access to your game folder, launch with an explicit folder grant:

```sh
flatpak run --filesystem='/absolute/path/to/retail:ro' io.github.merklejerk.holtburger-3d --content '/absolute/path/to/retail'
```

Replace both paths with your game folder. Use absolute paths; the grant is needed
each time you launch this way.

Portable builds require a graphical desktop and system libraries including GTK 3,
NSS, GBM, and ALSA. If a portable build fails because libraries are missing, use
the Flatpak download, which supplies its runtime dependencies.

## Update or uninstall

Quit Holtburger before updating. For Flatpak, run the install command above with
the new download. To uninstall:

```sh
flatpak uninstall --user io.github.merklejerk.holtburger-3d
```

For portable builds, extract each update into a fresh folder; delete an old copy
to remove it. Keep game data outside the program folder. These steps retain
saved settings and external game data. Flatpak settings are under
`~/.var/app/io.github.merklejerk.holtburger-3d/`.

Beta and nightly builds share the same installation and saved settings; installing
one replaces the other. Nightlies do not check for updates.

## Optional: offline Explorer

For Flatpak:

```sh
flatpak run --filesystem='/absolute/path/to/retail:ro' io.github.merklejerk.holtburger-3d explorer --content '/absolute/path/to/retail'
```

For a portable archive:

```sh
./h3d/holtburger-3d explorer --content '/path/to/retail'
```

Explorer lets you browse game content without connecting to a server.

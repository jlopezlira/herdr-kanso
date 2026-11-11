# Simulator (`kanso-sim`)

Part of the Kanso recipe ([RECIPE.md](RECIPE.md)): the brief for the
Simulator panel, kept in its own file so RECIPE.md stays under the gallery
limit.

## What you see

A side panel, id `sim`, the smartphone icon, mounted by `kanso-tabs` like the
other panels and removed when it closes. Cmd+Shift+S (`kanso-tabs.sim`, only
in `layout:kanso`) toggles it; on Windows the same action is Ctrl+Shift+M.
It can be turned off in Settings, like every panel.

It stays off until this computer has Xcode's `simctl` or an Android SDK. That
first choice is saved in shared `kanso.sim.defaulted`, so a later choice is
left alone. A probe that does not finish in 8 seconds leaves the panel on.

The head names the device, its OS and "Booted" when it is running. Boot starts
one that is off. Change opens the list: name, OS, Booted, and a dim row for an
Android image that cannot run on this computer. The last pick is shared
`kanso.sim.device`.

The screen keeps the device's aspect. Touch, drag, scroll and typing go to
the device. The toolbar is Home, Lock, volume down, volume up, rotate, and,
on iOS, the software keyboard.

States, from the panel kit: no devices ("No simulators or emulators."); a
missing tool names itself, with `xcode-select --install` or a link
(`nodejs.org`, Apple's Xcode page, Android Studio); booting and starting are
skeletons; "The picture stalled." and "The stream stopped." offer Reconnect;
"Input failed." sits under the toolbar and clears on the next input that
works.

On Linux and Windows one line says "iOS simulators are on macOS." A project on
another computer says these are this computer's devices. There is no remote
stream.

## How it streams

Nothing streams while the panel is closed or the window is behind others.
Closing the panel unmounts the mod.

A viewer count is shared by every open Simulator. Closing one view never
kills a helper another view still holds. The iOS helper (`serve-sim --kill`)
exits only when its last viewer closes or the window goes behind, not when
the stream ends. The Android helper, `android-stream.mjs`, exits about 3
seconds after its last HTTP viewer leaves.

"Live" means a frame arrived within the last 2 seconds. Older than that is
"The picture stalled." A stream that ends is "The stream stopped."

Frames are written under `mods/kanso-sim-frames/` (not a mod), twelve files
per view, and the picture swaps 200 ms after a write so Herdr can reload it.

## What it runs

Node comes from PATH, the same way Spend requires it.

iOS needs `serve-sim@0.1.49`. Nothing is downloaded until you press the
button, which runs `npx --yes serve-sim@0.1.49 --version` (10 minutes). The
`--version` is so that process exits. Later launches use
`npx --no --offline serve-sim@0.1.49`, and only while the panel is open.
Herdr's `exec` cannot set an environment variable, so
`SERVE_SIM_DISABLE_DEVICE_HUB_KEYBOARD` is not set.

Android finds the SDK from `ANDROID_HOME`, then `ANDROID_SDK_ROOT`, then the
default folder: `~/Library/Android/sdk` on macOS, `~/Android/Sdk` on Linux,
`%LOCALAPPDATA%\Android\Sdk` on Windows. `adb` and `emulator` are run
directly (`adb.exe` and `emulator.exe` on Windows). No `sh` on Windows.
Paths go through `platform-paths`. A booted emulator and the stream helper
are detached with the shared `platform-open` spawn.

The stream helper is a Node process. The mod passes it the discovery
folders (`*.ini` under the emulator's running directory) as arguments. It
does not import the mod.

Sockets, binary frame writes and `mkdir` live only in `host-io.js`, so they
can be swapped. `import net from "net"`, `import { writeFile } from
"fs/promises"` and `import { WebSocket } from "websocket"` are not in
`herdr.d.ts` or `AGENTS.md`. `mkdir` is the same `fs/promises` module.

## Built from

Device lists, the multipart frames, the touch mapping and the Android
stream come from herdr-sim by Robert Soriano (MIT,
https://github.com/wobsoriano/herdr-sim). The notice is in
`LICENSE-herdr-sim.txt` and in each file that carries that code.

Toolbar icons are Lucide (ISC), except `android.svg`, which herdr-sim drew.
The ISC notice is in `icons/LICENSE-lucide.txt`.

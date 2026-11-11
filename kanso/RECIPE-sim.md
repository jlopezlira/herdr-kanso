# Simulator (`kanso-sim`)

An own-mod panel beside the agent, written from the platform tools and the
panel kit. No package, helper process, server, additional transport or install.

## Registration

Panel id `sim`, mod `kanso-sim`, icon
`mods/kanso-chrome/icons/smartphone.svg`. The existing `kanso-tabs.sim`
binding stays: Cmd+Shift+S, Ctrl+Shift+M on Windows.

The tab bar probes once after mount and when the panel catalog or its saved
order or switches change. A deadline bounds the probe. Cached plain tool
paths and capabilities live in shared `kanso.sim.tools`; pending work belongs
to each view. No simctl and no SDK with adb means no button or message.
The panel's saved off switch remains independent of tool availability.

`registration.js` is copied to kanso-tabs as `sim-registration.js` by
sync:share. Platform services, the kit and front.js are copied the same way.

## Devices

Only the platforms here appear, in one list with Booted or Off. On macOS,
`xcode-select -p` finds the selected developer directory without an install
prompt. Its `usr/bin/simctl` must exist; that path is cached and used directly
for every iOS command, including `list devices --json`.
Android combines `emulator -list-avds`, `adb devices`, and each connected
emulator's `adb -s <serial> emu avd name`. Physical Android devices are also
shown. No iOS row or message on other operating systems.

SDK roots: ANDROID_HOME, ANDROID_SDK_ROOT, then ~/Library/Android/sdk on
macOS, ~/Android/Sdk on Linux, or %LOCALAPPDATA%/Android/Sdk on Windows.
The first root with platform-tools/adb wins. A missing emulator binary is one
fact line; connected Android devices still work. No install instructions.

Start runs simctl boot or detaches the SDK emulator with its AVD name.
Starting has a 90-second deadline and a plain failure line. Device reads run
only in front, every five seconds, or roughly every second while starting.
A project on another computer has one fact: devices are on this computer.

## Pictures

One screenshot in flight. After it lands, wait 700 ms before the next.
iOS uses `simctl io <udid> screenshot --type=jpeg <file>`; Android writes
`adb -s <serial> exec-out screencap -p` to a file through the platform command
service. Windows copies the command's binary stream directly to a file.

Frames live under the app's `data/kanso-sim/`. A unique filename refreshes
image()'s picture; older frames for that device are removed after a new one
lands. PNG/JPEG headers supply proportions, fitted to the available panel
width and height. A failed frame retains the last picture and says
"as of <age>". No screenshot work behind another window or a hidden layout
node. front.js schedules one immediate frame on return. Closing releases
timers and inputs; no module-global pending state survives a remount.

## Controls

Android reads `shell wm size` once per device and again only when a picture's
orientation changes, swapping its natural axes for coordinate scaling.
A click sends `shell input tap`;
a drag sends `shell input swipe`. Focus the picture to type. Text is batched
in order with keys, escaped for Android's shell input, and literal percent-s
is split so it does not become a space. Enter, Backspace and arrows are
keyevents. Back, Home, Recents, Power and both volume keys use the same queue.
Rotate is `adb -s <serial> emu rotate`, and is shown only for emulators.
The next screenshot already has its new orientation. Emulators also offer
Shut down through `emu kill`.

iOS is a view. Its controls are simctl appearance light/dark, openurl and
shutdown. Open in Simulator runs `open -a Simulator` for touch in Apple's
own window. No iOS tap, swipe or keyboard controls.

## Verification

Pure tests cover output parsing, platform combinations, frame timing and
failure, coordinate scaling and rotation, escaped/batched text, key mapping,
and availability independent of the off switch. Mocked runtime tests cover
capture, cleanup, visibility, input and every UI state. A source guard refuses
package runners and alternative transports. No test starts a simulator.

Run npm test, npm run sync:share -- --check, npm run check:version and
herdr-app check for kanso-sim and kanso-tabs. Not tried in the running app.

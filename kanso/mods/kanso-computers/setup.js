const OS_WORD = { macos: "macOS", linux: "Linux", windows: "Windows" };

const opening = (platform, here, goal) => [
  `Help me ${goal} so kansō on ${here} (${OS_WORD[platform] ?? platform}) can add it and run agents there over ssh.`,
  "Take me by the hand: one step at a time, say exactly what to do and where, and wait for me to say it is done before the next step.",
  "",
];

const SAFE = [
  "",
  "Never ask me for a password, never type one, and never put one in a command. If a step fails, explain what happened and what to try, in plain words.",
];

export function homeSetupPrompt({ platform = "macos", here = "this computer" } = {}) {
  return [
    ...opening(platform, here, "add another computer on my home network"),
    "1. Ask me which computer, and the user I sign in as over there; it is often not my user here. To help me pick, show me what answers ssh nearby: on macOS `dns-sd -t 3 -B _ssh._tcp`, on Linux `avahi-browse -tr _ssh._tcp`, and `arp -a`.",
    "2. Check that it answers on port 22 by its .local name, for example `nc -z -w 3 <name>.local 22`. If it does not, tell me how to turn ssh on over there: on a Mac, System Settings › General › Sharing › Remote Login; on Linux, install and start openssh-server and avahi-daemon; on Windows, Settings › System › Optional features › OpenSSH Server, then start the sshd service.",
    "3. Make sure this computer's key is there: create ~/.ssh/id_ed25519 if it is missing, then ask me to run `ssh-copy-id <user>@<name>.local` myself in a terminal and type the password there.",
    "4. Check that `ssh -o BatchMode=yes <user>@<name>.local true` works.",
    "5. Add it from kansō: run `herdr-app do mod.open --name kanso-computers` and tell me to press Add next to it under On this network. If it is not listed, I type <user>@<name>.local in the field there and press Add. Check with `hc machine ls` that it is there, and tell me it is in the sidebar.",
    "",
    "Change nothing on this computer beyond the ssh key. Do not install or use Tailscale for this.",
    ...SAFE,
  ].join("\n");
}

export function tailscaleSetupPrompt({ platform = "macos", here = "this computer" } = {}) {
  return [
    ...opening(platform, here, "reach another computer over Tailscale when I am away from home"),
    "1. Ask me which computer, and the user I sign in as over there.",
    "2. Install Tailscale on this computer if `tailscale status` does not work, and sign me in with `tailscale up`.",
    "3. Tell me how to install Tailscale over there and sign in with the same account, then check with `tailscale status` that it shows up online.",
    "4. Turn on Tailscale SSH there with `sudo tailscale set --ssh`, or, if I prefer native ssh, make sure this computer's key is there: ask me to run `ssh-copy-id <user>@<its Tailscale name>` myself in a terminal.",
    "5. Add it from kansō: run `herdr-app do mod.open --name kanso-computers` and tell me to press Add next to it, under On this network when it is at home with me or Away from home otherwise. kansō still reaches it over the home network when I am home. Check with `hc machine ls` that it is there.",
    "",
    "Change nothing on this computer beyond Tailscale and the ssh key.",
    ...SAFE,
  ].join("\n");
}

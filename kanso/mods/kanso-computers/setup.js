const OS_WORD = { macos: "macOS", linux: "Linux", windows: "Windows" };

export function setupPrompt({ platform = "macos", here = "this computer" } = {}) {
  return [
    `Help me get another computer ready so kansō on ${here} (${OS_WORD[platform] ?? platform}) can add it and run agents there over ssh.`,
    "Take me by the hand: one step at a time, say exactly what to do and where, and wait for me to say it is done before the next step.",
    "",
    "1. Ask me which computer: its name or address, and the user to log in as. You can show me what you see with `tailscale status` and `arp -a` to help me pick.",
    "2. Find out whether it is on the same network as this computer: check if it answers on port 22 at its local address (for example `nc -z -G 2 <address> 22`, or `ssh -o BatchMode=yes -o ConnectTimeout=3 <user>@<address> true`).",
    "3. Same network: use native ssh. If port 22 does not answer, tell me how to turn ssh on over there: on a Mac, System Settings › General › Sharing › Remote Login; on Linux, install and start openssh-server; on Windows, Settings › System › Optional features › OpenSSH Server, then start the sshd service.",
    "4. Not on the same network: use Tailscale. Install Tailscale on this computer if it is missing and sign me in with `tailscale up`. Then tell me how to install Tailscale over there, sign in with the same account, and turn on Tailscale SSH with `sudo tailscale set --ssh`. Check with `tailscale status` that it shows up online.",
    "5. With native ssh, make sure this computer's key is there: create ~/.ssh/id_ed25519 if it is missing, then ask me to run `ssh-copy-id <user>@<address>` myself in a terminal and type the password there. Never ask me for a password, never type one, and never put one in a command.",
    "6. Add it from kansō, so it keeps both routes: run `herdr-app do mod.open --name kanso-computers` and tell me to press Add next to it, under On your tailnet or On this network. If it is not listed, I type <user>@<address> in the field there and press Add. kansō then reaches it over the local network when I am on it and over Tailscale when I am away. Check with `hc machine ls` that it is there, and tell me it is in the sidebar.",
    "",
    "Change nothing on this computer beyond Tailscale and the ssh key. If a step fails, explain what happened and what to try, in plain words.",
  ].join("\n");
}

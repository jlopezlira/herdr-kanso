import { exec, window } from "herdr";
import { psQuote, powershell } from "./platform-command.js";

const CREDREAD = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class KansoCred{[StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]public struct C{public int F;public int T;public string N;public string M;public System.Runtime.InteropServices.ComTypes.FILETIME W;public int S;public IntPtr B;public int P;public int A;public IntPtr At;public string Al;public string U;}[DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool CredReadW(string n,int t,int f,out IntPtr c);[DllImport("advapi32.dll")]static extern void CredFree(IntPtr c);public static string Read(string n){IntPtr p;if(!CredReadW(n,1,0,out p))return null;var c=(C)Marshal.PtrToStructure(p,typeof(C));var s=Marshal.PtrToStringUni(c.B,c.S/2);CredFree(p);return s;}public static bool Missing(string n){IntPtr p;if(CredReadW(n,1,0,out p)){CredFree(p);return false;}return Marshal.GetLastWin32Error()==1168;}}';`;

const target = (service, account) => `${service}:${account}`;

const SH_READ = {
  macos: 'tok=$(security find-generic-password -s "$1" -a "$2" -w 2>/dev/null) || exit 3',
  linux: 'tok=$(secret-tool lookup service "$1" account "$2" 2>/dev/null) || exit 3; [ -n "$tok" ] || exit 3',
};

const AUTH = {
  basic: 'printf "Authorization: Basic %s" "$(printf "%s:%s" "$3" "$tok" | base64 | tr -d "\\n")"',
  raw: 'printf "Authorization: %s" "$tok"',
};

const shellRequest = (platform, auth) => `${SH_READ[platform]}; ${AUTH[auth]} | curl -sS --max-time 20 -H @- -H "Accept: application/json" -H "Content-Type: application/json" -X "$4" \${5:+--data-binary "$5"} -w "\\n%{http_code}" "$6"`;

const psRequest = ({ service, account, auth, email, method, body, url }) => `${CREDREAD} $tok=[KansoCred]::Read(${psQuote(target(service, account))}); if(-not $tok){exit 3}; `
  + `$h=@{Accept='application/json'}; $h.Authorization=${auth === "basic" ? `'Basic '+[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(${psQuote(email ?? "")}+':'+$tok))` : "$tok"}; `
  + `try{$r=Invoke-WebRequest -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 20 -Method ${psQuote(method)} -Uri ${psQuote(url)} -Headers $h -ContentType 'application/json'${body ? ` -Body ${psQuote(body)}` : ""}; [Console]::Out.Write($r.Content+[char]10+[int]$r.StatusCode)}`
  + `catch{$s=0;if($_.Exception.Response){$s=[int]$_.Exception.Response.StatusCode}; [Console]::Out.Write([char]10+$s)}`;

const PROMPT = {
  macos: 'printf "%s\\n\\n" "$1"; exec security add-generic-password -U -s "$2" -a "$3" -l "$4" -w',
  linux: 'printf "%s\\n\\n" "$1"; exec secret-tool store --label="$4" service "$2" account "$3"',
};
const ASK = { macos: " macOS asks for it twice.", linux: "", windows: "" };

const failed = (e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e) });

export function secretsApi(platform, exec) {
  const run = (cmd, args) => exec(cmd, args).catch(failed);
  const sh = (script, args) => run("sh", ["-c", script, "kanso", ...args]);
  const ok = async (pending) => (await pending)?.code === 0;
  const apis = {
    macos: {
      available: () => ok(run("security", ["list-keychains"])),
      remove: (service, account) => run("security", ["delete-generic-password", "-s", service, "-a", account]),
      has: (service, account) => ok(run("security", ["find-generic-password", "-s", service, "-a", account])),
      gone: async (service, account) => (await run("security", ["find-generic-password", "-s", service, "-a", account]))?.code === 44,
    },
    linux: {
      available: () => ok(sh('command -v secret-tool >/dev/null || exit 9; secret-tool search service kanso-probe >/dev/null 2>&1; s=$?; [ "$s" -le 1 ]', [])),
      remove: (service, account) => run("secret-tool", ["clear", "service", service, "account", account]),
      has: (service, account) => ok(sh('[ -n "$(secret-tool lookup service "$1" account "$2" 2>/dev/null)" ]', [service, account])),
      gone: (service, account) => ok(sh('out=$(secret-tool lookup service "$1" account "$2" 2>&1); s=$?; [ "$s" -eq 1 ] && [ -z "$out" ]', [service, account])),
    },
    windows: {
      available: () => ok(run("cmdkey", ["/list"])),
      remove: (service, account) => run("cmdkey", [`/delete:${target(service, account)}`]),
      has: (service, account) => ok(powershell(exec, `${CREDREAD} if([KansoCred]::Read(${psQuote(target(service, account))})){exit 0}else{exit 3}`).catch(failed)),
      gone: (service, account) => ok(powershell(exec, `${CREDREAD} if([KansoCred]::Missing(${psQuote(target(service, account))})){exit 0}else{exit 3}`).catch(failed)),
    },
  };
  const api = apis[platform] ?? null;
  const prompt = (service, account, label, words) => (platform === "windows"
    ? ["cmdkey", `/generic:${target(service, account)}`, `/user:${account}`, "/pass"]
    : ["sh", "-c", PROMPT[platform], "kanso", `${words}${ASK[platform]} It stays hidden while you paste. Ctrl+C cancels.`, service, account, label]);
  const request = async ({ service, account, auth = "raw", email = "", method = "GET", body = "", url }) => {
    const r = platform === "windows"
      ? await powershell(exec, psRequest({ service, account, auth, email, method, body, url })).catch(failed)
      : await sh(shellRequest(platform, auth), [service, account, email, method, body, url]);
    if (r?.code === 3) return { status: 0, signedOut: true, text: "" };
    const out = String(r?.stdout ?? "");
    const cut = out.lastIndexOf("\n");
    const status = Number(out.slice(cut + 1).trim()) || 0;
    return { status, text: cut >= 0 ? out.slice(0, cut) : "", error: r?.code ? String(r.stderr ?? "").trim().split("\n")[0] : "" };
  };
  return api ? { ...api, prompt, request } : { available: async () => false, remove: null, has: async () => false, gone: async () => true, prompt: null, request: async () => ({ status: 0, signedOut: true, text: "" }) };
}

export const localSecrets = () => secretsApi(window()?.platform ?? "macos", (cmd, args) => exec(cmd, args));

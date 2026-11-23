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

const GUI_PINENTRY = "for p in pinentry-gnome3 pinentry-qt pinentry-gtk pinentry-gtk-2 pinentry-qt5; do command -v \"$p\" >/dev/null && break; p=; done";
const DIALOG = `on run argv
text returned of (display dialog (item 1 of argv) default answer "" with hidden answer with title "kansō" buttons {"Cancel", "Save"} default button "Save" cancel button "Cancel" with icon note)
end run`;

const ASK = {
  macos: `v=$(osascript -e "$5" "$1" 2>&1) || { case "$v" in *"(-128)"*) exit 3;; esac; exit 8; }; [ -n "$v" ] || exit 3; printf "%s\\n%s\\n" "$v" "$v" | security add-generic-password -U -s "$2" -a "$3" -l "$4" -w >/dev/null 2>&1`,
  linux: `${GUI_PINENTRY}; [ -n "$p" ] || exit 9; a=$(printf "SETTITLE kansō\\nSETDESC %s\\nSETPROMPT Token\\nSETOK Save\\nGETPIN\\nBYE\\n" "$1" | "$p" 2>/dev/null); v=$(printf "%s\\n" "$a" | sed -n "s/^D //p" | sed "s/%0A//g;s/%0D//g;s/%25/%/g"); [ -n "$v" ] || { case "$a" in *"ERR 83886179"*) exit 3;; esac; exit 8; }; printf "%s" "$v" | secret-tool store --label="$4" service "$2" account "$3" >/dev/null 2>&1`,
};

const CREDASK = `Add-Type -TypeDefinition 'using System;using System.Text;using System.Runtime.InteropServices;public static class KansoAsk{[StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]struct U{public int S;public IntPtr H;public string M;public string C;public IntPtr B;}[StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]struct W{public int F;public int T;public string N;public string M;public System.Runtime.InteropServices.ComTypes.FILETIME L;public int S;public IntPtr B;public int P;public int A;public IntPtr At;public string Al;public string U;}[DllImport("credui.dll",CharSet=CharSet.Unicode)]static extern int CredUIPromptForWindowsCredentialsW(ref U u,int e,ref uint p,IntPtr i,uint n,out IntPtr o,out uint s,ref bool v,int f);[DllImport("credui.dll",CharSet=CharSet.Unicode)]static extern bool CredPackAuthenticationBufferW(int f,string u,string p,IntPtr b,ref int n);[DllImport("credui.dll",CharSet=CharSet.Unicode)]static extern bool CredUnPackAuthenticationBufferW(int f,IntPtr b,uint n,StringBuilder u,ref int ul,StringBuilder d,ref int dl,StringBuilder p,ref int pl);[DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool CredWriteW(ref W c,int f);[DllImport("ole32.dll")]static extern void CoTaskMemFree(IntPtr p);public static int Ask(string target,string user,string message){var u=new U();u.S=Marshal.SizeOf(typeof(U));u.C="kansō";u.M=message;int n=0;CredPackAuthenticationBufferW(4,user,"",IntPtr.Zero,ref n);IntPtr i=Marshal.AllocCoTaskMem(Math.Max(n,1));if(!CredPackAuthenticationBufferW(4,user,"",i,ref n))n=0;uint p=0;IntPtr o;uint s;bool v=false;int r=CredUIPromptForWindowsCredentialsW(ref u,0,ref p,i,(uint)n,out o,out s,ref v,1);Marshal.FreeCoTaskMem(i);if(r==1223)return 3;if(r!=0)return 8;var un=new StringBuilder(514);var dn=new StringBuilder(338);var pw=new StringBuilder(4096);int ul=un.Capacity,dl=dn.Capacity,pl=pw.Capacity;bool ok=CredUnPackAuthenticationBufferW(0,o,s,un,ref ul,dn,ref dl,pw,ref pl);Marshal.Copy(new byte[s],0,o,(int)s);CoTaskMemFree(o);if(!ok||pw.Length==0){pw.Clear();return 3;}byte[] b=Encoding.Unicode.GetBytes(pw.ToString());pw.Clear();IntPtr bp=Marshal.AllocHGlobal(b.Length);Marshal.Copy(b,0,bp,b.Length);var w=new W();w.T=1;w.N=target;w.U=user;w.S=b.Length;w.B=bp;w.P=2;bool saved=CredWriteW(ref w,0);Marshal.Copy(new byte[b.Length],0,bp,b.Length);Marshal.FreeHGlobal(bp);Array.Clear(b,0,b.Length);return saved?0:4;}}';`;

const ASK_MS = 300_000;
const ASKED = { 0: "saved", 3: "cancelled" };

const failed = (e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e) });

export function secretsApi(platform, exec) {
  const run = (cmd, args) => exec(cmd, args).catch(failed);
  const sh = (script, args) => run("sh", ["-c", script, "kanso", ...args]);
  const ok = async (pending) => (await pending)?.code === 0;
  const apis = {
    macos: {
      available: () => ok(run("security", ["list-keychains"])),
      canAsk: async () => true,
      remove: (service, account) => run("security", ["delete-generic-password", "-s", service, "-a", account]),
      has: (service, account) => ok(run("security", ["find-generic-password", "-s", service, "-a", account])),
      gone: async (service, account) => (await run("security", ["find-generic-password", "-s", service, "-a", account]))?.code === 44,
    },
    linux: {
      available: () => ok(sh('command -v secret-tool >/dev/null || exit 9; secret-tool search service kanso-probe >/dev/null 2>&1; s=$?; [ "$s" -le 1 ]', [])),
      canAsk: () => ok(sh(`[ -n "$WAYLAND_DISPLAY$DISPLAY" ] || exit 9; ${GUI_PINENTRY}; [ -n "$p" ]`, [])),
      remove: (service, account) => run("secret-tool", ["clear", "service", service, "account", account]),
      has: (service, account) => ok(sh('[ -n "$(secret-tool lookup service "$1" account "$2" 2>/dev/null)" ]', [service, account])),
      gone: (service, account) => ok(sh('out=$(secret-tool lookup service "$1" account "$2" 2>&1); s=$?; [ "$s" -eq 1 ] && [ -z "$out" ]', [service, account])),
    },
    windows: {
      available: () => ok(run("cmdkey", ["/list"])),
      canAsk: async () => true,
      remove: (service, account) => run("cmdkey", [`/delete:${target(service, account)}`]),
      has: (service, account) => ok(powershell(exec, `${CREDREAD} if([KansoCred]::Read(${psQuote(target(service, account))})){exit 0}else{exit 3}`).catch(failed)),
      gone: (service, account) => ok(powershell(exec, `${CREDREAD} if([KansoCred]::Missing(${psQuote(target(service, account))})){exit 0}else{exit 3}`).catch(failed)),
    },
  };
  const api = apis[platform] ?? null;
  const ask = async (service, account, label, words) => {
    const r = platform === "windows"
      ? await powershell(exec, `${CREDASK} exit [KansoAsk]::Ask(${psQuote(target(service, account))},${psQuote(account)},${psQuote(words)})`, { timeout: ASK_MS }).catch(failed)
      : await exec("sh", ["-c", ASK[platform], "kanso", words, service, account, label, DIALOG], { timeout: ASK_MS }).catch(failed);
    return ASKED[r?.code] ?? "failed";
  };
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
  return api ? { ...api, ask, request } : { available: async () => false, canAsk: async () => false, remove: null, has: async () => false, gone: async () => true, ask: async () => "failed", request: async () => ({ status: 0, signedOut: true, text: "" }) };
}

export const localSecrets = () => secretsApi(window()?.platform ?? "macos", (cmd, args, options) => exec(cmd, args, options));

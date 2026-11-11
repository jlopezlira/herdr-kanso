import { powershell, psQuote } from "./platform-command.js";
import { paths } from "./platform-paths.js";

const TAIL = 8192;
const LONGEST = 100000;
const SCAN = `f="$1"; from="$2"; mark="$5"; [ -f "$f" ] || exit 2; s=$(wc -c < "$f" | tr -d " "); reset=0
if [ "$s" -lt "$from" ]; then from=0; reset=1
elif [ "$from" != 0 ]; then
  now=$(head -c "$from" "$f" | cksum | cut -d " " -f 1)
  if [ -z "$mark" ] || [ "$now" != "$mark" ]; then from=0; reset=1; fi
fi
end=$(python3 - "$f" <<'PY'
import sys
fh=open(sys.argv[1],"rb"); fh.seek(0,2); pos=fh.tell(); found=None
while pos>0 and found is None:
    take=min(1048576,pos); pos-=take; fh.seek(pos); i=fh.read(take).rfind(b"\\n")
    if i>=0: found=pos+i+1
fh.close(); sys.stdout.write("0" if found is None else str(found))
PY
) || exit 1
[ "$reset" = 0 ] && [ "$end" = "$from" ] && exit 3
if [ "$end" = 0 ]; then sum=""
else sum=$(head -c "$end" "$f" | cksum | cut -d " " -f 1); fi
echo "$end"; echo "$from"; echo "$sum"
if [ "$end" -gt "$from" ]; then
  LC_ALL=C tail -c "+$((from + 1))" "$f" | head -c "$((end - from))" | LC_ALL=C awk 'length($0) < ${LONGEST}' | LC_ALL=C sed -E 's/\\\\[ntr"]/ /g; s/([^A-Za-z0-9@+._~\\/-])/\\1\\1/g' | LC_ALL=C grep -oE "$3" \\
    | LC_ALL=C sed -E 's/^[^A-Za-z0-9@+._~\\/-]//; s/[^A-Za-z0-9]$//' \\
    | LC_ALL=C awk '{ at[$0] = NR } END { for (m in at) print at[m], m }' | sort -n | tail -n "$4" | cut -d " " -f 2-
fi
exit 0`;

const SLICE_PY = String.raw`import os, sys
path, frm_s, budget_s, longest_s = sys.argv[1:]
try:
    size = os.path.getsize(path)
except OSError:
    sys.exit(2)
frm = int(frm_s)
budget = int(budget_s)
longest = int(longest_s)
if frm < 0 or frm > size:
    frm = 0
fh = open(path, "rb")
start = frm
data = b""
end = start
while start < size:
    fh.seek(start)
    data = fh.read(min(budget, size - start))
    end = start + len(data)
    if b"\n" not in data and end < size:
        fh.seek(start)
        skipped = 0
        while True:
            block = fh.read(1048576)
            if not block:
                start = size
                data = b""
                end = size
                break
            i = block.find(b"\n")
            if i >= 0:
                start = start + skipped + i + 1
                break
            skipped += len(block)
        if start >= size:
            break
        continue
    if end < size or not data.endswith(b"\n"):
        i = data.rfind(b"\n")
        if i >= 0:
            data = data[:i + 1]
            end = start + i + 1
        else:
            data = b""
            end = start
    break
kept = []
for line in data.decode("utf-8", "replace").split("\n"):
    if line.endswith("\r"):
        line = line[:-1]
    if len(line) >= longest:
        continue
    kept.append(line)
sys.stdout.write(str(end) + " " + str(size) + "\n")
sys.stdout.write("\n".join(kept))
fh.close()
`;

async function unixSlice(run, file, from, budget, longest) {
  const args = ["-c", SLICE_PY, file, String(from), String(budget), String(longest)];
  const read = (command) => Promise.resolve(run(command, args, { timeout: 60000 })).catch(() => null);
  const first = await read("python3");
  return first && (first.code === 0 || first.code === 2) ? first : read("python");
}

const LOCATE = String.raw`pid="$1"; kind="$2"
if [ "$kind" = claude ]; then
  f="$HOME/.claude/sessions/$pid.json"; [ -f "$f" ] && printf 'claude\t%s\n' "$(tr -d '\n' < "$f")"
  exit 0
fi
for p in "$pid" $(pgrep -P "$pid" 2>/dev/null); do
  f=$(lsof -a -p "$p" -d 0-999 -Fn 2>/dev/null | sed -n 's/^n\(.*rollout-.*\.jsonl\)$/\1/p' | head -1)
  [ -n "$f" ] || continue
  id=$(basename "$f" .jsonl | grep -o '[0-9a-f]\{8\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{12\}$')
  name=$(grep -h "\"id\":\"$id\"" "$HOME/.codex/session_index.jsonl" 2>/dev/null | tail -1)
  printf 'codex\t%s\t%s\n' "$f" "$name"
  exit 0
done`;

// Files grow to tens of MB: only the first and last 4 MB are searched, and lines over 16 KB (a pasted image) are left out to spare the heap.
// Claude Code writes the title again every few turns, so the whole file is searched only when the end has none.
const READ = String.raw`f="$1"; said() { grep -h -e '"type":"user"' -e '"user_message"' | grep -v '"tool_result"' | awk 'length($0) < 16000'; }
t=$(tail -c 4000000 "$f" | grep -h '"type":"ai-title"' | awk 'length($0) < 16000' | tail -1)
[ -n "$t" ] || t=$(grep -h '"type":"ai-title"' "$f" | awk 'length($0) < 16000' | tail -1)
printf '%s\n\036\n' "$t"
head -c 4000000 "$f" | said | head -n 60; printf '\n\036\n'
tail -c 4000000 "$f" | said | tail -n 40; printf '\n\036\n'
tail -c ${TAIL} "$f"`;


const WINDOWS_SLICE = String.raw`
$stream=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
try {
  $size=$stream.Length
  if ($from -lt 0 -or $from -gt $size) { $from=0 }
  $start=$from; $end=$from; $data=[byte[]]@()
  while ($start -lt $size) {
    $null=$stream.Seek($start,[IO.SeekOrigin]::Begin)
    $buffer=New-Object byte[] ([Math]::Min($budget,$size-$start))
    $count=$stream.Read($buffer,0,$buffer.Length); $end=$start+$count
    $last=[Array]::LastIndexOf($buffer,[byte]10,$count-1)
    if ($last -lt 0 -and $end -lt $size) {
      do {
        $buffer=New-Object byte[] 1048576; $count=$stream.Read($buffer,0,$buffer.Length)
        $newline=if ($count -gt 0) { [Array]::IndexOf($buffer,[byte]10,0,$count) } else { -1 }
      } while ($count -gt 0 -and $newline -lt 0)
      $start=if ($newline -ge 0) { $stream.Position-$count+$newline+1 } else { $size }
      $end=$start; continue
    }
    if ($last -ge 0) { $data=$buffer[0..$last]; $end=$start+$last+1 } else { $end=$start }
    break
  }
  [Console]::Write("$end $size"+[char]10)
  $text=[Text.Encoding]::UTF8.GetString($data)
  [Console]::Write((($text -split [string][char]10 | ForEach-Object { $_.TrimEnd([char]13) } | Where-Object { $_.Length -lt $longest }) -join [string][char]10))
} finally { $stream.Dispose() }
`;

const WINDOWS_THREAD = String.raw`
$stream=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
try {
  function part($start,$count) {
    $null=$stream.Seek($start,[IO.SeekOrigin]::Begin)
    $buffer=New-Object byte[] ([Math]::Min($count,$stream.Length-$start))
    $read=$stream.Read($buffer,0,$buffer.Length)
    [Text.Encoding]::UTF8.GetString($buffer,0,$read)
  }
  $head=part 0 4000000
  $recent=part ([Math]::Max(0,$stream.Length-4000000)) 4000000
  $tail=part ([Math]::Max(0,$stream.Length-8192)) 8192
  $titles=@($recent -split [string][char]10 | Where-Object { $_.Length -lt 16000 -and $_ -match '"type":"ai-title"' })
  if (-not $titles.Count) {
    $reader=New-Object IO.StreamReader($file)
    try { while ($null -ne ($line=$reader.ReadLine())) { if ($line.Length -lt 16000 -and $line -match '"type":"ai-title"') { $titles=@($line) } } } finally { $reader.Dispose() }
  }
  function said($text) { $text -split [string][char]10 | Where-Object { $_.Length -lt 16000 -and $_ -match '"type":"user"|"user_message"' -and $_ -notmatch '"tool_result"' } }
  $separator=[string][char]10+[char]30+[string][char]10
  [Console]::Write((@(($titles | Select-Object -Last 1), ((said $head | Select-Object -First 60) -join [string][char]10), ((said $recent | Select-Object -Last 40) -join [string][char]10), $tail) -join $separator))
} finally { $stream.Dispose() }
`;


const WINDOWS_SCAN = String.raw`
using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Security.Cryptography;
using System.Collections.Generic;
public static class KansoTranscript {
  static string Hash(FileStream file, long length) {
    file.Position=0;
    using (var sha=SHA256.Create()) {
      var buffer=new byte[65536];
      while (length>0) {
        int n=file.Read(buffer,0,(int)Math.Min(length,buffer.Length));
        if (n==0) throw new EndOfStreamException();
        sha.TransformBlock(buffer,0,n,null,0); length-=n;
      }
      sha.TransformFinalBlock(new byte[0],0,0);
      return BitConverter.ToString(sha.Hash).Replace("-","");
    }
  }
  public static string Scan(string path,long from,string mark,string pattern,int most,int longest) {
    using (var file=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite)) {
      bool reset=from<0 || from>file.Length || (from>0 && Hash(file,from)!=mark);
      if (reset) from=0;
      long end=file.Length;
      var buffer=new byte[65536];
      while (end>0) {
        long start=Math.Max(0,end-buffer.Length); file.Position=start;
        int n=file.Read(buffer,0,(int)(end-start));
        int last=Array.LastIndexOf(buffer,(byte)10,n-1);
        if (last>=0) { end=start+last+1; break; }
        end=start;
      }
      if (!reset && from==end) return null;
      string sum=end>0 ? Hash(file,end) : "";
      var matches=new List<string>();
      var regex=new Regex(pattern,RegexOptions.IgnoreCase);
      var line=new MemoryStream();
      file.Position=from;
      while (file.Position<end) {
        int n=file.Read(buffer,0,(int)Math.Min(buffer.Length,end-file.Position));
        if (n==0) throw new EndOfStreamException();
        for (int i=0;i<n;i++) {
          if (buffer[i]==10) {
            if (line.Length<longest) {
              string text=Encoding.UTF8.GetString(line.ToArray()).Replace(@"\\",@"\");
              foreach (Match match in regex.Matches(text)) {
                string value=match.Value;
                matches.Remove(value); matches.Add(value);
                if (matches.Count>most) matches.RemoveAt(0);
              }
            }
            line.SetLength(0);
          } else if (line.Length<=longest) line.WriteByte(buffer[i]);
        }
      }
      return end+"\n"+from+"\n"+sum+"\n"+String.Join("\n",matches.ToArray());
    }
  }
}`;

export function transcriptApi(platform, run) {
  const ps = (script) => powershell(run, "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); " + script, { timeout: 60000 });
  return {
    scan: (file, from, mark, pattern, extensions, most, longest) => {
      if (platform !== "windows") return run("sh", ["-c", SCAN, "sh", file, String(from), pattern, String(most), String(mark)], { timeout: 60000 });
      const winPattern = `(?:[A-Za-z]:[\\\\/]|\\\\\\\\)[^"<>|\\r\\n]*?\\.(?:${extensions})(?![A-Za-z0-9])|[A-Za-z0-9@+._~/-]+\\.(?:${extensions})(?![A-Za-z0-9])`;
      return ps(`Add-Type -TypeDefinition ${psQuote(WINDOWS_SCAN.replace(/\s+/g, " "))}; $result=[KansoTranscript]::Scan(${psQuote(file)},${Number(from)},${psQuote(mark)},${psQuote(winPattern)},${Number(most)},${Number(longest)}); if ($null -eq $result) { exit 3 }; [Console]::Write($result)`);
    },
    locate: async (pid, kind, home) => {
      if (platform !== "windows") return { state: "ok", ...(await run("sh", ["-c", LOCATE, "sh", String(pid), kind])) };
      if (kind !== "claude") return { state: "unavailable", reason: "Conversation files of other processes require a Herdr API on Windows" };
      const file = paths.join(home, ".claude", "sessions", `${pid}.json`);
      return { state: "ok", ...(await ps(`if (Test-Path -LiteralPath ${psQuote(file)} -PathType Leaf) { [Console]::Write('claude'+[char]9+[IO.File]::ReadAllText(${psQuote(file)}).Replace([string][char]10,'')) }`)) };
    },
    size: async (file) => platform === "windows" ? Number((await ps(`(Get-Item -LiteralPath ${psQuote(file)}).Length`)).stdout.trim()) : Number((await run("sh", ["-c", 'wc -c < "$1"', "sh", file])).stdout.trim()),
    thread: (file) => platform === "windows" ? ps(`$file=${psQuote(file)}; `+WINDOWS_THREAD) : run("sh", ["-c", READ, "sh", file]),
    slice: (file, from, budget, longest) => platform === "windows" ? ps(`$file=${psQuote(file)}; $from=${Number(from)}; $budget=${Number(budget)}; $longest=${Number(longest)}; `+WINDOWS_SLICE) : unixSlice(run, file, from, budget, longest),
  };
}

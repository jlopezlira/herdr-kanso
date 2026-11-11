import { checked } from "./platform-command.js";
import { paths } from "./platform-paths.js";
import { fileApi } from "./platform-files.js";

const hash = (text) => [...String(text)].reduce((n, ch) => Math.imul(n ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261).toString(16);
const ADD_WORKTREE = String.raw`
cd "$1" 2>/dev/null || { echo "The project's folder is not there." >&2; exit 3; }
top=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "This project is not a git repository." >&2; exit 4; }
git check-ref-format --branch "$2" >/dev/null 2>&1 || { echo "That is not a branch name git takes." >&2; exit 5; }
there=$(git worktree list --porcelain | awk -v b="branch refs/heads/$2" '/^worktree /{p=substr($0,10)} $0==b{print p}' | head -n 1)
# A worktree whose folder was deleted is only git's note of it: that note goes, and the branch gets a folder again.
if [ -n "$there" ] && [ ! -d "$there" ]; then git worktree prune; there=""; fi
if [ -n "$there" ]; then printf 'there\t%s\n' "$there"; exit 0; fi
common=$(git rev-parse --path-format=absolute --git-common-dir)
main=$(dirname "$common")
base="$3"; [ -n "$base" ] || base="$HOME/.kanso/worktrees"
id=$(printf %s "$main" | cksum | cut -d' ' -f1 | cut -c1-6)
# feat/x and feat-x are two branches: the folder keeps a short hash of the name, so they never meet.
dest="$base/$(basename "$main")-$id/$(printf %s "$2" | tr '/' '-')-$(printf %s "$2" | cksum | cut -d' ' -f1 | cut -c1-4)"
if [ -e "$dest" ]; then echo "$dest is already there." >&2; exit 6; fi
mkdir -p "$(dirname "$dest")" || exit 7
if git show-ref --verify --quiet "refs/heads/$2"; then git worktree add "$dest" "$2" >&2 || exit 8
else git worktree add -b "$2" "$dest" >&2 || exit 8; fi
printf 'made\t%s\n' "$dest"
`;


const DISCOVER = `
list=$(for root in "$@"; do
  [ -d "$root" ] || continue
  find "$root" -maxdepth 9 \\( -name node_modules -o -name .venv -o -name venv -o -name target -o -name dist -o -name build -o -name .next \\
    -o -name .turbo -o -name .cache -o -name vendor -o -name Pods -o -name DerivedData -o -name coverage -o -name __pycache__ -o -name .Trash -o -name Library \\
    -o -path '*/.git/*' -a ! -path '*/.git/worktrees' -a ! -path '*/.git/worktrees/*' \\) -prune \\
    -o -path '*/.git/worktrees/*/gitdir' -type f -print -o -name .git -type f -print 2>/dev/null
done | sort -u)
printf '%s\\n' "$list" | grep '/\\.git/worktrees/.*/gitdir$' | sed 's#/\\.git/worktrees/.*##' | sort -u | awk '{ print "R\\t" $0 }'
printf '%s\\n' "$list" | grep '/\\.git$' | tr '\\n' '\\0' | xargs -0 grep -H -m 1 '^gitdir: ' 2>/dev/null | while IFS= read -r line; do
  f=\${line%%:gitdir: *}; g=\${line#*:gitdir: }
  case "$g" in */worktrees/*) ;; *) continue ;; esac
  case "$g" in /*) ;; *) g="\${f%/.git}/$g" ;; esac
  [ -e "$g" ] || printf 'O\\t%s\\n' "\${f%/.git}"
done
exit 0`;
const BASES = `
cd "$1" || exit 3
o=$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null)
for r in "$o" "\${o#origin/}" origin/main main origin/master master; do
  [ -n "$r" ] && git rev-parse -q --verify "$r^{commit}" >/dev/null 2>&1 && echo "$r"
done
for r in origin/develop develop origin/dev dev; do
  git rev-parse -q --verify "$r^{commit}" >/dev/null 2>&1 && echo "+$r"
done
exit 0`;
const PROBE = `
cd "$1" 2>/dev/null || { echo gone; exit 0; }
[ -d .git ] && { echo replaced; exit 0; }
# git can't read it (its .git names where the repository used to be): nothing
# below would be true, so it says so and stops.
git rev-parse --git-dir >/dev/null 2>&1 || { echo broken; exit 0; }
status=$(git --no-optional-locks status --porcelain=v1 --untracked-files=normal 2>/dev/null) || { echo broken; exit 0; }
idle=$2
shift 2
if [ "$idle" -gt 0 ] 2>/dev/null; then
  gd=$(git rev-parse --absolute-git-dir 2>/dev/null)
  if [ -n "$(find . -maxdepth 3 \\( -name node_modules -o -name .git \\) -prune -o -mmin -"$idle" -print 2>/dev/null | head -n 1)" ] ||
     { [ -n "$gd" ] && [ -n "$(find "$gd/HEAD" "$gd/logs/HEAD" -mmin -"$idle" 2>/dev/null | head -n 1)" ]; }; then echo recent; fi
fi
printf 'only\\t%s\\n' "$(git rev-list --count HEAD --not --branches --tags --remotes 2>/dev/null)"
printf 'dirty\\t%s\\n' "$(printf '%s' "$status" | grep -c .)"
printf 'last\\t%s\\n' "$(git log -1 --format=%ct 2>/dev/null)"
ahead=
for b in "$@"; do
  a=$(git rev-list --count "$b..HEAD" 2>/dev/null) || continue
  if [ -z "$ahead" ] || [ "$a" -lt "$ahead" ]; then ahead=$a; fi
  if git merge-base --is-ancestor HEAD "$b" 2>/dev/null; then echo merged; continue; fi
  t=$(git merge-tree --write-tree "$b" HEAD 2>/dev/null) && [ "$t" = "$(git rev-parse "$b^{tree}" 2>/dev/null)" ] && echo merged
done
printf 'ahead\\t%s\\n' "$ahead"
exit 0`;
const FORGET = `
c=$(git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 3
[ -d "$2/.git" ] || exit 4
for d in "$c"/worktrees/*/; do
  [ -f "$d/gitdir" ] || continue
  if [ "$(head -n 1 "$d/gitdir")" = "$2/.git" ]; then rm -rf -- "$d" && echo forgot; fi
done
exit 0`;
export function repositoryApi(platform, run) {
  const files = fileApi(platform, run);
  const git = (folder, args) => run("git", ["-C", folder, ...args]);
  const shell = (script, args) => run("bash", ["-c", script, "worktrees", ...args]);
  const bases = async (folder) => {
    if (platform !== "windows") return shell(BASES, [folder]);
    const origin = (await git(folder, ["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"])).stdout.trim();
    const candidates = [...new Set([origin, origin.replace(/^origin\//, ""), "origin/main", "main", "origin/master", "master", "origin/develop", "develop", "origin/dev", "dev"].filter(Boolean))];
    const found = await Promise.all(candidates.map(async (ref) => (await git(folder, ["rev-parse", "-q", "--verify", `${ref}^{commit}`])).code === 0 ? `${/(?:^|\/)(?:develop|dev)$/.test(ref) ? "+" : ""}${ref}` : null));
    return { code: 0, stdout: found.filter(Boolean).join("\n") };
  };
  const add = async (folder, branch, base, home) => {
    if (platform !== "windows") return run("sh", ["-c", ADD_WORKTREE, "sh", folder, branch, base]);
    checked(await git(folder, ["rev-parse", "--show-toplevel"]));
    checked(await git(folder, ["check-ref-format", "--branch", branch]));
    const listing = checked(await git(folder, ["worktree", "list", "--porcelain"])).stdout;
    const existing = listing.split(/\r?\n\r?\n/).find((block) => block.split(/\r?\n/).includes(`branch refs/heads/${branch}`))?.split(/\r?\n/)[0]?.slice(9);
    if (existing && await files.test(existing, "directory")) return { code: 0, stdout: `there\t${paths.normalize(existing)}` };
    if (existing) checked(await git(folder, ["worktree", "prune"]));
    const common = checked(await git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).stdout.trim();
    const main = paths.dirname(common), destination = paths.join(base || paths.join(home, ".kanso", "worktrees"), `${paths.basename(main)}-${hash(main).slice(0, 6)}`, `${branch.replace(/[\\/]/g, "-")}-${hash(branch).slice(0, 4)}`);
    if (await files.test(destination, "any")) throw new Error(`${destination} is already there.`);
    checked(await files.mkdir(paths.dirname(destination)));
    const hasBranch = (await git(folder, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0;
    checked(await git(folder, ["worktree", "add", ...(hasBranch ? [] : ["-b", branch]), destination, ...(hasBranch ? [branch] : [])]));
    return { code: 0, stdout: `made\t${destination}` };
  };
  const discover = async (roots) => {
    if (platform !== "windows") return shell(DISCOVER, roots);
    const markers = await files.walk(roots, { depth: 9, names: [".git"] });
    const results = await Promise.all(markers.map(async (marker) => {
      if (await files.test(marker, "directory")) return await files.test(paths.join(marker, "worktrees"), "directory") ? `R\t${paths.dirname(marker)}` : null;
      const line = (await files.read(marker)).split(/\r?\n/)[0];
      if (!line.startsWith("gitdir: ")) return null;
      const given = line.slice(8), target = paths.isAbsolute(given) ? given : paths.join(paths.dirname(marker), given);
      return /[\\/]worktrees[\\/]/.test(target) && !await files.test(target, "any") ? `O\t${paths.dirname(marker)}` : null;
    }));
    return { code: 0, stdout: [...new Set(results.filter(Boolean))].join("\n") };
  };
  const probe = async (folder, idle, refs) => {
    if (platform !== "windows") return shell(PROBE, [folder, String(idle), ...refs]);
    if (!await files.test(folder, "directory")) return { code: 0, stdout: "gone" };
    if (await files.test(paths.join(folder, ".git"), "directory")) return { code: 0, stdout: "replaced" };
    const status = await git(folder, ["--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=normal"]);
    if (status.code !== 0) return { code: 0, stdout: "broken" };
    const since = Date.now() - Number(idle) * 60000;
    const gitDir = Number(idle) > 0 ? checked(await git(folder, ["rev-parse", "--absolute-git-dir"])).stdout.trim() : null;
    const recent = gitDir ? await files.recent([folder, paths.join(gitDir, "HEAD"), paths.join(gitDir, "logs", "HEAD")], since)
      || (await files.walk([folder], { depth: 3, skip: [".git", "node_modules"], newer: since })).length > 0 : false;
    const only = checked(await git(folder, ["rev-list", "--count", "HEAD", "--not", "--branches", "--tags", "--remotes"])).stdout.trim();
    const last = checked(await git(folder, ["log", "-1", "--format=%ct"])).stdout.trim();
    const ancestors = await Promise.all(refs.map(async (ref) => {
      const count = await git(folder, ["rev-list", "--count", `${ref}..HEAD`]);
      if (count.code !== 0) return null;
      if ((await git(folder, ["merge-base", "--is-ancestor", "HEAD", ref])).code === 0) return { ahead: Number(count.stdout), merged: true };
      const tree = await git(folder, ["merge-tree", "--write-tree", ref, "HEAD"]);
      return { ahead: Number(count.stdout), merged: tree.code === 0 && tree.stdout.trim() === (await git(folder, ["rev-parse", `${ref}^{tree}`])).stdout.trim() };
    }));
    const valid = ancestors.filter(Boolean);
    return { code: 0, stdout: [`only\t${only}`, `dirty\t${status.stdout.trim().split(/\r?\n/).filter(Boolean).length}`, `last\t${last}`, `ahead\t${valid.length ? Math.min(...valid.map((value) => value.ahead)) : ""}`, ...(recent ? ["recent"] : []), ...(valid.some((value) => value.merged) ? ["merged"] : [])].join("\n") };
  };
  const forget = async (repo, folder) => {
    if (platform !== "windows") return shell(FORGET, [repo, folder]);
    if (!await files.test(paths.join(folder, ".git"), "directory")) throw new Error("The replacement is no longer a repository");
    const common = checked(await git(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).stdout.trim();
    const metadata = paths.join(common, "worktrees");
    const entries = await files.directory(metadata);
    const matches = await Promise.all(entries.filter((entry) => entry.dir).map(async (entry) => {
      const dir = paths.join(metadata, entry.name), marker = paths.join(dir, "gitdir");
      return await files.test(marker) && paths.equal((await files.read(marker)).trim(), paths.join(folder, ".git")) ? dir : null;
    }));
    const kept = matches.filter(Boolean);
    if (kept.length) checked(await files.remove(kept, { recursive: true }));
    return { code: 0, stdout: kept.map(() => "forgot").join("\n") };
  };
  const removeOrphan = async (folder) => {
    const marker = paths.join(folder, ".git");
    if (!await files.test(marker)) throw new Error("The worktree marker is no longer a file");
    const line = (await files.read(marker)).split(/\r?\n/)[0], given = line.startsWith("gitdir: ") ? line.slice(8) : "";
    if (!/[\\/]worktrees[\\/]/.test(given)) throw new Error("This is not an orphaned worktree");
    const target = paths.isAbsolute(given) ? given : paths.join(folder, given);
    if (await files.test(target, "any")) throw new Error("The worktree is registered again");
    return files.remove([folder], { recursive: true });
  };
  const fingerprint = async (folder) => {
    if (platform !== "windows") return run("sh", ["-c", 'cd "$1" 2>/dev/null && git rev-parse --path-format=absolute --git-common-dir --show-toplevel && (git config --get remote.origin.url || echo) && git for-each-ref --format="%(objectname)" | cksum', "sh", folder]);
    const roots = await git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"]);
    if (roots.code !== 0) return roots;
    const origin = await git(folder, ["config", "--get", "remote.origin.url"]);
    const refs = checked(await git(folder, ["for-each-ref", "--format=%(objectname)"]));
    return { code: 0, stdout: `${roots.stdout.trim()}\n${origin.code === 0 ? origin.stdout.trim() : ""}\n${hash(refs.stdout)}` };
  };
  return { createWorktree: add, discover, bases, probe, forget, removeOrphan, fingerprint };
}

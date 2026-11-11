// One adapter per provider. The panel asks this list and never a provider by name.
import { github } from "./pr-github.js";

export const providers = [github];

export function matchRemote(url, sessions) {
  for (const provider of providers) {
    const hit = provider.match(url, sessions?.[provider.id] ?? []);
    if (hit) return { provider: provider.id, ...hit };
  }
  return null;
}

// A provider that is not installed, or not signed in, is left out.
export async function readyProviders(run) {
  const sessions = await Promise.all(providers.map(async (provider) => ({ provider, session: await provider.probe(run) })));
  if (sessions.some(({ session }) => session.status === "late")) return null;
  return sessions.filter(({ session }) => session.status === "ok");
}

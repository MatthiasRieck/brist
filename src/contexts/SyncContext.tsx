import { createContext, ReactNode, useCallback, useContext, useRef, useState } from "react";
import { gitApi } from "@/lib/git";

interface SyncContextValue {
  /** Repos currently being fetched. */
  fetching: ReadonlySet<string>;
  /** Bumped every time a fetch finishes, so pages can reload git data. */
  syncVersion: number;
  fetchRepos: (paths: string[]) => Promise<void>;
}

const SyncContext = createContext<SyncContextValue>({
  fetching: new Set(),
  syncVersion: 0,
  fetchRepos: async () => {},
});

export function SyncProvider({ children }: { children: ReactNode }) {
  const [fetching, setFetching] = useState<Set<string>>(new Set());
  const [syncVersion, setSyncVersion] = useState(0);
  const inFlight = useRef(new Set<string>());

  const fetchRepos = useCallback(async (paths: string[]) => {
    const targets = paths.filter((p) => !inFlight.current.has(p));
    if (targets.length === 0) return;
    for (const p of targets) inFlight.current.add(p);
    setFetching(new Set(inFlight.current));
    await Promise.allSettled(
      targets.map(async (path) => {
        try {
          await gitApi.fetchRepo(path);
        } finally {
          inFlight.current.delete(path);
          setFetching(new Set(inFlight.current));
          setSyncVersion((v) => v + 1);
        }
      }),
    );
  }, []);

  return (
    <SyncContext.Provider value={{ fetching, syncVersion, fetchRepos }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  return useContext(SyncContext);
}

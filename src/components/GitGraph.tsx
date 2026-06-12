import { useMemo } from "react";
import type { GraphCommit } from "@/lib/git";
import { cn } from "@/lib/utils";

const COLORS = [
  "#0085d9",
  "#d9008f",
  "#00d90a",
  "#d98500",
  "#a300d9",
  "#ff4040",
  "#00d9cc",
  "#e8d900",
  "#85d900",
  "#dc5b23",
  "#6f24d6",
  "#3cb371",
];

const ROW_H = 26;
const COL_W = 14;
const DOT_R = 3.5;

interface LaneRef {
  lane: number;
  color: string;
}

interface RowLayout {
  commit: GraphCommit;
  lane: number;
  color: string;
  passThrough: LaneRef[];
  mergesIn: LaneRef[];
  forksOut: LaneRef[];
  hasLineUp: boolean;
  hasLineDown: boolean;
  laneCount: number;
}

function layoutGraph(commits: GraphCommit[]): { rows: RowLayout[]; maxLanes: number } {
  const lanes: (string | null)[] = [];
  const laneColor: number[] = [];
  let colorIdx = 0;
  let maxLanes = 1;

  const ensureLane = (): number => {
    const free = lanes.indexOf(null);
    if (free !== -1) return free;
    lanes.push(null);
    laneColor.push(0);
    return lanes.length - 1;
  };
  const colorOf = (lane: number) => COLORS[laneColor[lane] % COLORS.length];

  const rows = commits.map((commit) => {
    const matching: number[] = [];
    lanes.forEach((h, i) => {
      if (h === commit.hash) matching.push(i);
    });
    let lane: number;
    if (matching.length > 0) {
      lane = matching[0];
    } else {
      lane = ensureLane();
      laneColor[lane] = colorIdx++;
    }
    const color = colorOf(lane);
    const hasLineUp = matching.length > 0;
    const mergesIn: LaneRef[] = matching
      .filter((m) => m !== lane)
      .map((m) => ({ lane: m, color: colorOf(m) }));
    for (const m of matching) if (m !== lane) lanes[m] = null;

    const passThrough: LaneRef[] = [];
    lanes.forEach((h, i) => {
      if (h !== null && i !== lane) passThrough.push({ lane: i, color: colorOf(i) });
    });

    const [firstParent, ...extraParents] = commit.parents;
    lanes[lane] = firstParent ?? null;
    const hasLineDown = firstParent != null;

    const forksOut: LaneRef[] = [];
    for (const parent of extraParents) {
      let pl = lanes.findIndex((h) => h === parent);
      if (pl === -1) {
        pl = ensureLane();
        lanes[pl] = parent;
        laneColor[pl] = colorIdx++;
      }
      forksOut.push({ lane: pl, color: colorOf(pl) });
    }

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
      laneColor.pop();
    }
    const laneCount = Math.max(
      lane + 1,
      lanes.length,
      ...passThrough.map((p) => p.lane + 1),
      ...mergesIn.map((p) => p.lane + 1),
      ...forksOut.map((p) => p.lane + 1),
    );
    maxLanes = Math.max(maxLanes, laneCount);
    return {
      commit,
      lane,
      color,
      passThrough,
      mergesIn,
      forksOut,
      hasLineUp,
      hasLineDown,
      laneCount,
    };
  });

  return { rows, maxLanes };
}

function laneX(lane: number) {
  return lane * COL_W + COL_W / 2;
}

/// S-curve between two lanes, with vertical tangents at both ends.
function curve(x1: number, y1: number, x2: number, y2: number) {
  const my = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
}

function RowGraph({ row, width }: { row: RowLayout; width: number }) {
  const x = laneX(row.lane);
  const cy = ROW_H / 2;
  return (
    <svg width={width} height={ROW_H} className="shrink-0">
      {row.passThrough.map((p) => (
        <line
          key={`pt-${p.lane}`}
          x1={laneX(p.lane)}
          y1={0}
          x2={laneX(p.lane)}
          y2={ROW_H}
          stroke={p.color}
          strokeWidth={2}
        />
      ))}
      {row.mergesIn.map((m) => (
        <path
          key={`mi-${m.lane}`}
          d={curve(laneX(m.lane), 0, x, cy)}
          stroke={m.color}
          strokeWidth={2}
          fill="none"
        />
      ))}
      {row.forksOut.map((f) => (
        <path
          key={`fo-${f.lane}`}
          d={curve(x, cy, laneX(f.lane), ROW_H)}
          stroke={f.color}
          strokeWidth={2}
          fill="none"
        />
      ))}
      {row.hasLineUp && <line x1={x} y1={0} x2={x} y2={cy} stroke={row.color} strokeWidth={2} />}
      {row.hasLineDown && (
        <line x1={x} y1={cy} x2={x} y2={ROW_H} stroke={row.color} strokeWidth={2} />
      )}
      <circle
        cx={x}
        cy={cy}
        r={DOT_R}
        fill={row.commit.parents.length > 1 ? "var(--background)" : row.color}
        stroke={row.color}
        strokeWidth={2}
      />
    </svg>
  );
}

function RefChip({ name, color }: { name: string; color: string }) {
  const isHead = name === "HEAD";
  const isTag = name.startsWith("tag: ");
  const isRemote = !isTag && name.includes("/");
  return (
    <span
      className={cn(
        "shrink-0 rounded border px-1 font-mono text-[10px] leading-4 whitespace-nowrap",
        isHead && "font-bold",
        isRemote && "opacity-70",
      )}
      style={{ borderColor: color, color }}
    >
      {isTag ? name.slice(5) : name}
    </span>
  );
}

function timeAgo(unixSeconds: number): string {
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d`;
  if (diff < 86400 * 365) return `${Math.floor(diff / (86400 * 30))}mo`;
  return `${Math.floor(diff / (86400 * 365))}y`;
}

export function GitGraph({ commits }: { commits: GraphCommit[] }) {
  const { rows, maxLanes } = useMemo(() => layoutGraph(commits), [commits]);
  const graphWidth = maxLanes * COL_W + COL_W / 2;

  if (commits.length === 0) {
    return <p className="text-sm text-muted-foreground">No commits to display.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      {rows.map((row) => (
        <div
          key={row.commit.hash}
          className="flex items-center gap-2 pr-3 text-sm hover:bg-accent/50"
          style={{ height: ROW_H }}
        >
          <RowGraph row={row} width={graphWidth} />
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {row.commit.refs.map((r) => (
              <RefChip key={r} name={r} color={row.color} />
            ))}
            <span className="truncate">{row.commit.subject}</span>
          </div>
          <span className="w-32 shrink-0 truncate text-xs text-muted-foreground">
            {row.commit.author}
          </span>
          <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">
            {timeAgo(row.commit.date)}
          </span>
          <span className="w-16 shrink-0 text-right font-mono text-xs text-muted-foreground">
            {row.commit.hash.slice(0, 7)}
          </span>
        </div>
      ))}
    </div>
  );
}

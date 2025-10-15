import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Duco Visual Tracker — React MVP (Pointer-DnD for items)
 *
 * Changes in this build:
 *  - Replaced HTML5 DnD for ITEMS with a custom Pointer-based drag (smooth & precise)
 *  - You drag by grabbing the **bol** (circle), not the label
 *  - Keeps existing HTML5 DnD for Lanes & Groups (those were OK for you)
 *  - Instant sidepanel sync when status changes via popover
 *  - Status popover sits fully ABOVE the item
 *  - Normalizes optional arrays to avoid runtime errors
 */

// ---------- Types ----------
export type Status = "todo" | "doing" | "done";

export type HistoryItem = {
  ts: string; // ISO timestamp
  status: Status;
  comment?: string;
};

export type NodeItem = {
  id: string;
  label: string;
  status: Status;
  ts?: string; // when completed
  notes?: string;
  history?: HistoryItem[]; // optional in older links
};

export type Lane = {
  id: string;
  title: string;
  items: NodeItem[];
  groupId?: string; // undefined = ungrouped
};

export type Board = {
  id: string;
  title: string;
  lanes: Lane[]; // flat, ordering preserved across view modes
  groups?: { id: string; title: string }[];
  linkedBoardIds?: string[]; // simple hierarchy
};

// Drag state for lanes/groups (HTML5 DnD)
 type DragState =
  | { kind: "lane"; laneId: string; fromGroupId?: string | null }
  | { kind: "group"; groupId: string };

// Pointer-DnD state for items
 type PDrag = {
  itemId: string;
  fromLaneId: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  started: boolean;
  target?: { laneId: string; index: number } | null;
};

// ---------- Helpers ----------
const fmt = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

const statusColor: Record<Status, string> = {
  todo: "bg-gray-300 border-gray-400 text-gray-800",
  doing: "bg-amber-200 border-amber-400 text-amber-900",
  done: "bg-emerald-400 border-emerald-600 text-emerald-900",
};

function encodeToHash(data: unknown) {
  try {
    const json = JSON.stringify(data);
    const b64 = btoa(unescape(encodeURIComponent(json)));
    return `#data=${b64}`;
  } catch (e) {
    console.error("encode error", e);
    return "";
  }
}

function decodeFromHash<T>(): T | null {
  try {
    const hash = window.location.hash;
    const m = hash.match(/data=([^&]+)/);
    if (!m) return null;
    const json = decodeURIComponent(escape(atob(m[1])));
    return JSON.parse(json) as T;
  } catch (e) {
    console.error("decode error", e);
    return null;
  }
}

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Normalize boards so all optional arrays are present (prevents undefined errors). */
function normalizeBoards(bs: Board[]): Board[] {
  return bs.map((b) => ({
    ...b,
    lanes: b.lanes.map((l) => ({
      ...l,
      items: l.items.map((it) => ({
        ...it,
        history: Array.isArray(it.history) ? it.history : [],
        notes: typeof it.notes === "string" ? it.notes : "",
      })),
    })),
    groups: Array.isArray(b.groups) ? b.groups : [],
  }));
}

// ---------- Seed Data (Duco) ----------
const seedBoards: Board[] = normalizeBoards([
  {
    id: "duco_day",
    title: "Duco dagritme",
    lanes: [
      {
        id: "flesjes",
        title: "Flesjes",
        items: ["Flesje 1", "Flesje 2", "Flesje 3", "Flesje 4"].map((label, i) => ({
          id: uid("bottle"),
          label,
          status: i === 0 ? "done" : i === 1 ? "doing" : "todo",
          ts: i === 0 ? fmt(new Date()) : undefined,
          history: [
            { ts: fmt(new Date(Date.now() - 3600 * 1000 * 6)), status: "todo", comment: "Gepland" },
            { ts: fmt(new Date(Date.now() - 3600 * 1000 * 2)), status: i === 0 ? "done" : "doing", comment: i === 0 ? "Gedronken" : "Begonnen" },
          ],
        })),
      },
      {
        id: "slaapjes",
        title: "Slaapjes",
        items: ["Slaapje 1", "Slaapje 2", "Slaapje 3", "Slaapje 4"].map((label, i) => ({
          id: uid("nap"),
          label,
          status: i === 0 ? "done" : "todo",
          ts: i === 0 ? fmt(new Date(Date.now() - 3600 * 1000 * 3)) : undefined,
          history: [
            { ts: fmt(new Date(Date.now() - 3600 * 1000 * 8)), status: "todo" },
            { ts: fmt(new Date(Date.now() - 3600 * 1000 * 3)), status: i === 0 ? "done" : "todo" },
          ],
        })),
      },
    ],
    linkedBoardIds: ["duco_dev"],
  },
  {
    id: "duco_dev",
    title: "Duco ontwikkeling",
    lanes: [
      {
        id: "vaccins",
        title: "Vaccinaties",
        items: [
          { id: uid("vac"), label: "Batch 1", status: "done", ts: "2025-08-10 09:30", history: [{ ts: "2025-08-10 09:30", status: "done", comment: "Consult huisarts" }] },
          { id: uid("vac"), label: "Batch 2", status: "doing", history: [{ ts: fmt(new Date()), status: "doing", comment: "Afspraak ingepland" }] },
          { id: uid("vac"), label: "Batch 3", status: "todo", history: [] },
          { id: uid("vac"), label: "RS-virus", status: "todo", history: [] },
        ],
      },
      {
        id: "motoriek",
        title: "Motoriek",
        items: [
          { id: uid("dev"), label: "Omdraaien", status: "done", ts: "2025-09-20 19:02", history: [] },
          { id: uid("dev"), label: "Zitten", status: "todo", history: [] },
          { id: uid("dev"), label: "Kruipen", status: "todo", history: [] },
          { id: uid("dev"), label: "Staan", status: "todo", history: [] },
        ],
      },
    ],
    linkedBoardIds: ["duco_day"],
  },
]);

// ---------- Small, focused components (no nested hooks) ----------
function NodeLabel({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [temp, setTemp] = useState(value);
  useEffect(() => setTemp(value), [value]);
  if (!editing) {
    return (
      <div
        className="absolute left-1/2 -translate-x-1/2 top-12 text-[10px] text-gray-700 leading-tight text-center whitespace-nowrap select-none"
        onDoubleClick={() => setEditing(true)}
      >
        {value}
      </div>
    );
  }
  return (
    <input
      className="absolute left-1/2 -translate-x-1/2 top-12 text-[10px] text-gray-700 leading-tight text-center border rounded px-1 w-24"
      value={temp}
      onChange={(e) => setTemp(e.target.value)}
      autoFocus
      onBlur={() => {
        const v = temp.trim();
        if (v && v !== value) onCommit(v);
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}

function LaneTitle({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [temp, setTemp] = useState(value);
  useEffect(() => setTemp(value), [value]);
  if (!editing) {
    return (
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-3 select-none" onDoubleClick={() => setEditing(true)}>
        {value}
      </div>
    );
  }
  return (
    <input
      className="text-xs uppercase tracking-wide text-gray-700 mb-3 border rounded px-1"
      value={temp}
      autoFocus
      onChange={(e) => setTemp(e.target.value)}
      onBlur={() => {
        const v = temp.trim();
        if (v && v !== value) onCommit(v);
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}

function GroupHeader({ value, onCommit, onDragStart }: { value: string; onCommit: (v: string) => void; onDragStart: (e: React.DragEvent) => void }) {
  const [editing, setEditing] = useState(false);
  const [temp, setTemp] = useState(value);
  useEffect(() => setTemp(value), [value]);
  if (!editing) {
    return (
      <h2
        className="text-sm font-semibold text-gray-400 tracking-wider mb-3 select-none"
        onDoubleClick={() => setEditing(true)}
        draggable
        onDragStart={onDragStart}
        data-role="groupheader"
      >
        {value}
      </h2>
    );
  }
  return (
    <input
      className="text-sm font-semibold text-gray-700 tracking-wider mb-3 border rounded px-1"
      value={temp}
      autoFocus
      onChange={(e) => setTemp(e.target.value)}
      onBlur={() => {
        const v = temp.trim();
        if (v && v !== value) onCommit(v);
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}


function NodeCircle({
  item,
  onClick,
  onRename,
  onPointerDown,
  active,
}: {
  item: NodeItem;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onRename?: (newLabel: string) => void;
  onPointerDown?: (e: React.PointerEvent<HTMLButtonElement>) => void;
  active?: boolean;
}) {
  const color = statusColor[item.status];
  return (
    <div className="flex flex-col items-center w-20" data-role="nodecontainer">
      <button
        data-role="nodecircle"
        className={`w-10 h-10 rounded-full border ${color} hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 ${active ? "ring-2 ring-indigo-500" : ""}`}
        onClick={onClick}
        onPointerDown={onPointerDown}
        title={`${item.label}${item.ts ? ` — ${item.ts}` : ""}`}
      />
      <div className="mt-1 w-full flex flex-col items-center">
        <NodeLabel value={item.label} onCommit={(v) => onRename?.(v)} />
        {item.status === "done" && item.ts && (
          <div className="text-[10px] text-emerald-700 whitespace-nowrap select-none mt-0.5">{item.ts}</div>
        )}
      </div>
    </div>
  );
}

function LaneRow({
  lane,
  onSelect,
  onRenameItem,
  onDropToLaneEnd,
  onStartPointerItem,
  onRenameLane,
  onDropBetween,
  activeItemId,
  setGapRef,
  hotGapKey,
}: {
  lane: Lane;
  onSelect: (it: NodeItem, e: React.MouseEvent<HTMLButtonElement>) => void;
  onRenameItem: (it: NodeItem, newLabel: string) => void;
  onDropToLaneEnd: () => void;
  onStartPointerItem: (it: NodeItem, e: React.PointerEvent<HTMLButtonElement>) => void;
  onRenameLane: (laneId: string, newTitle: string) => void;
  onDropBetween: (index: number) => void;
  activeItemId?: string;
  setGapRef: (laneId: string, index: number) => (el: HTMLDivElement | null) => void;
  hotGapKey?: string;
}) {
  return (
    <div className="mb-16">
      <LaneTitle value={lane.title} onCommit={(v) => onRenameLane(lane.id, v)} />
      <div
        className="flex items-end justify-start gap-2"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onDropToLaneEnd();
        }}
      >
        {/* leading drop target to allow insert at index 0 */}
        <div
          className={`relative w-10 h-8`}
          ref={setGapRef(lane.id, 0)}
        >
          <div className={`absolute left-0 right-0 top-1/2 -translate-y-1/2 h-0.5 ${hotGapKey === `${lane.id}:0` ? 'bg-indigo-500 h-1' : 'bg-gray-300'}`} />
        </div>

        {lane.items.map((it, idx) => (
          <React.Fragment key={it.id}>
            <NodeCircle
              item={it}
              onClick={(e) => onSelect(it, e)}
              onRename={(nl) => onRenameItem(it, nl)}
              onPointerDown={(e) => onStartPointerItem(it, e)}
              active={it.id === activeItemId}
            />
            {/* droppable gap */}
            <div
              className={`relative w-12 h-8`}
              ref={setGapRef(lane.id, idx + 1)}
            >
              <div className={`absolute left-0 right-0 top-1/2 -translate-y-1/2 h-0.5 ${hotGapKey === `${lane.id}:${idx + 1}` ? 'bg-indigo-500 h-1' : 'bg-gray-300'}`} />
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function RightPanel({
  item,
  onUpdate,
  onClose,
}: {
  item: NodeItem | null;
  onUpdate: (patch: Partial<NodeItem>) => void;
  onClose: () => void;
}) {
  if (!item) return null;
  const [draft, setDraft] = useState(item?.notes || "");
  useEffect(() => setDraft(item?.notes || ""), [item?.id, item?.notes]);
  return (
    <div className="fixed right-0 top-20 h-[calc(100%-5rem)] w-96 border-l bg-white p-4 shadow-xl overflow-y-auto z-30" data-role="rightpanel">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold">{item.label}</h3>
        <button className="text-gray-500 hover:text-black" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <div className="text-xs text-gray-500 mb-1">Notities</div>
          <textarea
            className="w-full border rounded p-2 text-sm"
            rows={4}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Voeg context toe…"
          />
          <div className="flex justify-end mt-2">
            <button className="px-3 py-1.5 text-sm rounded border hover:bg-gray-50" onClick={() => onUpdate({ notes: draft })}>
              Opslaan
            </button>
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">Historie</div>
          <ul className="text-sm space-y-2">
            {(item.history || [])
              .slice()
              .reverse()
              .map((h, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span
                    className={`mt-1 inline-block w-2 h-2 rounded-full ${
                      h.status === "done" ? "bg-emerald-500" : h.status === "doing" ? "bg-amber-400" : "bg-gray-400"
                    }`}
                  />
                  <div>
                    <div className="font-medium">
                      {h.status} <span className="text-xs text-gray-500">{h.ts}</span>
                    </div>
                    {h.comment && <div className="text-gray-600">{h.comment}</div>}
                  </div>
                </li>
              ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ---------- Main App ----------
export default function App() {
  const decoded = useMemo(() => decodeFromHash<Board[]>(), []);
  const [boards, setBoards] = useState<Board[]>(normalizeBoards(decoded || seedBoards));
  const [activeId, setActiveId] = useState<string>(boards[0].id);
  const [selected, setSelected] = useState<NodeItem | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null); // lanes/groups

  // Pointer DnD for items
  const [pdrag, setPDrag] = useState<PDrag | null>(null);
  const suppressClickRef = useRef(false);
  const hotGapKey = useRef<string | undefined>(undefined);
  const [, setHotTick] = useState(0); // to re-render when hot gap changes

  // All droppable gap refs → used to find best target under pointer
  const gapRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const setGapRef = (laneId: string, index: number) => (el: HTMLDivElement | null) => {
    gapRefs.current[`${laneId}:${index}`] = el;
  };

  const active = boards.find((b) => b.id === activeId)!;
  const parents = boards.filter((b) => (b.linkedBoardIds || []).includes(activeId));

  useEffect(() => {
    const hash = encodeToHash(boards);
    if (hash) window.history.replaceState(null, "", hash);
  }, [boards]);

  // ---------- Update helpers ----------
  const updateSelected = (patch: Partial<NodeItem>) => {
    if (!selected) return;
    const now = fmt(new Date());
    const historyAdd: HistoryItem[] = [];
    if (patch.status) historyAdd.push({ ts: now, status: patch.status as Status, comment: patch.notes ? "Notes updated" : undefined });
    if (patch.notes !== undefined) historyAdd.push({ ts: now, status: (patch.status as Status) || selected.status, comment: patch.notes });
    updateItem(selected.id, patch);
    setSelected((s) => (s ? { ...s, ...patch, history: [...(s.history || []), ...historyAdd] } : s));
  };

  const updateItem = (itemId: string, patch: Partial<NodeItem>) => {
    const now = fmt(new Date());
    setBoards((prev) =>
      prev.map((b) =>
        b.id !== activeId
          ? b
          : {
              ...b,
              lanes: b.lanes.map((l) => ({
                ...l,
                items: l.items.map((it) => {
                  if (it.id !== itemId) return it;
                  const historyAdd: HistoryItem[] = [];
                  if (patch.status) historyAdd.push({ ts: now, status: patch.status as Status, comment: patch.notes ? "Notes updated" : undefined });
                  if (patch.notes !== undefined) historyAdd.push({ ts: now, status: (patch.status as Status) || it.status, comment: patch.notes });
                  const updated: NodeItem = { ...it, ...patch, history: [...(it.history || []), ...historyAdd] };
                  return updated;
                }),
              })),
            }
      )
    );

    // keep sidepanel instantly in sync when popover changes status
    setSelected((s) => (s && s.id === itemId ? { ...s, ...patch, history: [...(s.history || []), ...(patch.notes !== undefined || patch.status ? [{ ts: now, status: (patch.status as Status) || s.status, comment: patch.notes } as HistoryItem] : [])] } : s));
  };

  // Move item to position independent of HTML5 DnD (used by pointer-DnD)
  const moveItemPointer = (itemId: string, targetLaneId: string, targetIndex: number) => {
    setBoards((prev) =>
      prev.map((b) => {
        if (b.id !== activeId) return b;
        let moving: NodeItem | null = null;
        let lanes = b.lanes.map((l) => {
          const idx = l.items.findIndex((x) => x.id === itemId);
          if (idx >= 0) {
            moving = l.items[idx];
            const items = l.items.slice();
            items.splice(idx, 1);
            return { ...l, items };
          }
          return l;
        });
        if (!moving) return b;
        lanes = lanes.map((l) => {
          if (l.id !== targetLaneId) return l;
          const items = l.items.slice();
          const insertAt = Math.max(0, Math.min(targetIndex, items.length));
          items.splice(insertAt, 0, moving!);
          return { ...l, items };
        });
        return { ...b, lanes };
      })
    );
  };

  // ---------- HTML5 Drag helpers (lanes/groups) ----------
  const startDragLane = (lane: Lane, e: React.DragEvent) => {
    try { e.dataTransfer.setData("text/plain", lane.id); e.dataTransfer.effectAllowed = "move"; } catch {}
    setDrag({ kind: "lane", laneId: lane.id, fromGroupId: lane.groupId ?? null });
  };

  const startDragGroup = (groupId: string, e: React.DragEvent) => {
    try { e.dataTransfer.setData("text/plain", groupId); e.dataTransfer.effectAllowed = "move"; } catch {}
    setDrag({ kind: "group", groupId });
  };

  const moveLaneTo = (targetGroupId: string | undefined, targetIndex: number) => {
    if (!drag || drag.kind !== "lane") return;
    setBoards((prev) =>
      prev.map((b) => {
        if (b.id !== activeId) return b;
        const toId = targetGroupId ?? undefined;
        let moving: Lane | null = null;
        const without = b.lanes.filter((l) => {
          if (l.id === drag.laneId) { moving = l; return false; }
          return true;
        });
        if (!moving) return b;
        const moved: Lane = { ...moving, groupId: toId };
        // compute absolute insert index among lanes with same groupId
        let count = 0; let inserted = false; const next: Lane[] = [];
        for (const l of without) {
          if (!inserted && l.groupId === toId && count === targetIndex) { next.push(moved); inserted = true; }
          next.push(l);
          if (l.groupId === toId) count++;
        }
        if (!inserted) next.push(moved);
        return { ...b, lanes: next };
      })
    );
    setDrag(null);
  };

  const moveGroupTo = (targetIndex: number) => {
    if (!drag || drag.kind !== "group") return;
    setBoards((prev) =>
      prev.map((b) => {
        if (b.id !== activeId) return b;
        const groups = [...(b.groups || [])];
        const idx = groups.findIndex((g) => g.id === drag.groupId);
        if (idx < 0) return b;
        const [g] = groups.splice(idx, 1);
        const insertAt = Math.max(0, Math.min(targetIndex, groups.length));
        groups.splice(insertAt, 0, g);
        return { ...b, groups };
      })
    );
    setDrag(null);
  };

  // ---------- Pointer-DnD (items) ----------
  const calcBestTarget = (clientX: number, clientY: number): { laneId: string; index: number } | null => {
    let bestKey: string | null = null;
    let bestDist = Infinity;
    for (const [key, el] of Object.entries(gapRefs.current)) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const inside = clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
      const d = inside ? 0 : (cx - clientX) ** 2 + (cy - clientY) ** 2;
      if (d < bestDist) { bestDist = d; bestKey = key; }
    }
    if (!bestKey) return null;
    const [laneId, indexStr] = bestKey.split(":");
    return { laneId, index: parseInt(indexStr, 10) };
  };

  useEffect(() => {
    if (!pdrag) return;

    const onMove = (ev: PointerEvent) => {
      const x = ev.clientX, y = ev.clientY;
      const started = pdrag.started || Math.abs(x - pdrag.startX) > 4 || Math.abs(y - pdrag.startY) > 4;
      const target = calcBestTarget(x, y);

      // Auto-scroll
      const t = 80;
      if (y < t) window.scrollBy(0, -12);
      else if (window.innerHeight - y < t) window.scrollBy(0, 12);

      // Visual hot gap
      const newHot = target ? `${target.laneId}:${target.index}` : undefined;
      if (hotGapKey.current !== newHot) { hotGapKey.current = newHot; setHotTick((v) => v + 1); }

      setPDrag((pd) => (pd ? { ...pd, x, y, started, target } : pd));
    };

    const onUp = (ev: PointerEvent) => {
      // if we really dragged, suppress the click that would follow
      if (pdrag.started) suppressClickRef.current = true;
      if (pdrag.started && pdrag.target) {
        moveItemPointer(pdrag.itemId, pdrag.target.laneId, pdrag.target.index);
      }
      setPDrag(null);
      hotGapKey.current = undefined;
      setHotTick((v) => v + 1);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp, true);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp, true);
    };
  }, [pdrag]);

  const handleItemPointerDown = (it: NodeItem, fromLaneId: string) => (e: React.PointerEvent<HTMLButtonElement>) => {
    // Start pointer-DnD off the circle itself
    setPDrag({ itemId: it.id, fromLaneId, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, started: false, target: null });
  };

  // background click → close popover + panel (unless clicking on guarded UI)
  const handleBackgroundClick = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest('[data-role="nodecircle"], [data-role="nodecontainer"], [data-role="status-popover"], [data-role="rightpanel"], [aria-label="Menu"], select')) return;
    setSelected(null);
    setStatusFly(null);
  };

  const [statusFly, setStatusFly] = useState<{ itemId: string; x: number; y: number } | null>(null);

  return (
    <div className="min-h-screen bg-white text-gray-900" onDragEnd={() => setDrag(null)}>
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-start gap-3">
          <div className="flex flex-col">
            <h1 className="text-3xl font-extrabold leading-tight tracking-tight">{boards.find(b=>b.id===activeId)?.title}</h1>
            {boards.filter((b) => (b.linkedBoardIds || []).includes(activeId)).length > 0 && (
              <div className="text-sm text-gray-500 mt-1 flex items-center gap-2">
                <span>Onderdeel van:</span>
                {boards.filter((b) => (b.linkedBoardIds || []).includes(activeId)).map((p, idx) => (
                  <span key={p.id}>
                    <button className="underline hover:no-underline text-gray-700 font-semibold px-2 py-1 rounded bg-black/80 text-white" onClick={() => setActiveId(p.id)}>
                      {p.title}
                    </button>
                    {idx < boards.filter((b) => (b.linkedBoardIds || []).includes(activeId)).length - 1 ? ", " : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="ml-auto relative">
            <button className="px-3 py-1.5 text-sm rounded border hover:bg-gray-50" onClick={() => setShowMenu((v) => !v)} aria-label="Menu">
              ⋮
            </button>
            {showMenu && (
              <div className="absolute right-0 mt-2 w-56 bg-white border rounded shadow-lg p-2 space-y-2 z-20">
                <div className="text-xs text-gray-500 px-2">Sheet</div>
                <select
                  className="w-full border rounded px-2 py-1 text-sm"
                  value={activeId}
                  onChange={(e) => {
                    setActiveId(e.target.value);
                    setShowMenu(false);
                  }}
                  title="Wissel van sheet"
                >
                  {boards.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title}
                    </option>
                  ))}
                </select>
                <button onClick={() => { const url = window.location.href; navigator.clipboard?.writeText(url).catch(()=>{}); setShowMenu(false); }} className="w-full text-left px-2 py-1 rounded hover:bg-gray-50">
                  Deel link kopiëren
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <main
        className={`max-w-4xl mx-auto px-4 py-8 ${pdrag?.started ? 'select-none cursor-grabbing' : ''}`}
        onClickCapture={(e) => {
          if (suppressClickRef.current) { suppressClickRef.current = false; e.stopPropagation(); e.preventDefault(); return; }
          handleBackgroundClick(e);
        }}
        onDragOver={(e) => {
          const y = e.clientY; const t = 80;
          if (y < t) window.scrollBy(0, -12);
          else if (window.innerHeight - y < t) window.scrollBy(0, 12);
        }}
      >
        {statusFly && (
          <div className="fixed z-50 -translate-x-1/2 -translate-y-full -mt-2" data-role="status-popover" style={{ left: statusFly.x, top: statusFly.y }}>
            <div className="flex gap-1 bg-white border rounded-xl shadow-md p-1">
              {(["todo", "doing", "done"] as Status[]).map((s) => (
                <button
                  key={s}
                  className="px-2 py-1 rounded border text-xs hover:bg-gray-100 focus:bg-gray-200"
                  onClick={(ev) => {
                    const patch: Partial<NodeItem> = { status: s as Status };
                    if (s === "done") (patch as any).ts = fmt(new Date());
                    updateItem(statusFly.itemId, patch);
                    setStatusFly(null);
                    ev.stopPropagation();
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* GROUPS RENDERING */}
        {active.groups && active.groups.length > 0 ? (
          <div>
            {/* group drop at start */}
            <div className="h-6" onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{ e.preventDefault(); if ((drag as DragState | null)?.kind==='group') moveGroupTo(0); }} />

            {active.groups.map((g, gi) => (
              <section key={g.id} className="mb-10">
                {/* group header (draggable) */}
                <GroupHeader
                  value={g.title}
                  onCommit={(v) =>
                    setBoards((prev) =>
                      prev.map((b) => (b.id !== activeId ? b : { ...b, groups: (b.groups || []).map((gg) => (gg.id === g.id ? { ...gg, title: v } : gg)) }))
                    )
                  }
                  onDragStart={(e)=> setDrag({ kind: 'group', groupId: g.id })}
                />

                {/* lane gaps BEFORE lanes (to drop lanes into group at index 0) */}
                <div className="h-4" onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{ e.preventDefault(); if ((drag as DragState | null)?.kind==='lane') moveLaneTo(g.id, 0); if ((drag as DragState | null)?.kind==='group') moveGroupTo(gi); }} />

                {active.lanes
                  .filter((l) => l.groupId === g.id)
                  .map((lane, li) => (
                    <React.Fragment key={lane.id}>
                      {/* lane container (draggable) */}
                      <div draggable onDragStart={(e)=> setDrag({ kind: 'lane', laneId: lane.id, fromGroupId: lane.groupId ?? null })} data-role="lane">
                        <LaneRow
                          lane={lane}
                          onSelect={(it, e) => {
                            e.stopPropagation();
                            if (selected && selected.id === it.id) { setSelected(null); setStatusFly(null); return; }
                            setSelected(it);
                            const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                            setStatusFly({ itemId: it.id, x: rect.left + rect.width / 2, y: rect.top });
                          }}
                          onRenameItem={(it, nl) => updateItem(it.id, { label: nl })}
                          onDropToLaneEnd={() => moveItemPointer(selected?.id || '', lane.id, lane.items.length)}
                          onStartPointerItem={(it, e) => handleItemPointerDown(it, lane.id)(e)}
                          onRenameLane={(laneId, title) =>
                            setBoards((prev) => prev.map((b) => (b.id !== activeId ? b : { ...b, lanes: b.lanes.map((l) => (l.id === laneId ? { ...l, title } : l)) })))
                          }
                          onDropBetween={(index) => moveItemPointer(selected?.id || '', lane.id, index)}
                          activeItemId={selected?.id || ""}
                          setGapRef={setGapRef}
                          hotGapKey={hotGapKey.current ?? undefined}
                        />
                      </div>
                      {/* lane drop gap (after lane) */}
                      <div className="h-4" onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{ e.preventDefault(); if ((drag as DragState | null)?.kind==='lane') moveLaneTo(g.id, li+1); if ((drag as DragState | null)?.kind==='group') moveGroupTo(gi+1); }} />
                    </React.Fragment>
                  ))}
              </section>
            ))}

            {/* ungrouped lanes under groups (still visible if any) */}
            {active.lanes.filter(l=>!l.groupId).length>0 && (
              <section className="mb-10">
                <h2 className="text-sm font-semibold text-gray-400 tracking-wider mb-3">Zonder groep</h2>
                {/* lane gap at start of ungrouped */}
                <div className="h-4" onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{ e.preventDefault(); if ((drag as DragState | null)?.kind==='lane') moveLaneTo(undefined, 0); }} />
                {active.lanes.filter(l=>!l.groupId).map((lane, li)=> (
                  <React.Fragment key={lane.id}>
                    <div draggable onDragStart={(e)=> setDrag({ kind: 'lane', laneId: lane.id, fromGroupId: lane.groupId ?? null })} data-role="lane">
                      <LaneRow
                        lane={lane}
                        onSelect={(it, e) => {
                          e.stopPropagation();
                          if (selected && selected.id === it.id) { setSelected(null); setStatusFly(null); return; }
                          setSelected(it);
                          const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                          setStatusFly({ itemId: it.id, x: rect.left + rect.width / 2, y: rect.top });
                        }}
                        onRenameItem={(it, nl) => updateItem(it.id, { label: nl })}
                        onDropToLaneEnd={() => moveItemPointer(selected?.id || '', lane.id, lane.items.length)}
                        onStartPointerItem={(it, e) => handleItemPointerDown(it, lane.id)(e)}
                        onRenameLane={(laneId, title) => setBoards((prev) => prev.map((b) => (b.id !== activeId ? b : { ...b, lanes: b.lanes.map((l) => (l.id === laneId ? { ...l, title } : l)) })))}
                        onDropBetween={(index) => moveItemPointer(selected?.id || '', lane.id, index)}
                        activeItemId={selected?.id || ""}
                        setGapRef={setGapRef}
                        hotGapKey={hotGapKey.current ?? undefined}
                      />
                    </div>
                    {/* lane gap after */}
                    <div className="h-4" onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{ e.preventDefault(); if ((drag as DragState | null)?.kind==='lane') moveLaneTo(undefined, li+1); }} />
                  </React.Fragment>
                ))}
              </section>
            )}

            {/* group drop at end */}
            <div className="h-6" onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{ e.preventDefault(); if ((drag as DragState | null)?.kind==='group') moveGroupTo((active.groups||[]).length); }} />
          </div>
        ) : (
          // NO GROUPS: render lanes with lane-level DnD gaps
          <div>
            {/* lane gap at start */}
            <div className="h-4" onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{ e.preventDefault(); if ((drag as DragState | null)?.kind==='lane') moveLaneTo(undefined, 0); }} />
            {active.lanes.map((lane, li)=> (
              <React.Fragment key={lane.id}>
                <div draggable onDragStart={(e)=> setDrag({ kind: 'lane', laneId: lane.id, fromGroupId: lane.groupId ?? null })} data-role="lane">
                  <LaneRow
                    lane={lane}
                    onSelect={(it, e) => {
                      e.stopPropagation();
                      if (selected && selected.id === it.id) { setSelected(null); setStatusFly(null); return; }
                      setSelected(it);
                      const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                      setStatusFly({ itemId: it.id, x: rect.left + rect.width / 2, y: rect.top });
                    }}
                    onRenameItem={(it, nl) => updateItem(it.id, { label: nl })}
                    onDropToLaneEnd={() => moveItemPointer(selected?.id || '', lane.id, lane.items.length)}
                    onStartPointerItem={(it, e) => handleItemPointerDown(it, lane.id)(e)}
                    onRenameLane={(laneId, title) => setBoards((prev) => prev.map((b) => (b.id !== activeId ? b : { ...b, lanes: b.lanes.map((l) => (l.id === laneId ? { ...l, title } : l)) })))}
                    onDropBetween={(index) => moveItemPointer(selected?.id || '', lane.id, index)}
                    activeItemId={selected?.id || ""}
                    setGapRef={setGapRef}
                    hotGapKey={hotGapKey.current ?? undefined}
                  />
                </div>
                {/* lane gap after */}
                <div className="h-4" onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{ e.preventDefault(); if ((drag as DragState | null)?.kind==='lane') moveLaneTo(undefined, li+1); }} />
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Floating ghost while dragging item */}
        {pdrag && pdrag.started && (
          <div className="fixed z-50 pointer-events-none" style={{ left: pdrag.x - 20, top: pdrag.y - 20 }}>
            <div className="w-10 h-10 rounded-full border bg-white shadow-xl opacity-90" />
          </div>
        )}

        {/* Floating Action Button */}
        <div
          className="fixed bottom-6 z-30 transition-all duration-300"
          style={{ right: selected ? 408 : 24 }}
        >
          {fabOpen && (
            <div className="mb-3 p-2 border rounded-lg bg-white shadow-lg w-40 space-y-2">
              <button
                className="w-full text-left px-2 py-1 rounded hover:bg-gray-50"
                onClick={() => {
                  setBoards((prev) =>
                    prev.map((b) => {
                      if (b.id !== activeId) return b;
                      if (b.lanes.length === 0) {
                        return { ...b, lanes: [{ id: uid("lane"), title: "Nieuwe rij", items: [{ id: uid("item"), label: "Mijlpaal 1", status: "todo", history: [] }] }] };
                      }
                      const laneIdx = b.lanes.length - 1;
                      const lane = b.lanes[laneIdx];
                      if (!lane) return b;
                      const newItem: NodeItem = { id: uid("item"), label: `Mijlpaal ${lane.items.length + 1}`, status: "todo", history: [] };
                      const lanes = b.lanes.slice();
                      lanes[laneIdx] = { ...lane, items: [...lane.items, newItem], id: lane.id, title: lane.title, groupId: lane.groupId };
                      return { ...b, lanes };
                    })
                  );
                  setFabOpen(false);
                }}
              >
                + item
              </button>
              <button
                className="w-full text-left px-2 py-1 rounded hover:bg-gray-50"
                onClick={() => {
                  setBoards((prev) =>
                    prev.map((b) => {
                      if (b.id !== activeId) return b;
                      const maybeGroupId = b.groups && b.groups.length > 0 ? b.groups[b.groups.length - 1].id : "";
                      const newLane: Lane = { id: uid("lane"), title: "Nieuwe rij", items: [{ id: uid("item"), label: "Mijlpaal 1", status: "todo", history: [] }], groupId: maybeGroupId };
                      return { ...b, lanes: [...b.lanes, newLane] };
                    })
                  );
                  setFabOpen(false);
                }}
              >
                + row
              </button>
              <button
                className="w-full text-left px-2 py-1 rounded hover:bg-gray-50"
                onClick={() => {
                  setBoards((prev) =>
                    prev.map((b) => {
                      if (b.id !== activeId) return b;
                      const newGroup = { id: uid("group"), title: "Nieuwe groep" };
                      const groups = [...(b.groups || []), newGroup];
                      return { ...b, groups };
                    })
                  );
                  setFabOpen(false);
                }}
              >
                + group
              </button>
            </div>
          )}
          <button aria-label="Add" className="w-14 h-14 rounded-full shadow-lg border bg-black text-white text-2xl flex items-center justify-center" onClick={() => setFabOpen((v) => !v)}>
            +
          </button>
        </div>
      </main>

  <RightPanel item={selected} onUpdate={updateSelected} onClose={() => setSelected(null)} />
    </div>
  );
}


// ---------- Tiny self-tests (console only) ----------
(function selfTests() {
  const assert = (name: string, cond: boolean) => { console[cond ? "log" : "error"](`TEST ${cond ? "PASS" : "FAIL"}: ${name}`); };

  // 1) normalizeBoards should fill missing history
  const messy: Board[] = [ { id: "x", title: "t", lanes: [{ id: "l", title: "L", items: [{ id: "i", label: "A", status: "todo" as Status }] }] } ];
  // (optioneel: voeg hier meer tests toe of sluit de functie netjes af)
})();

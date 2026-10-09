type TimelineLike = {
  id: string;
  phase: string;
  description: string;
  occurredAt: Date | string;
  attackMappings: string[];
};

type TechniqueGroup = {
  techniqueId: string;
  entries: TimelineLike[];
};

function groupByTechnique(entries: TimelineLike[]): TechniqueGroup[] {
  const order: string[] = [];
  const map = new Map<string, TimelineLike[]>();
  const sorted = [...entries].sort((a, b) => {
    const aTime = new Date(a.occurredAt).getTime();
    const bTime = new Date(b.occurredAt).getTime();
    return aTime - bTime;
  });
  for (const entry of sorted) {
    for (const raw of entry.attackMappings ?? []) {
      const techniqueId = String(raw).trim();
      if (!techniqueId) continue;
      if (!map.has(techniqueId)) {
        order.push(techniqueId);
        map.set(techniqueId, []);
      }
      map.get(techniqueId)!.push(entry);
    }
  }
  return order.map((techniqueId) => ({
    techniqueId,
    entries: map.get(techniqueId) ?? [],
  }));
}

export function AttackChain({ timeline }: { timeline: TimelineLike[] }) {
  const groups = groupByTechnique(timeline);

  if (!groups.length) {
    return (
      <div className="rounded-lg border border-dashed bg-[var(--mist)] px-4 py-6 text-center text-sm text-slate-500">
        No ATT&amp;CK mappings on timeline events yet. Add technique IDs when
        logging activity to build the attack chain.
      </div>
    );
  }

  const boxWidth = 140;
  const boxHeight = 56;
  const gap = 36;
  const padX = 16;
  const padY = 20;
  const width = padX * 2 + groups.length * boxWidth + (groups.length - 1) * gap;
  const height = padY * 2 + boxHeight + 28;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border bg-paper p-3">
        <svg
          role="img"
          aria-label="Attack chain by ATT&CK technique"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="max-w-none"
        >
          {groups.map((group, index) => {
            const x = padX + index * (boxWidth + gap);
            const y = padY;
            const cx = x + boxWidth;
            const midY = y + boxHeight / 2;
            return (
              <g key={group.techniqueId}>
                {index < groups.length - 1 ? (
                  <line
                    x1={cx}
                    y1={midY}
                    x2={cx + gap}
                    y2={midY}
                    stroke="var(--harbour-400, #5b7c99)"
                    strokeWidth={2}
                    markerEnd="url(#attack-chain-arrow)"
                  />
                ) : null}
                <rect
                  x={x}
                  y={y}
                  width={boxWidth}
                  height={boxHeight}
                  rx={8}
                  fill="var(--harbour-50, #eef5fa)"
                  stroke="var(--harbour-300, #8aa9bb)"
                  strokeWidth={1.5}
                />
                <text
                  x={x + boxWidth / 2}
                  y={y + 22}
                  textAnchor="middle"
                  className="fill-slate-900"
                  fontSize={13}
                  fontWeight={600}
                >
                  {group.techniqueId}
                </text>
                <text
                  x={x + boxWidth / 2}
                  y={y + 40}
                  textAnchor="middle"
                  className="fill-slate-500"
                  fontSize={11}
                >
                  {group.entries.length} event
                  {group.entries.length === 1 ? "" : "s"}
                </text>
              </g>
            );
          })}
          <defs>
            <marker
              id="attack-chain-arrow"
              markerWidth="8"
              markerHeight="8"
              refX="6"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L6,3 L0,6 Z" fill="var(--harbour-400, #5b7c99)" />
            </marker>
          </defs>
        </svg>
      </div>
      <ol className="space-y-2 text-sm">
        {groups.map((group, index) => (
          <li
            key={group.techniqueId}
            className="rounded-md border bg-[var(--mist)] px-3 py-2"
          >
            <div className="font-medium text-slate-800">
              {index + 1}. {group.techniqueId}
            </div>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-600">
              {group.entries.map((entry) => (
                <li key={`${group.techniqueId}-${entry.id}`}>
                  <span className="font-medium">{entry.phase}</span>
                  {" — "}
                  {entry.description}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}

"use client";

import * as React from "react";
import type { B50Snapshot } from "@/lib/types";
import { compareSnapshots, type ComparedField } from "@/lib/history-diff";
import { clearTypeLabel, difficultyLabel } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const labels: Record<ComparedField, string> = {
  score: "分数", rating: "单曲 PTT", perfectCount: "PURE", nearCount: "FAR",
  missCount: "LOST", clearType: "通关状态", modifier: "Modifier", timePlayed: "游玩时间",
};
const kinds = { added: "新增", removed: "移出", changed: "变化", unchanged: "未变化" };
const timestamp = (value: string | number) => new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
}).format(new Date(value));
const delta = (value: number, digits = 0) => {
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(digits)}`;
};
function fieldValue(field: ComparedField, value: number) {
  if (field === "timePlayed") return timestamp(value);
  if (field === "clearType") return clearTypeLabel(value);
  if (field === "rating") return value.toFixed(3);
  return value.toLocaleString("en-US");
}

export function HistoryCompare({ snapshots }: { snapshots: B50Snapshot[] }) {
  const [beforeId, setBeforeId] = React.useState(snapshots[1]?.id || snapshots[0]?.id || "");
  const [afterId, setAfterId] = React.useState(snapshots[0]?.id || "");
  const [showUnchanged, setShowUnchanged] = React.useState(false);
  const before = snapshots.find((item) => item.id === beforeId);
  const after = snapshots.find((item) => item.id === afterId);
  const rows = React.useMemo(() => before && after ? compareSnapshots(before, after) : [], [before, after]);
  if (snapshots.length < 2) return <section className="history-compare"><h2>历史对比</h2><p>至少需要两次历史记录才能对比。</p></section>;
  return (
    <section className="history-compare" aria-label="历史对比">
      <h2>历史对比</h2>
      <p>选择基准 A 和目标 B，差值按 B − A 计算；新增和移出仅表示 B50 列表成员变化。时间为北京时间。</p>
      <div className="compare-controls">
        <label>基准 A<select value={beforeId} onChange={(event) => setBeforeId(event.target.value)}>{snapshots.map((item) => <option key={item.id} value={item.id}>{timestamp(item.fetchedAt)} · {item.potential.toFixed(3)} · {item.id}</option>)}</select></label>
        <Button variant="secondary" size="sm" onClick={() => { setBeforeId(afterId); setAfterId(beforeId); }}>交换 A / B</Button>
        <label>目标 B<select value={afterId} onChange={(event) => setAfterId(event.target.value)}>{snapshots.map((item) => <option key={item.id} value={item.id}>{timestamp(item.fetchedAt)} · {item.potential.toFixed(3)} · {item.id}</option>)}</select></label>
      </div>
      {beforeId === afterId ? <p role="status">请选择两次不同的历史记录。</p> : before && after ? <>
        <div className="compare-summary">
          <span>潜力值：{before.potential.toFixed(3)} → {after.potential.toFixed(3)} <strong>({delta(after.potential - before.potential, 3)})</strong></span>
          <span>加权 PTT：{before.weightedPotential.toFixed(3)} → {after.weightedPotential.toFixed(3)} <strong>({delta(after.weightedPotential - before.weightedPotential, 3)})</strong></span>
          <span>{Object.entries(kinds).map(([kind, label]) => `${label} ${rows.filter((row) => row.kind === kind).length}`).join(" · ")}</span>
        </div>
        <label className="compare-filter"><input type="checkbox" checked={showUnchanged} onChange={(event) => setShowUnchanged(event.target.checked)} />显示未变化的谱面</label>
        {!rows.some((row) => row.kind !== "unchanged") ? <p role="status">两次 B50 的谱面、成绩和排名均无变化。</p> : null}
        <div className="compare-rows">{rows.filter((row) => showUnchanged || row.kind !== "unchanged").map((row) => {
          const score = (row.after || row.before)!.score;
          return <article className={`compare-row compare-${row.kind}`} key={row.key}>
            <div className="compare-row-title"><span className="compare-kind">{kinds[row.kind]}</span><strong>{score.title.en || score.title.ja || score.title.zh || score.songId}</strong><span>{difficultyLabel(score.difficulty)}{score.modifier ? ` · MOD ${score.modifier}` : ""}</span></div>
            <div className="compare-values">
              <span>排名：{row.before ? `#${row.before.rank}` : "—"} → {row.after ? `#${row.after.rank}` : "—"}</span>
              {row.before && row.after ? row.fields.map((field) => <span key={field}>{labels[field]}：{fieldValue(field, row.before!.score[field])} → {fieldValue(field, row.after!.score[field])}{field === "score" || field === "rating" ? ` (${delta(row.after!.score[field] - row.before!.score[field], field === "rating" ? 3 : 0)})` : ""}</span>) : <><span>分数：{row.before ? fieldValue("score", score.score) : "—"} → {row.after ? fieldValue("score", score.score) : "—"}</span><span>单曲 PTT：{row.before ? score.rating.toFixed(3) : "—"} → {row.after ? score.rating.toFixed(3) : "—"}</span></>}
            </div>
          </article>;
        })}</div>
      </> : null}
    </section>
  );
}

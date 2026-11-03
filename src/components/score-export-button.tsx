import { useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import type { Best50Score, SongScore } from "@/lib/types";
import { exportScoreResult, prepareScoreResult } from "@/lib/score-export-client";

export function ScoreExportButton({ score }: { score: Best50Score | SongScore }) {
  const active = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exportScore() {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError(null);
    try {
      await exportScoreResult(score);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导出失败，请重试。");
    } finally {
      active.current = false;
      setBusy(false);
    }
  }

  return <>
    <button type="button" className="score-export-button" disabled={busy} aria-busy={busy} onPointerEnter={prepareScoreResult} onFocus={prepareScoreResult} onPointerDown={prepareScoreResult} onClick={exportScore} title="导出成绩结算图（PNG）">
      {busy ? <Loader2 size={12} className="spin" aria-hidden="true" /> : <Download size={12} aria-hidden="true" />}
      {busy ? "生成中…" : "导出"}
    </button>
    {error ? <p className="score-export-error" role="alert">{error}</p> : null}
  </>;
}

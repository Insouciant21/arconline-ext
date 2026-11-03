import { useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import type { Best50Score, SongScore } from "@/lib/types";

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
      const { downloadScoreResult } = await import("@/lib/score-result-renderer");
      await downloadScoreResult(score);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导出失败，请重试。");
    } finally {
      active.current = false;
      setBusy(false);
    }
  }

  return <>
    <button type="button" className="score-export-button" disabled={busy} aria-busy={busy} onClick={exportScore} title="导出成绩结算图（PNG）">
      {busy ? <Loader2 size={12} className="spin" aria-hidden="true" /> : <Download size={12} aria-hidden="true" />}
      {busy ? "生成中…" : "导出"}
    </button>
    {error ? <p className="score-export-error" role="alert">{error}</p> : null}
  </>;
}

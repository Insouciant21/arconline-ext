"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CHART_CONSTANTS_VERSION } from "@/lib/chart-constants";
import type { GameVersionStatus } from "@/lib/types";
import { formatRelativeDate } from "@/lib/utils";

const CLIENT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function defaultVersionStatus(initial?: GameVersionStatus): GameVersionStatus {
  return initial ?? {
    constantsVersion: CHART_CONSTANTS_VERSION,
    latestVersion: null,
    upToDate: null,
    checkedAt: null,
    source: "lowiro-apk",
  };
}

function isStale(checkedAt: string | null) {
  if (!checkedAt) return true;
  const timestamp = Date.parse(checkedAt);
  return !Number.isFinite(timestamp) || Date.now() - timestamp >= CLIENT_CACHE_TTL_MS;
}

export function VersionCheck({ initialVersion, interactive }: { initialVersion?: GameVersionStatus; interactive: boolean }) {
  const [version, setVersion] = React.useState<GameVersionStatus>(() => defaultVersionStatus(initialVersion));
  const [checking, setChecking] = React.useState(false);

  React.useEffect(() => {
    if (!initialVersion?.checkedAt) return;
    setVersion(current => {
      if (!current.checkedAt || initialVersion.checkedAt! > current.checkedAt) return initialVersion;
      return current;
    });
  }, [initialVersion]);

  React.useEffect(() => {
    if (!isStale(initialVersion?.checkedAt ?? null)) return;
    const controller = new AbortController();
    async function checkInitial() {
      setChecking(true);
      try {
        const response = await fetch("/api/version", { cache: "no-store", signal: controller.signal });
        if (response.status === 401) { window.location.assign("/login"); return; }
        const payload = await response.json() as Partial<GameVersionStatus> & { error?: string };
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setVersion(current => ({ ...current, error: payload.error || "版本检测失败" }));
          return;
        }
        setVersion(defaultVersionStatus(payload as GameVersionStatus));
      } catch {
        if (!controller.signal.aborted) {
          setVersion(current => ({ ...current, error: current.error || "暂时无法检测版本" }));
        }
      } finally {
        if (!controller.signal.aborted) setChecking(false);
      }
    }
    void checkInitial();
    return () => controller.abort();
  }, []);

  async function refreshVersion() {
    if (!interactive || checking) return;
    setChecking(true);
    try {
      const response = await fetch("/api/version?refresh=1", { cache: "no-store" });
      if (response.status === 401) { window.location.assign("/login"); return; }
      const payload = await response.json() as Partial<GameVersionStatus> & { error?: string };
      if (!response.ok) {
        setVersion(current => ({ ...current, error: payload.error || "版本检测失败，请稍后重试。" }));
        return;
      }
      setVersion(defaultVersionStatus(payload as GameVersionStatus));
    } catch {
      setVersion(current => ({ ...current, error: "暂时无法连接官网检测版本。" }));
    } finally {
      setChecking(false);
    }
  }

  const tone = checking
    ? "checking"
    : version.upToDate === false
      ? "outdated"
      : version.upToDate === true
        ? "latest"
        : version.error
          ? "error"
          : "idle";

  const summary = checking
    ? "正在检测版本…"
    : version.latestVersion
      ? version.upToDate === false
        ? `官网已更新 ${version.latestVersion}`
        : version.upToDate === true
          ? `官网最新 ${version.latestVersion}`
          : `官网 ${version.latestVersion}`
      : version.error || "待检测官网版本";

  const titleParts = [
    `定数表 v${version.constantsVersion}`,
    version.latestVersion ? `官网版本 ${version.latestVersion}` : null,
    version.checkedAt ? `上次检测 ${formatRelativeDate(version.checkedAt)}` : null,
    version.error || null,
  ].filter(Boolean);

  return (
    <div className="version-check" title={titleParts.join(" · ")}>
      <span className={`version-pill version-${tone}`} role="status" aria-live="polite">
        <strong>定数表 v{version.constantsVersion}</strong>
        <span className="version-sep">·</span>
        <span>{summary}</span>
      </span>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="version-check-button"
        onClick={refreshVersion}
        disabled={!interactive || checking}
        aria-busy={checking}
      >
        <RefreshCw size={12} className={checking ? "spin" : undefined} />
        {checking ? "检测中…" : "检测版本"}
      </Button>
    </div>
  );
}

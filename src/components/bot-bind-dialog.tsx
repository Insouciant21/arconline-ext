"use client";

import * as React from "react";
import { Bot, Check, Copy, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

interface BindCodeResponse {
  code: string;
  expiresAt: string;
  userCode: string | null;
}

export function BotBindDialog({ interactive }: { interactive: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [issued, setIssued] = React.useState<BindCodeResponse | null>(null);
  const [copied, setCopied] = React.useState(false);

  const issueCode = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const response = await fetch("/api/bot-bind-codes", { method: "POST" });
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      const payload = await response.json() as Partial<BindCodeResponse> & { error?: string };
      if (!response.ok || !payload.code || !payload.expiresAt) {
        throw new Error(payload.error || "生成绑定码失败");
      }
      setIssued({
        code: payload.code,
        expiresAt: payload.expiresAt,
        userCode: payload.userCode ?? null,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成绑定码失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleOpen = () => {
    setOpen(true);
    void issueCode();
  };

  const bindCommand = issued?.userCode ? `/bind ${issued.userCode}:${issued.code}` : "";

  const copyCommand = async () => {
    if (!bindCommand) return;
    try {
      await navigator.clipboard.writeText(bindCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("剪贴板写入失败，请手动复制指令。");
    }
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="bot-bind-trigger"
        onClick={handleOpen}
        disabled={!interactive}
      >
        <Bot size={14} />
        绑定 QQ
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>绑定 QQ Bot</DialogTitle>
          <DialogDescription>
            生成一次性绑定码（10 分钟内有效），私聊 QQ Bot 发送下方指令即可完成绑定。
          </DialogDescription>

          {loading ? (
            <div className="dialog-result">
              <Loader2 className="spin" size={16} />
              <span>正在生成绑定码…</span>
            </div>
          ) : error ? (
            <div className="dialog-result error">
              <RefreshCw size={16} />
              <span>{error}</span>
            </div>
          ) : issued ? (
            issued.userCode ? (
              <div className="bot-bind-panel">
                <div className="bot-bind-command-box">
                  <code>{bindCommand}</code>
                  <Button type="button" size="sm" variant="secondary" onClick={copyCommand}>
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? "已复制" : "复制"}
                  </Button>
                </div>

                <div className="bot-bind-meta">
                  <span>有效期至 {new Date(issued.expiresAt).toLocaleTimeString("zh-CN", { hour12: false })}</span>
                  <Button type="button" size="sm" variant="secondary" onClick={() => void issueCode()}>
                    <RefreshCw size={13} />
                    重新生成
                  </Button>
                </div>
              </div>
            ) : (
              <div className="dialog-result error">
                <RefreshCw size={16} />
                <span>尚未同步到 Arcaea 好友码，请先点击「获取 B50 & 潜力图」同步一次后再绑定。</span>
              </div>
            )
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

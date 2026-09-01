"use client";

import * as React from "react";
import { KeyRound, Loader2, Sparkles } from "lucide-react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function LoginForm({
  callbackUrl,
  initialError,
}: {
  callbackUrl: string;
  initialError?: string;
}) {
  const [token, setToken] = React.useState("");
  const [error, setError] = React.useState(initialError || "");
  const [pending, setPending] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!token.trim()) {
      setError("请输入访问口令。");
      return;
    }

    setPending(true);
    try {
      const result = await signIn("credentials", {
        token: token.trim(),
        redirect: false,
        redirectTo: callbackUrl,
      });
      if (result?.error) {
        setError("访问口令无效，请重试。");
        return;
      }
      // Auth.js may return an absolute URL based on the container's bind
      // address. The callback is already validated as an internal path, so
      // resolve it against the origin the user is currently visiting.
      window.location.assign(new URL(callbackUrl, window.location.origin).toString());
    } catch {
      setError("登录服务暂时不可用，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-grid" aria-hidden="true" />
      <header className="auth-topbar">
        <a className="brand" href="/login" aria-label="Arcaea B50 Studio">
          <span className="brand-lockup">
            <strong className="brand-wordmark">ARCAEA</strong>
            <small>B50 STUDIO</small>
          </span>
        </a>
        <span className="auth-locale">ZH / EN</span>
      </header>

      <section className="auth-content" aria-labelledby="login-title">
        <div className="hexagon-title auth-title"><span>ARCAEA ONLINE / PRIVATE ACCESS</span></div>
        <section className="auth-panel">
          <div className="auth-panel-heading">
            <span className="auth-eyebrow"><Sparkles size={14} /> ACCOUNT GATE</span>
            <span className="auth-index">01 / 01</span>
          </div>
          <h1 id="login-title">进入你的音律轨迹。</h1>
          <p className="auth-description">输入访问口令，查看 B50、潜力值历史与同步控制台。</p>
          <form className="login-form" onSubmit={handleSubmit}>
            <label className="login-field">
              <span><KeyRound size={14} /> ADMIN ACCESS TOKEN</span>
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="输入访问口令"
                autoComplete="current-password"
                autoFocus
              />
            </label>
            {error ? <p className="login-error" role="alert">{error}</p> : null}
            <Button type="submit" className="login-submit" disabled={pending}>
              {pending ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />}
              {pending ? "验证中…" : "验证并进入"}
            </Button>
          </form>
          <div className="auth-panel-foot"><span>SESSION GATE · AUTH.JS</span><span>LOWIRO DATA ARCHIVE</span></div>
        </section>
        <p className="auth-hint">仅限已配置访问口令的管理会话 · 数据请求受登录状态保护</p>
      </section>
    </main>
  );
}

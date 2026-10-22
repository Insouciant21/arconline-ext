import { ClipboardList, History, LayoutDashboard, Search } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { SignOutButton } from "@/components/sign-out-button";

type Page = "overview" | "scores" | "history" | "logs";

const links = [
  { page: "overview", href: "/", label: "概览", Icon: LayoutDashboard },
  { page: "scores", href: "/scores", label: "单曲查询", Icon: Search },
  { page: "history", href: "/history", label: "历史", Icon: History },
  { page: "logs", href: "/logs", label: "日志", Icon: ClipboardList },
] as const;

export function AppNavigation({ current }: { current: Page }) {
  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label="ArcOnline Extension">
        <BrandMark />
        <span className="brand-lockup">
          <strong className="brand-wordmark">ArcOnline</strong>
          <small>EXTENSION</small>
        </span>
      </a>
      <nav className="topbar-actions" aria-label="主导航">
        {links.map(({ page, href, label, Icon }) => (
          <a key={page} className="history-nav-link" href={href} aria-current={current === page ? "page" : undefined}>
            <Icon size={15} />
            {label}
          </a>
        ))}
        <SignOutButton />
      </nav>
    </header>
  );
}

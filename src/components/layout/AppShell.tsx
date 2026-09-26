import { Boxes, LogOut, Plus, Settings2, Wrench } from "lucide-react";
import type { PropsWithChildren } from "react";
import type { User } from "../../types";
import { Button } from "../ui";

export type StudioView = "kits" | "editor" | "catalogs";

type AppShellProps = PropsWithChildren<{
  user: User;
  activeView: StudioView;
  canWrite: boolean;
  notice?: string;
  onNavigate: (view: StudioView) => void;
  onCreate: () => void;
  onLogout: () => void;
}>;

export function AppShell({ user, activeView, canWrite, notice, onNavigate, onCreate, onLogout, children }: AppShellProps) {
  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-mark"><Wrench size={18}/></div>
      <div className="brand-copy"><strong>DSDST</strong><span>Kit Studio</span></div>
      <nav>
        <Button variant="ghost" className={activeView === "kits" ? "nav-active" : ""} onClick={() => onNavigate("kits")}><Boxes size={16}/>Kitler</Button>
        {canWrite && <Button variant="ghost" onClick={onCreate}><Plus size={16}/>Yeni Kit</Button>}
        <Button variant="ghost" className={activeView === "catalogs" ? "nav-active" : ""} onClick={() => onNavigate("catalogs")}><Settings2 size={16}/>Katalog</Button>
      </nav>
      <div className="user-chip"><strong>{user.username}</strong><span>{user.role}</span></div>
      <Button variant="ghost" className="icon-button" aria-label="Çıkış yap" onClick={onLogout}><LogOut size={18}/></Button>
    </header>
    {notice && <div className="global-notice">{notice}</div>}
    {children}
  </div>;
}

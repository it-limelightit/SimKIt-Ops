import { useState, useEffect } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import { LayoutDashboard, MapPin, Users, BarChart3, LogOut, Activity, Menu, X, Folder, PanelLeftClose, PanelLeftOpen, Boxes, Sun, Moon } from "lucide-react";
import { Button } from "../ui-kit";

export function StaffShell({
  children,
  role,
}: {
  children: React.ReactNode;
  role: "supervisor";
}) {
  const { signOut, profile } = useAuth();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [isOpen, setIsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const base = `/${role}`;
  const displayRole = "manager";

  const [themeMode, setThemeMode] = useState<"light" | "dark">("light");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("themeMode");
      const initial = (stored === "dark" || stored === "light") ? stored : "light";
      setThemeMode(initial);
      const root = document.documentElement;
      if (initial === "light") {
        root.classList.add("light-theme");
      } else {
        root.classList.remove("light-theme");
      }
    }
  }, []);

  const toggleTheme = () => {
    const next = themeMode === "light" ? "dark" : "light";
    setThemeMode(next);
    const root = document.documentElement;
    if (next === "light") {
      root.classList.add("light-theme");
    } else {
      root.classList.remove("light-theme");
    }
    localStorage.setItem("themeMode", next);
  };

  const items = [
    { to: `${base}`, label: "Overview", icon: LayoutDashboard },
    { to: `${base}/sites`, label: "Sites", icon: MapPin },
    { to: `${base}/business-consultants`, label: "Business Consultants", icon: Users },
    { to: `${base}/performance`, label: "Performance", icon: Activity },
    { to: `${base}/drive-links`, label: "Links of Drive", icon: Folder },
    { to: `${base}/logistic`, label: "Logistic", icon: Boxes },
    { to: `${base}/reports`, label: "Reports", icon: BarChart3 },
  ];

  return (
    <div className="flex min-h-screen flex-col md:flex-row bg-background text-text-primary">
      {/* Mobile Header */}
      <header className="flex h-16 items-center justify-between border-b border-border bg-surface px-6 md:hidden">
        <Link to={base as "/manager"} className="flex items-center gap-2 font-syne font-bold uppercase tracking-wider text-lime">
          <span className="flex h-5 w-5 items-center justify-center rounded-[4px] bg-lime text-bg text-[10px] font-extrabold font-mono">⬡</span>
          <span>SIM-KIT OPS</span>
        </Link>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleTheme}
            className="p-2 text-text-secondary hover:text-lime transition-colors"
            title={themeMode === "light" ? "Switch to Dark Mode" : "Switch to Light Mode"}
          >
            {themeMode === "light" ? <Moon size={18} strokeWidth={2} /> : <Sun size={18} strokeWidth={2} />}
          </button>
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="p-2 text-text-secondary hover:text-text-primary"
            aria-label="Toggle menu"
          >
            {isOpen ? <X size={20} strokeWidth={2} /> : <Menu size={20} strokeWidth={2} />}
          </button>
        </div>
      </header>

      {/* Mobile Drawer (Menu Overlay) */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background text-text-primary animate-in slide-in-from-top duration-200 md:hidden">
          <div className="flex h-16 items-center justify-between border-b border-border px-6 bg-surface">
            <Link to={base as "/manager"} className="flex items-center gap-2 font-syne font-bold uppercase tracking-wider text-lime" onClick={() => setIsOpen(false)}>
              <span className="flex h-5 w-5 items-center justify-center rounded-[4px] bg-lime text-bg text-[10px] font-extrabold font-mono">⬡</span>
              <span>SIM-KIT OPS</span>
            </Link>
            <button
              onClick={() => setIsOpen(false)}
              className="p-2 text-text-secondary hover:text-text-primary"
            >
              <X size={20} strokeWidth={2} />
            </button>
          </div>
          <nav className="flex-1 px-4 py-6 space-y-1">
            {items.map((it) => {
              const active = path === it.to || (it.to !== base && path.startsWith(it.to));
              return (
                <Link
                  key={it.to}
                  to={it.to}
                  onClick={() => setIsOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 text-sm font-semibold rounded-[6px] transition-all duration-150 ${
                    active ? "bg-lime/10 text-lime border-l-3 border-lime" : "text-text-secondary hover:bg-surface hover:text-text-primary"
                  }`}
                >
                  <it.icon size={18} strokeWidth={2} />
                  {it.label}
                </Link>
              );
            })}
          </nav>
          <div className="border-t border-border px-6 py-6 bg-surface">
            <div className="font-mono text-[9px] text-lime mb-1 uppercase tracking-widest font-bold">{displayRole}</div>
            <div className="text-sm font-semibold mb-3 text-text-primary">{profile?.name ?? "—"}</div>
            <Button
              onClick={() => {
                setIsOpen(false);
                signOut();
              }}
              variant="danger"
              className="w-full text-xs"
            >
              <LogOut size={14} strokeWidth={1.5} /> Sign out
            </Button>
          </div>
        </div>
      )}

      {/* Desktop Sidebar */}
      <aside className={`hidden shrink-0 flex-col bg-surface border-r border-border md:flex md:h-screen md:sticky md:top-0 transition-all duration-200 ${collapsed ? "w-16" : "w-60"}`}>
        <div className={`flex items-center border-b border-border py-5 ${collapsed ? "justify-center px-0" : "justify-between px-5"}`}>
          {!collapsed && (
            <Link to={base as "/manager"} className="flex items-center gap-2 font-syne font-bold uppercase tracking-wider text-lime">
              <span className="flex h-5 w-5 items-center justify-center rounded-[4px] bg-lime text-bg text-[10px] font-extrabold font-mono shrink-0">⬡</span>
              <div>
                <div>SIM-KIT OPS</div>
                <div className="font-mono text-[9px] uppercase tracking-widest text-text-secondary font-bold">{displayRole}</div>
              </div>
            </Link>
          )}
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="text-text-secondary hover:text-lime transition-colors p-1 rounded-[4px] shrink-0"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen size={18} strokeWidth={1.8} /> : <PanelLeftClose size={18} strokeWidth={1.8} />}
          </button>
        </div>
        <nav className={`flex-1 py-6 space-y-1 ${collapsed ? "px-2" : "px-3"}`}>
          {items.map((it) => {
            const active = path === it.to || (it.to !== base && path.startsWith(it.to));
            return (
              <Link
                key={it.to}
                to={it.to}
                title={collapsed ? it.label : undefined}
                className={`flex items-center gap-3 py-2.5 text-sm font-semibold transition-all duration-150 rounded-[6px] ${collapsed ? "justify-center px-0" : "px-4"} ${
                  active ? "bg-lime/10 text-lime border-l-3 border-lime" : "text-text-secondary hover:bg-surface-raised hover:text-text-primary"
                }`}
              >
                <it.icon size={16} strokeWidth={2} />
                {!collapsed && it.label}
              </Link>
            );
          })}
        </nav>
        <div className={`border-t border-border py-4 bg-surface-raised/30 flex items-center ${collapsed ? "justify-center px-2 flex-col gap-2" : "justify-between px-4"}`}>
          {!collapsed && (
            <div className="flex flex-col min-w-0">
              <div className="font-mono text-[8px] uppercase tracking-wider text-text-secondary font-bold truncate">User</div>
              <div className="text-xs font-semibold text-text-primary truncate">{profile?.name ?? "—"}</div>
            </div>
          )}
          <div className="flex items-center gap-1">
            <button
              onClick={toggleTheme}
              className="text-text-secondary hover:text-lime transition-colors p-1.5 cursor-pointer"
              title={themeMode === "light" ? "Switch to Dark Mode" : "Switch to Light Mode"}
            >
              {themeMode === "light" ? <Moon size={16} strokeWidth={2} /> : <Sun size={16} strokeWidth={2} />}
            </button>
            <button
              onClick={signOut}
              className="text-text-secondary hover:text-coral transition-colors p-1.5 cursor-pointer"
              title="Sign out"
            >
              <LogOut size={16} strokeWidth={2} />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden min-w-0">
        <div className="mx-auto max-w-6xl px-6 py-10 md:px-10 md:py-12">{children}</div>
      </main>
    </div>
  );
}

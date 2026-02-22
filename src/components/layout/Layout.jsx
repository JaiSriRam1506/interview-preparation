/* eslint-disable react-refresh/only-export-components */

import React, { createContext, useMemo, useState } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import {
  Menu,
  X,
  Home,
  Video,
  Monitor,
  FileText,
  CreditCard,
  Settings,
  Shield,
  Sun,
  Moon,
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { useTheme } from "../../contexts/ThemeContext";
import ScreenSharePublisher from "../screenShare/ScreenSharePublisher";
import ScreenShareViewer from "../screenShare/ScreenShareViewer";

export const MobileTopBarContext = createContext({
  setMobileTopBar: () => {},
});

const NavItem = ({ to, icon, label, onClick }) => {
  const location = useLocation();
  const active =
    location.pathname === to || location.pathname.startsWith(`${to}/`);
  return (
    <Link
      to={to}
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
        active
          ? "bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-200"
          : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
      }`}
    >
      {icon}
      {label}
    </Link>
  );
};

export default function Layout() {
  const [open, setOpen] = useState(false);
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [mobileTopBar, setMobileTopBar] = useState(null);
  const location = useLocation();
  const showScreenShareUi =
    location.pathname === "/screen-share" ||
    location.pathname.startsWith("/screen-share/");

  const mobileTopBarValue = useMemo(
    () => ({
      setMobileTopBar,
    }),
    []
  );

  return (
    <MobileTopBarContext.Provider value={mobileTopBarValue}>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        {/* Mobile top bar */}
        <div className="lg:hidden sticky top-0 z-40 bg-white/90 dark:bg-gray-900/90 backdrop-blur border-b border-gray-200 dark:border-gray-800">
          <div
            className={`px-4 flex justify-between gap-3 ${
              mobileTopBar ? "min-h-14 py-2" : "h-14"
            }`}
          >
            <button
              onClick={() => setOpen(true)}
              className="p-0.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="flex-1 min-w-0 overflow-hidden pt-1">
              {mobileTopBar?.center || (
                <div className="w-6" aria-hidden="true" />
              )}
            </div>

            <div className="flex items-start gap-2 flex-shrink-0 pt-1">
              {mobileTopBar?.right || null}
              <button
                onClick={toggle}
                className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200"
                aria-label={
                  theme === "dark"
                    ? "Switch to light mode"
                    : "Switch to dark mode"
                }
              >
                {theme === "dark" ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div
          className={`fixed inset-0 z-50 lg:hidden ${open ? "" : "pointer-events-none"}`}
        >
          <div
            onClick={() => setOpen(false)}
            className={`absolute inset-0 bg-black/40 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
          />
          <aside
            className={`absolute left-0 top-0 h-full w-80 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 p-4 transition-transform ${
              open ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="w-6" aria-hidden="true" />
              <button
                onClick={() => setOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarContent
              user={user}
              logout={logout}
              onNav={() => setOpen(false)}
            />
          </aside>
        </div>

        <div className="hidden lg:flex">
          <aside className="w-72 min-h-screen sticky top-0 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 p-4">
            <div className="h-6 mb-6" aria-hidden="true" />
            <SidebarContent user={user} logout={logout} />
          </aside>

          <main className="flex-1 min-w-0">
            <Outlet />
            <ScreenSharePublisher showUi={showScreenShareUi} />
            <ScreenShareViewer showUi={showScreenShareUi} />
          </main>
        </div>

        <div className="lg:hidden">
          <main className="min-w-0">
            <Outlet />
            <ScreenSharePublisher showUi={showScreenShareUi} />
            <ScreenShareViewer showUi={showScreenShareUi} />
          </main>
        </div>
      </div>
    </MobileTopBarContext.Provider>
  );
}

function SidebarContent({ user, logout, onNav }) {
  return (
    <div className="flex flex-col h-[calc(100vh-6rem)]">
      <nav className="space-y-1">
        <NavItem
          to="/dashboard"
          icon={<Home className="h-4 w-4" />}
          label="Home"
          onClick={onNav}
        />
        <NavItem
          to="/sessions"
          icon={<Video className="h-4 w-4" />}
          label="Call Sessions"
          onClick={onNav}
        />
        <NavItem
          to="/screen-share"
          icon={<Monitor className="h-4 w-4" />}
          label="Screen Share"
          onClick={onNav}
        />
        <NavItem
          to="/profile"
          icon={<FileText className="h-4 w-4" />}
          label="CVs / Resumes"
          onClick={onNav}
        />
        <NavItem
          to="/settings"
          icon={<Settings className="h-4 w-4" />}
          label="Settings"
          onClick={onNav}
        />
        {user?.role === "admin" && (
          <NavItem
            to="/admin"
            icon={<Shield className="h-4 w-4" />}
            label="Admin"
            onClick={onNav}
          />
        )}
      </nav>

      <div className="mt-auto pt-4 border-t border-gray-200 dark:border-gray-800">
        <div className="text-sm text-gray-700 dark:text-gray-200 font-medium truncate">
          {user?.email}
        </div>
        <button
          onClick={logout}
          className="mt-3 w-full px-3 py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-semibold"
        >
          Logout
        </button>
      </div>
    </div>
  );
}

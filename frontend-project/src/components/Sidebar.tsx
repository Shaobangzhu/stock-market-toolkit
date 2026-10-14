import type { ReactNode } from "react";
import { Button, Tooltip } from "antd";
import {
  AppstoreOutlined,
  BarChartOutlined,
  LeftOutlined,
  RightOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { NavLink } from "react-router-dom";

export const MAIN_NAV_ITEMS = [
  "Watchlist",
  "Stock Research",
  "Data & Settings",
] as const;

interface NavigationItem {
  label: (typeof MAIN_NAV_ITEMS)[number];
  path?: string;
  icon: ReactNode;
}

export function Sidebar({
  collapsed,
  onToggle,
  currentSymbol,
}: {
  collapsed: boolean;
  onToggle: () => void;
  currentSymbol?: string;
}) {
  const items: NavigationItem[] = [
    { label: "Watchlist", path: "/", icon: <AppstoreOutlined /> },
    {
      label: "Stock Research",
      path: currentSymbol
        ? `/stocks/${encodeURIComponent(currentSymbol)}`
        : undefined,
      icon: <BarChartOutlined />,
    },
    { label: "Data & Settings", path: "/settings", icon: <SettingOutlined /> },
  ];

  return (
    <aside className={`sidebar${collapsed ? " sidebar--collapsed" : ""}`}>
      <div className="sidebar__brand">
        <NavLink
          to="/"
          className="brand-link"
          aria-label="Stock Research Lab home"
        >
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          {!collapsed && (
            <span className="brand-copy">
              <strong>CHAORAN RESEARCH</strong>
              <small>LAB / LOCAL WORKSPACE</small>
            </span>
          )}
        </NavLink>
      </div>
      <div className="sidebar__section-label">
        {collapsed ? "···" : "WORKSPACE"}
      </div>
      <nav aria-label="Main navigation" className="sidebar__nav">
        {items.map(({ label, path, icon }) => {
          const content = (
            <>
              {icon}
              <span className="sidebar__item-label">{label}</span>
            </>
          );
          return path ? (
            <Tooltip
              key={label}
              title={collapsed ? label : undefined}
              placement="right"
            >
              <NavLink
                to={path}
                end={label === "Watchlist"}
                className={({ isActive }) =>
                  `sidebar__item${isActive ? " sidebar__item--active" : ""}`
                }
              >
                {content}
              </NavLink>
            </Tooltip>
          ) : (
            <Tooltip key={label} title="Open a stock first" placement="right">
              <span
                className="sidebar__item sidebar__item--disabled"
                aria-disabled="true"
                title="Open a stock first"
              >
                {content}
              </span>
            </Tooltip>
          );
        })}
      </nav>
      <div className="sidebar__footer">
        <span className="sidebar__local-dot" aria-hidden="true" />
        {!collapsed && <span>LOCAL RESEARCH SPACE</span>}
        <Button
          type="text"
          className="sidebar__collapse"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={onToggle}
          icon={collapsed ? <RightOutlined /> : <LeftOutlined />}
        />
      </div>
    </aside>
  );
}

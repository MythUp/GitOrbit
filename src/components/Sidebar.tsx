// Purpose: Render left navigation with icon-driven actions, avatar profile badges, and cursor-positioned context menu.
import { MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";
import { SidebarFolder, SidebarProfileItem } from "../types/models";
import { ownerFromGithubUrl } from "../utils/github";

interface SidebarProps {
  profiles: SidebarProfileItem[];
  folders: SidebarFolder[];
  selectedId: string;
  onSelect: (id: string) => void;
  onHide: (id: string) => void;
  onRemove: (id: string) => void;
  onReorder: (sourceId: string, targetId: string) => void;
  onDropToFolder: (sourceId: string, targetId: string) => void;
  onToggleFolder: (folderId: string) => void;
  onShowSearch: () => void;
  onShowHome: () => void;
  onShowInstances: () => void;
  onShowAccount: () => void;
  githubConnected: boolean;
  currentView: "home" | "repositories" | "search" | "instances" | "account";
}

export default function Sidebar({
  profiles,
  folders,
  selectedId,
  onSelect,
  onHide,
  onRemove,
  onReorder,
  onDropToFolder,
  onToggleFolder,
  onShowSearch,
  onShowHome,
  onShowInstances,
  onShowAccount,
  githubConnected,
  currentView
}: SidebarProps) {
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    profileId: string;
  }>({
    open: false,
    x: 0,
    y: 0,
    profileId: ""
  });
  const [avatarFallbackMap, setAvatarFallbackMap] = useState<Record<string, boolean>>({});
  const [draggedProfileId, setDraggedProfileId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [mouseDragSourceId, setMouseDragSourceId] = useState<string | null>(null);
  const ignoreNextClickRef = useRef(false);

  const profileMap = useMemo(() => {
    const map = new Map<string, SidebarProfileItem>();
    profiles.forEach((item) => map.set(item.id, item));
    return map;
  }, [profiles]);

  useEffect(() => {
    function closeMenu(): void {
      setContextMenu((current) => ({ ...current, open: false }));
    }

    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, []);

  useEffect(() => {
    if (!contextMenu.open || !contextMenuRef.current) {
      return;
    }

    const menu = contextMenuRef.current;
    const menuWidth = menu.offsetWidth || 160;
    const menuHeight = menu.offsetHeight || 88;

    let left = contextMenu.x + 8;
    if (left + menuWidth > window.innerWidth - 8) {
      left = contextMenu.x - menuWidth - 8;
    }

    let top = contextMenu.y + 8;
    if (top + menuHeight > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - menuHeight - 8);
    }

    left = Math.max(8, left);
    top = Math.max(8, top);

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }, [contextMenu]);

  useEffect(() => {
    if (!mouseDragSourceId) {
      return;
    }

    function handleMouseMove(event: MouseEvent): void {
      const hovered = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const target = hovered?.closest("[data-profile-id]") as HTMLElement | null;
      const targetId = target?.getAttribute("data-profile-id");
      if (targetId) {
        setDropTargetId(targetId);
      }
    }

    function finalizeMouseDrag(event: MouseEvent): void {
      const sourceId = mouseDragSourceId;
      const targetId = dropTargetId;

      setMouseDragSourceId(null);
      setDraggedProfileId(null);
      setDropTargetId(null);

      if (!sourceId || !targetId || sourceId === targetId) {
        return;
      }

      ignoreNextClickRef.current = true;

      if (event.altKey) {
        onDropToFolder(sourceId, targetId);
      } else {
        onReorder(sourceId, targetId);
      }
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", finalizeMouseDrag);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", finalizeMouseDrag);
    };
  }, [dropTargetId, mouseDragSourceId, onDropToFolder, onReorder]);

  function handleContextMenu(event: ReactMouseEvent, id: string): void {
    event.preventDefault();
    setContextMenu({
      open: true,
      x: event.clientX,
      y: event.clientY,
      profileId: id
    });
  }

  function avatarUrl(profile: SidebarProfileItem): string {
    const owner = ownerFromGithubUrl(profile.url) || profile.name;
    return `https://github.com/${owner}.png?size=96`;
  }

  function renderProfileVisual(profile: SidebarProfileItem): JSX.Element {
    if (avatarFallbackMap[profile.id]) {
      return <Icon name="github" className="profile-icon" />;
    }

    return (
      <img
        src={avatarUrl(profile)}
        alt={profile.name}
        className="profile-avatar"
        draggable={false}
        onError={() => setAvatarFallbackMap((current) => ({ ...current, [profile.id]: true }))}
      />
    );
  }

  function onMouseDragStart(event: ReactMouseEvent, sourceId: string): void {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    setMouseDragSourceId(sourceId);
    setDraggedProfileId(sourceId);
    setDropTargetId(sourceId);
  }

  function handleProfileSelect(profileId: string): void {
    if (ignoreNextClickRef.current) {
      ignoreNextClickRef.current = false;
      return;
    }

    onSelect(profileId);
  }

  return (
    <aside className="sidebar">
      <button
        className={`sidebar-icon ${currentView === "home" ? "active" : ""}`}
        onClick={onShowHome}
        title="Home"
        type="button"
      >
        <Icon name="home" className="nav-icon" />
      </button>

      <button
        className={`sidebar-icon ${currentView === "instances" ? "active" : ""}`}
        onClick={onShowInstances}
        title="Create Instances"
        type="button"
      >
        <Icon name="plus" className="nav-icon" />
      </button>

      <button
        className={`sidebar-icon ${currentView === "search" ? "active" : ""}`}
        onClick={onShowSearch}
        title="Search"
        type="button"
      >
        <Icon name="compass" className="nav-icon" />
      </button>

      <div className="sidebar-divider" />

      {folders.map((folder) => (
        <div key={folder.id} className="folder-group">
          <button
            className="folder-toggle"
            onClick={() => onToggleFolder(folder.id)}
            type="button"
          >
            {folder.collapsed ? "+" : "-"} {folder.name}
          </button>
          {!folder.collapsed && (
            <div className="folder-items">
              {folder.itemIds
                .map((id) => profileMap.get(id))
                .filter(Boolean)
                .map((item) => (
                  <button
                    key={item!.id}
                    data-profile-id={item!.id}
                    className={`profile-badge ${
                      currentView === "repositories" && selectedId === item!.id ? "selected" : ""
                    } ${draggedProfileId === item!.id ? "dragging" : ""} ${
                      dropTargetId === item!.id ? "drop-target" : ""
                    }`}
                    onClick={() => handleProfileSelect(item!.id)}
                    onContextMenu={(event) => handleContextMenu(event, item!.id)}
                    draggable={false}
                    onMouseDown={(event) => onMouseDragStart(event, item!.id)}
                    type="button"
                    title={`${item!.name} (drag to reorder, hold Alt while dropping to create folder)`}
                  >
                    {renderProfileVisual(item!)}
                  </button>
                ))}
            </div>
          )}
        </div>
      ))}

      <div className="profile-list">
        {profiles
          .filter((profile) => !folders.some((folder) => folder.itemIds.includes(profile.id)))
          .map((profile) => (
            <button
              key={profile.id}
              data-profile-id={profile.id}
              className={`profile-badge ${
                currentView === "repositories" && selectedId === profile.id ? "selected" : ""
              } ${draggedProfileId === profile.id ? "dragging" : ""} ${
                dropTargetId === profile.id ? "drop-target" : ""
              }`}
              onClick={() => handleProfileSelect(profile.id)}
              onContextMenu={(event) => handleContextMenu(event, profile.id)}
              draggable={false}
              onMouseDown={(event) => onMouseDragStart(event, profile.id)}
              type="button"
              title={`${profile.name} (drag to reorder, hold Alt while dropping to create folder)`}
            >
              {renderProfileVisual(profile)}
            </button>
          ))}
      </div>

        <button
          className={`sidebar-icon sidebar-bottom-button ${currentView === "account" ? "active" : ""}`}
          onClick={onShowAccount}
          title="Account"
          type="button"
        >
          <Icon name="user" className="nav-icon" />
          <span className={`account-status-dot ${githubConnected ? "connected" : "disconnected"}`} />
        </button>

      {contextMenu.open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={contextMenuRef}
            className="sidebar-context-menu"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="context-item"
              onClick={() => {
                onHide(contextMenu.profileId);
                setContextMenu((current) => ({ ...current, open: false }));
              }}
            >
              Hide (keep profile)
            </button>
            <button
              type="button"
              className="context-item danger"
              onClick={() => {
                onRemove(contextMenu.profileId);
                setContextMenu((current) => ({ ...current, open: false }));
              }}
            >
              Delete (remove permanently)
            </button>
          </div>,
          document.body
        )}
    </aside>
  );
}
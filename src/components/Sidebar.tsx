// Purpose: Render left navigation with icon-driven actions and a real contextual menu for profile items.
import { MouseEvent, useEffect, useMemo, useState } from "react";
import Icon from "./Icon";
import { SidebarFolder, SidebarProfileItem } from "../types/models";

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
  currentView: "home" | "repositories" | "search" | "instances";
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
  currentView
}: SidebarProps) {
  const [contextMenu, setContextMenu] = useState<{
    open: boolean;
    profileId: string;
  }>({
    open: false,
    profileId: ""
  });

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

  function handleContextMenu(event: MouseEvent, id: string): void {
    event.preventDefault();
    setContextMenu({
      open: true,
      profileId: id
    });
  }

  function onDragStart(event: React.DragEvent, sourceId: string): void {
    event.dataTransfer.setData("text/plain", sourceId);
  }

  function onDrop(event: React.DragEvent, targetId: string): void {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData("text/plain");
    if (!sourceId || sourceId === targetId) {
      return;
    }

    if (event.shiftKey) {
      onReorder(sourceId, targetId);
    } else {
      onDropToFolder(sourceId, targetId);
    }
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
                    className={`profile-badge ${
                      currentView === "repositories" && selectedId === item!.id ? "selected" : ""
                    }`}
                    onClick={() => onSelect(item!.id)}
                    onContextMenu={(event) => handleContextMenu(event, item!.id)}
                    draggable
                    onDragStart={(event) => onDragStart(event, item!.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => onDrop(event, item!.id)}
                    type="button"
                    title={`${item!.name} (drop to folder, hold Shift to reorder)`}
                  >
                    <Icon name="github" className="profile-icon" />
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
              className={`profile-badge ${
                currentView === "repositories" && selectedId === profile.id ? "selected" : ""
              }`}
              onClick={() => onSelect(profile.id)}
              onContextMenu={(event) => handleContextMenu(event, profile.id)}
              draggable
              onDragStart={(event) => onDragStart(event, profile.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => onDrop(event, profile.id)}
              type="button"
              title={`${profile.name} (drop to folder, hold Shift to reorder)`}
            >
              <Icon name="github" className="profile-icon" />
            </button>
          ))}
      </div>

      {contextMenu.open && (
        <div
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
            Hide
          </button>
          <button
            type="button"
            className="context-item danger"
            onClick={() => {
              onRemove(contextMenu.profileId);
              setContextMenu((current) => ({ ...current, open: false }));
            }}
          >
            Remove
          </button>
        </div>
      )}
    </aside>
  );
}
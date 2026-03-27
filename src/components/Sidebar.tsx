// Purpose: Render left navigation with profiles, folders, drag-and-drop, and hide/remove actions.
import { MouseEvent, useMemo } from "react";
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
  currentView: "home" | "repositories" | "search";
}

function profileBadge(name: string): string {
  return name.slice(0, 2).toUpperCase();
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
  currentView
}: SidebarProps) {
  const profileMap = useMemo(() => {
    const map = new Map<string, SidebarProfileItem>();
    profiles.forEach((item) => map.set(item.id, item));
    return map;
  }, [profiles]);

  function handleContextMenu(event: MouseEvent, id: string): void {
    event.preventDefault();
    const action = window.prompt("Type 'hide' to hide or 'remove' to remove this profile.", "hide");
    if (action === "hide") {
      onHide(id);
    }
    if (action === "remove") {
      onRemove(id);
    }
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
        HM
      </button>

      <button
        className={`sidebar-icon ${currentView === "search" ? "active" : ""}`}
        onClick={onShowSearch}
        title="Search"
        type="button"
      >
        SR
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
                    className={`profile-badge ${selectedId === item!.id ? "selected" : ""}`}
                    onClick={() => onSelect(item!.id)}
                    onContextMenu={(event) => handleContextMenu(event, item!.id)}
                    draggable
                    onDragStart={(event) => onDragStart(event, item!.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => onDrop(event, item!.id)}
                    type="button"
                    title={`${item!.name} (drop to folder, hold Shift to reorder)`}
                  >
                    {profileBadge(item!.name)}
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
              className={`profile-badge ${selectedId === profile.id ? "selected" : ""}`}
              onClick={() => onSelect(profile.id)}
              onContextMenu={(event) => handleContextMenu(event, profile.id)}
              draggable
              onDragStart={(event) => onDragStart(event, profile.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => onDrop(event, profile.id)}
              type="button"
              title={`${profile.name} (drop to folder, hold Shift to reorder)`}
            >
              {profileBadge(profile.name)}
            </button>
          ))}
      </div>
    </aside>
  );
}
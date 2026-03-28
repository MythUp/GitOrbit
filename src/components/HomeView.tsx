// Purpose: Render the home screen with all instances and quick launcher summary information.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { InstanceDeploymentStatusResponse, InstanceRecord } from "../types/models";
import { useInstanceFtpVersions } from "../hooks/useInstanceFtpVersions";

interface HomeViewProps {
  instances: InstanceRecord[];
  statuses: Record<string, InstanceDeploymentStatusResponse>;
  loadingByInstance: Record<string, boolean>;
  deployProgressByInstance: Record<
    string,
    {
      running: boolean;
      value: number;
      task: string;
    }
  >;
  onOpenInstanceWizard: (instanceID: string) => void;
  onCreateInstance: () => void;
  onDeleteInstance: (instanceID: string) => Promise<void>;
  onDeployOrUpdate: (instanceID: string) => Promise<void>;
  onOpenSite: (url: string) => void;
}

export default function HomeView({
  instances,
  statuses,
  loadingByInstance,
  deployProgressByInstance,
  onOpenInstanceWizard,
  onCreateInstance,
  onDeleteInstance,
  onDeployOrUpdate,
  onOpenSite
}: HomeViewProps) {
  const ftpVersions = useInstanceFtpVersions(instances);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    instanceID: string;
  }>({
    open: false,
    x: 0,
    y: 0,
    instanceID: ""
  });

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
    const menuWidth = menu.offsetWidth || 180;
    const menuHeight = menu.offsetHeight || 96;

    let left = contextMenu.x + 8;
    if (left + menuWidth > window.innerWidth - 8) {
      left = contextMenu.x - menuWidth - 8;
    }

    let top = contextMenu.y + 8;
    if (top + menuHeight > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - menuHeight - 8);
    }

    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
  }, [contextMenu]);

  function renderAction(instance: InstanceRecord): JSX.Element {
    const status = statuses[instance.id];
    const loading = loadingByInstance[instance.id] === true;
    const progress = deployProgressByInstance[instance.id];

    if (progress?.running) {
      return (
        <div className="instance-progress-wrap">
          <progress className="instance-progress-track" value={progress.value} max={100} />
          <small className="instance-progress-task">{progress.task}</small>
        </div>
      );
    }

    if (loading || !status) {
      return (
        <button type="button" className="btn-secondary" disabled>
          Pending
        </button>
      );
    }

    if (!status.deployed) {
      return (
        <button type="button" className="btn-primary" onClick={() => void onDeployOrUpdate(instance.id)}>
          Deploy
        </button>
      );
    }

    if (status.update_available) {
      return (
        <button type="button" className="btn-primary" onClick={() => void onDeployOrUpdate(instance.id)}>
          Update
        </button>
      );
    }

    if (status.site_url && status.site_url.trim()) {
      return (
        <button type="button" className="btn-secondary" onClick={() => onOpenSite(status.site_url!)}>
          View
        </button>
      );
    }

    return (
      <button type="button" className="btn-secondary" disabled>
        View unavailable
      </button>
    );
  }

  return (
    <section className="panel">
      <div className="home-header">
        <div>
          <h2>Home</h2>
          <p>All instances are available here with one-click actions.</p>
        </div>
        <button type="button" className="btn-secondary" onClick={onCreateInstance}>
          New instance
        </button>
      </div>

      <div className="home-grid">
        {instances.length === 0 && <p>No instances yet. Click New instance to create one.</p>}
        {instances.map((instance) => (
          <article
            key={instance.id}
            className="home-card"
            onClick={() => onOpenInstanceWizard(instance.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              setContextMenu({
                open: true,
                x: event.clientX,
                y: event.clientY,
                instanceID: instance.id
              });
            }}
          >
            <h3>{instance.name}</h3>
            <p>
              {instance.owner}/{instance.repo}
            </p>
            <small>Installed FTP version: {ftpVersions[instance.id] || "-"}</small>
            <small>Updated: {new Date(instance.updated_at).toLocaleString()}</small>
            {statuses[instance.id]?.latest_git_tag && (
              <small>Latest Git tag: {statuses[instance.id].latest_git_tag}</small>
            )}
            {statuses[instance.id]?.error && <small className="error-text">{statuses[instance.id].error}</small>}
            <div
              className="home-card-footer"
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              {renderAction(instance)}
            </div>
          </article>
        ))}
      </div>

      {contextMenu.open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={contextMenuRef}
            className="instance-context-menu"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="context-item"
              onClick={() => {
                onOpenInstanceWizard(contextMenu.instanceID);
                setContextMenu((current) => ({ ...current, open: false }));
              }}
            >
              Instance options
            </button>
            <button
              type="button"
              className="context-item danger"
              onClick={() => {
                void onDeleteInstance(contextMenu.instanceID);
                setContextMenu((current) => ({ ...current, open: false }));
              }}
            >
              Delete
            </button>
          </div>,
          document.body
        )}
    </section>
  );
}
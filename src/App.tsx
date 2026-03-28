// Purpose: Compose launcher navigation and route install actions into the instance workflow.
import { useEffect, useMemo, useRef, useState } from "react";
import AuthPanel from "./components/AuthPanel";
import HomeView from "./components/HomeView";
import InstanceWizardModal from "./components/InstanceWizardModal";
import RepositoryList from "./components/RepositoryList";
import SearchPanel from "./components/SearchPanel";
import Sidebar from "./components/Sidebar";
import { useLauncherData } from "./hooks/useLauncherData";
import { useInstanceDeploymentStatus } from "./hooks/useInstanceDeploymentStatus";
import { apiClient } from "./services/apiClient";
import { ownerFromGithubUrl } from "./utils/github";

type ViewMode = "home" | "repositories" | "search";

export default function App() {
  const {
    loading,
    error,
    profiles,
    visibleProfiles,
    selectedProfileId,
    selectedOwner,
    githubConnected,
    repositories,
    repositoriesLoading,
    githubWarning,
    instances,
    addProfile,
    hideProfile,
    removeProfile,
    reorderProfile,
    dropProfileIntoFolder,
    toggleFolder,
    selectProfile,
    searchGithub,
    saveInstance,
    loadInstanceInput,
    updateInstance,
    deleteInstance,
    refreshInstances,
    refreshGithubAuthStatus,
    refreshRepositories
  } = useLauncherData();

  const [view, setView] = useState<ViewMode>("home");
  const [accountPopup, setAccountPopup] = useState<{ open: boolean; x: number; y: number }>({
    open: false,
    x: 0,
    y: 0
  });
  const [installDraft, setInstallDraft] = useState<{ owner: string; repo: string } | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardMode, setWizardMode] = useState<"create" | "edit">("create");
  const [editingInstanceID, setEditingInstanceID] = useState<string | null>(null);
  const accountPopupRef = useRef<HTMLDivElement | null>(null);
  const [deployProgressByInstance, setDeployProgressByInstance] = useState<
    Record<string, { running: boolean; value: number; task: string }>
  >({});

  const {
    statuses,
    loading: deploymentStatusLoading,
    refreshInstanceStatus,
    refreshAllStatuses
  } = useInstanceDeploymentStatus(instances);
  const folders = useMemo(() => profiles.folders || [], [profiles.folders]);
  const existingSidebarOwners = useMemo(
    () =>
      new Set(
        (profiles.items || [])
          .map((item) => ownerFromGithubUrl(item.url).toLowerCase())
          .filter(Boolean)
      ),
    [profiles.items]
  );

  useEffect(() => {
    function blockNativeContextMenu(event: MouseEvent): void {
      event.preventDefault();
    }

    function blockDevtoolsShortcuts(event: KeyboardEvent): void {
      const key = event.key.toUpperCase();
      const isF12 = key === "F12";
      const isDevtoolsCombo = (event.ctrlKey || event.metaKey) && event.shiftKey && ["I", "J", "C"].includes(key);

      if (!isF12 && !isDevtoolsCombo) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    }

    window.addEventListener("contextmenu", blockNativeContextMenu);
    window.addEventListener("keydown", blockDevtoolsShortcuts, true);

    return () => {
      window.removeEventListener("contextmenu", blockNativeContextMenu);
      window.removeEventListener("keydown", blockDevtoolsShortcuts, true);
    };
  }, []);

  useEffect(() => {
    if (!accountPopup.open) {
      return;
    }

    function closePopupIfOutside(event: MouseEvent): void {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }

      if (target.closest(".account-popup") || target.closest(".sidebar-bottom-button")) {
        return;
      }

      setAccountPopup((current) => ({
        ...current,
        open: false
      }));
    }

    function closePopupOnEscape(event: KeyboardEvent): void {
      if (event.key !== "Escape") {
        return;
      }

      setAccountPopup((current) => ({
        ...current,
        open: false
      }));
    }

    window.addEventListener("mousedown", closePopupIfOutside);
    window.addEventListener("keydown", closePopupOnEscape);
    return () => {
      window.removeEventListener("mousedown", closePopupIfOutside);
      window.removeEventListener("keydown", closePopupOnEscape);
    };
  }, [accountPopup.open]);

  useEffect(() => {
    if (!accountPopup.open || !accountPopupRef.current) {
      return;
    }

    const popup = accountPopupRef.current;
    const width = popup.offsetWidth || 340;
    const height = popup.offsetHeight || 340;
    const maxLeft = Math.max(12, window.innerWidth - width - 12);
    const maxTop = Math.max(12, window.innerHeight - height - 12);
    const nextX = Math.min(Math.max(12, accountPopup.x), maxLeft);
    const nextY = Math.min(Math.max(12, accountPopup.y), maxTop);

    popup.style.left = `${nextX}px`;
    popup.style.top = `${nextY}px`;
  }, [accountPopup.open, accountPopup.x, accountPopup.y]);

  function startInstall(owner: string, repo: string): void {
    setInstallDraft({ owner, repo });
    setWizardMode("create");
    setEditingInstanceID(null);
    setView("home");
    setWizardOpen(true);
  }

  function startCreateFromHome(): void {
    setInstallDraft(null);
    setWizardMode("create");
    setEditingInstanceID(null);
    setView("home");
    setWizardOpen(true);
  }

  function openInstanceWizard(instanceID: string): void {
    setWizardMode("edit");
    setEditingInstanceID(instanceID);
    setView("home");
    setWizardOpen(true);
  }

  async function openSite(url: string): Promise<void> {
    const normalized = url.trim();
    if (!normalized) {
      return;
    }

    try {
      if (window.__TAURI_IPC__) {
        const shell = await import("@tauri-apps/api/shell");
        await shell.open(normalized);
        return;
      }
    } catch {
      // Fallback to browser open below.
    }

    window.open(normalized, "_blank", "noopener,noreferrer");
  }

  async function deployOrUpdate(instanceID: string): Promise<void> {
    const status = statuses[instanceID];
    if (!status) {
      return;
    }

    const updateProgress = (value: number, task: string, running: boolean): void => {
      setDeployProgressByInstance((current) => ({
        ...current,
        [instanceID]: {
          running,
          value,
          task
        }
      }));
    };

    updateProgress(5, "Preparing deployment...", true);

    const progressTimer = window.setInterval(() => {
      setDeployProgressByInstance((current) => {
        const previous = current[instanceID] || { running: true, value: 5, task: "Preparing deployment..." };
        if (previous.value >= 84) {
          return current;
        }

        const nextValue = previous.value + 2;
        let nextTask = "Preparing deployment...";
        if (nextValue >= 20 && nextValue < 45) {
          nextTask = "Downloading Git source...";
        } else if (nextValue >= 45 && nextValue < 75) {
          nextTask = "Uploading files...";
        } else if (nextValue >= 75) {
          nextTask = "Finalizing remote sync...";
        }

        return {
          ...current,
          [instanceID]: {
            running: true,
            value: nextValue,
            task: nextTask
          }
        };
      });
    }, 1300);

    try {
      const response = await apiClient.deployFtpByInstance({
        instance_id: instanceID,
        git_ref: status.latest_git_tag || "",
        rollback_on_fail: true
      });

      const uploadedCount = response.logs.filter((line) => line.toLowerCase().startsWith("uploaded ")).length;
      const lastFileLog = [...response.logs].reverse().find((line) => line.toLowerCase().startsWith("uploaded "));
      const completionTask = uploadedCount > 0 ? `Uploaded ${uploadedCount} files` : lastFileLog || "Deployment completed";
      updateProgress(100, completionTask, false);

      await refreshInstances();
      await refreshInstanceStatus(instanceID);
    } catch (error) {
      updateProgress(100, error instanceof Error ? error.message : "Deployment failed", false);
    } finally {
      window.clearInterval(progressTimer);
    }
  }

  async function deleteInstanceFromHome(instanceID: string): Promise<void> {
    if (!window.confirm("Delete this instance permanently?")) {
      return;
    }

    await deleteInstance(instanceID);
    setDeployProgressByInstance((current) => {
      const next = { ...current };
      delete next[instanceID];
      return next;
    });
    await refreshAllStatuses();
  }

  if (loading) {
    return <main className="app-shell">Loading GitOrbit...</main>;
  }

  if (error) {
    return <main className="app-shell">Error: {error}</main>;
  }

  return (
    <main className="app-shell">
      <Sidebar
        profiles={visibleProfiles}
        folders={folders}
        selectedId={selectedProfileId}
        onSelect={(id) => {
          setAccountPopup((current) => ({ ...current, open: false }));
          setView("repositories");
          void selectProfile(id);
        }}
        onHide={(id) => {
          if (id === selectedProfileId && view === "repositories") {
            setView("home");
          }
          void hideProfile(id);
        }}
        onRemove={(id) => {
          if (id === selectedProfileId && view === "repositories") {
            setView("home");
          }
          void removeProfile(id);
        }}
        onReorder={(sourceId, targetId) => {
          void reorderProfile(sourceId, targetId);
        }}
        onDropToFolder={(sourceId, targetId) => {
          void dropProfileIntoFolder(sourceId, targetId);
        }}
        onToggleFolder={(folderId) => {
          void toggleFolder(folderId);
        }}
        onShowSearch={() => {
          setAccountPopup((current) => ({ ...current, open: false }));
          setView("search");
        }}
        onShowHome={() => {
          setAccountPopup((current) => ({ ...current, open: false }));
          setView("home");
        }}
        onShowAccount={(anchor) => {
          setAccountPopup((current) => {
            if (current.open) {
              return {
                ...current,
                open: false
              };
            }

            return {
              open: true,
              x: anchor.x,
              y: anchor.y
            };
          });
        }}
        accountPopupOpen={accountPopup.open}
        githubConnected={githubConnected}
        currentView={view}
      />

      <section className="content-shell">
        {githubWarning && <div className="warning-banner">{githubWarning}</div>}

        {view === "home" && (
          <HomeView
            instances={instances}
            statuses={statuses}
            loadingByInstance={deploymentStatusLoading}
            deployProgressByInstance={deployProgressByInstance}
            onOpenInstanceWizard={openInstanceWizard}
            onCreateInstance={startCreateFromHome}
            onDeleteInstance={deleteInstanceFromHome}
            onDeployOrUpdate={deployOrUpdate}
            onOpenSite={(url) => {
              void openSite(url);
            }}
          />
        )}
        {view === "search" && (
          <SearchPanel
            onSearch={searchGithub}
            onAddProfileUrl={addProfile}
            onInstall={startInstall}
            existingSidebarOwners={existingSidebarOwners}
          />
        )}
        {view === "repositories" && (
          <RepositoryList
            owner={selectedOwner}
            repositories={repositories}
            onInstall={startInstall}
            loading={repositoriesLoading}
          />
        )}

        <InstanceWizardModal
          open={wizardOpen}
          mode={wizardMode}
          instanceID={editingInstanceID}
          installDraft={installDraft}
          onClose={() => {
            setWizardOpen(false);
            setInstallDraft(null);
            setEditingInstanceID(null);
          }}
          onSaved={async () => {
            await refreshInstances();
            await refreshAllStatuses();
          }}
          onSaveInstance={saveInstance}
          onUpdateInstance={updateInstance}
          onLoadInstance={loadInstanceInput}
        />
      </section>

      {accountPopup.open && (
        <div ref={accountPopupRef} className="account-popup">
          <AuthPanel
            onClose={() => {
              setAccountPopup((current) => ({
                ...current,
                open: false
              }));
            }}
            onConnected={async () => {
              await refreshGithubAuthStatus();
              await refreshInstances();
              await refreshRepositories(selectedOwner);
              await refreshAllStatuses();
            }}
          />
        </div>
      )}
    </main>
  );
}
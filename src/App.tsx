// Purpose: Compose launcher navigation and route install actions into the instance workflow.
import { useEffect, useMemo, useState } from "react";
import AuthPanel from "./components/AuthPanel";
import DeploymentPanel from "./components/DeploymentPanel";
import HomeView from "./components/HomeView";
import InstanceManager from "./components/InstanceManager";
import RepositoryList from "./components/RepositoryList";
import SearchPanel from "./components/SearchPanel";
import Sidebar from "./components/Sidebar";
import { useLauncherData } from "./hooks/useLauncherData";
import { ownerFromGithubUrl } from "./utils/github";

type ViewMode = "home" | "repositories" | "search" | "instances";
type ExtendedViewMode = ViewMode | "account";

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
    refreshInstances,
    refreshGithubAuthStatus,
    refreshRepositories
  } = useLauncherData();

  const [view, setView] = useState<ExtendedViewMode>("home");
  const [installDraft, setInstallDraft] = useState<{ owner: string; repo: string } | null>(null);
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

  function startInstall(owner: string, repo: string): void {
    setInstallDraft({ owner, repo });
    setView("instances");
  }

  if (loading) {
    return <main className="app-shell">Loading launcher...</main>;
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
        onShowSearch={() => setView("search")}
        onShowHome={() => setView("home")}
        onShowInstances={() => setView("instances")}
        onShowAccount={() => setView("account")}
        githubConnected={githubConnected}
        currentView={view}
      />

      <section className="content-shell">
        {githubWarning && <div className="warning-banner">{githubWarning}</div>}

        {view === "home" && <HomeView instances={instances} />}
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

        {view === "instances" && (
          <InstanceManager
            instances={instances}
            onSaveInstance={saveInstance}
            onUpdateInstance={updateInstance}
            onLoadInstance={loadInstanceInput}
            installDraft={installDraft}
          />
        )}

        {view === "account" && (
          <AuthPanel
            onConnected={async () => {
              await refreshGithubAuthStatus();
              await refreshInstances();
              await refreshRepositories(selectedOwner);
            }}
          />
        )}

        {(view === "home" || view === "instances") && <DeploymentPanel instances={instances} />}
      </section>
    </main>
  );
}
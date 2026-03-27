// Purpose: Compose launcher navigation and route install actions into the instance workflow.
import { useMemo, useState } from "react";
import AuthPanel from "./components/AuthPanel";
import DeploymentPanel from "./components/DeploymentPanel";
import HomeView from "./components/HomeView";
import InstanceManager from "./components/InstanceManager";
import RepositoryList from "./components/RepositoryList";
import SearchPanel from "./components/SearchPanel";
import Sidebar from "./components/Sidebar";
import { useLauncherData } from "./hooks/useLauncherData";

type ViewMode = "home" | "repositories" | "search" | "instances";

export default function App() {
  const {
    loading,
    error,
    profiles,
    visibleProfiles,
    selectedProfileId,
    selectedOwner,
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
    refreshRepositories
  } = useLauncherData();

  const [view, setView] = useState<ViewMode>("repositories");
  const [installDraft, setInstallDraft] = useState<{ owner: string; repo: string } | null>(null);
  const folders = useMemo(() => profiles.folders || [], [profiles.folders]);

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
          void hideProfile(id);
        }}
        onRemove={(id) => {
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
        currentView={view}
      />

      <section className="content-shell">
        {githubWarning && <div className="warning-banner">{githubWarning}</div>}

        {view === "home" && <HomeView instances={instances} />}
        {view === "search" && (
          <SearchPanel onSearch={searchGithub} onAddProfileUrl={addProfile} onInstall={startInstall} />
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

        {(view === "home" || view === "instances") && <DeploymentPanel instances={instances} />}
      </section>

      <footer className="bottom-right">
        <AuthPanel
          onConnected={async () => {
            await refreshInstances();
            await refreshRepositories(selectedOwner);
          }}
        />
      </footer>
    </main>
  );
}
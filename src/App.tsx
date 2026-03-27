// Purpose: Compose the launcher interface and orchestrate interactions across core frontend features.
import { useEffect, useMemo, useState } from "react";
import AuthPanel from "./components/AuthPanel";
import DeploymentPanel from "./components/DeploymentPanel";
import HomeView from "./components/HomeView";
import InstanceManager from "./components/InstanceManager";
import RepositoryList from "./components/RepositoryList";
import SearchPanel from "./components/SearchPanel";
import Sidebar from "./components/Sidebar";
import { useLauncherData } from "./hooks/useLauncherData";

type ViewMode = "home" | "repositories" | "search";

export default function App() {
  const {
    loading,
    error,
    profiles,
    visibleProfiles,
    selectedProfileId,
    selectedOwner,
    repositories,
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
    refreshInstances,
    refreshRepositories
  } = useLauncherData();

  const [view, setView] = useState<ViewMode>("repositories");
  const folders = useMemo(() => profiles.folders || [], [profiles.folders]);

  useEffect(() => {
    function refreshOnManifestCheck() {
      void refreshRepositories(selectedOwner);
    }

    window.addEventListener("refresh-repositories", refreshOnManifestCheck);
    return () => {
      window.removeEventListener("refresh-repositories", refreshOnManifestCheck);
    };
  }, [refreshRepositories, selectedOwner]);

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
        currentView={view}
      />

      <section className="content-shell">
        {view === "home" && <HomeView instances={instances} />}
        {view === "search" && <SearchPanel onSearch={searchGithub} onAddProfileUrl={addProfile} />}
        {view === "repositories" && (
          <RepositoryList owner={selectedOwner} repositories={repositories} />
        )}

        <InstanceManager instances={instances} onSaveInstance={saveInstance} />
        <DeploymentPanel />
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
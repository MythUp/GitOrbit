// Purpose: Render the home screen with all instances and quick launcher summary information.
import { InstanceRecord } from "../types/models";
import { useInstanceFtpVersions } from "../hooks/useInstanceFtpVersions";

interface HomeViewProps {
  instances: InstanceRecord[];
}

export default function HomeView({ instances }: HomeViewProps) {
  const ftpVersions = useInstanceFtpVersions(instances);

  return (
    <section className="panel">
      <h2>Home</h2>
      <p>All configured instances are shown here for fast access and deployment control.</p>

      <div className="home-grid">
        {instances.length === 0 && <p>No instances yet. Create your first instance below.</p>}
        {instances.map((instance) => (
          <article key={instance.id} className="home-card">
            <h3>{instance.name}</h3>
            <p>
              {instance.owner}/{instance.repo}
            </p>
            <small>Installed FTP version: {ftpVersions[instance.id] || "checking..."}</small>
            <small>Updated: {new Date(instance.updated_at).toLocaleString()}</small>
          </article>
        ))}
      </div>
    </section>
  );
}
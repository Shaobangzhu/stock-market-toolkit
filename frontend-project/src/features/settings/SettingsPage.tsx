import { useQuery } from '@tanstack/react-query';
import { ApiOutlined, CloudServerOutlined, DatabaseOutlined, SafetyOutlined } from '@ant-design/icons';
import { Alert, Button } from 'antd';
import { readinessQuery } from '../../api/client';
import { LoadingState } from '../../components/States';

export function SettingsPage() {
  const readiness = useQuery(readinessQuery);

  return (
    <div className="page settings-page">
      <section className="page-heading">
        <div><span className="eyebrow">LOCAL CONTROL CENTER</span><h1>Data &amp; Settings</h1><p>Connection health and data guidance for this workspace.</p></div>
      </section>
      <div className="settings-grid">
        <section className="panel" aria-labelledby="db-title">
          <div className="panel__header"><div><span className="eyebrow">SYSTEM STATUS</span><h2 id="db-title">Local database</h2></div><DatabaseOutlined /></div>
          {readiness.isPending ? <LoadingState label="Checking local database" /> : readiness.isError ? (
            <Alert type="warning" showIcon title="Database unavailable" description="Start the local PostgreSQL service and apply migrations, then check again." />
          ) : (
            <div className="settings-status"><span className="settings-status__dot" /> Ready for local data</div>
          )}
          <Button className="settings-check" onClick={() => void readiness.refetch()} loading={readiness.isFetching}>Check connection</Button>
        </section>
        <section className="panel" aria-labelledby="providers-title">
          <div className="panel__header"><div><span className="eyebrow">DATA SOURCES</span><h2 id="providers-title">Provider connections</h2></div><ApiOutlined /></div>
          <p>Provider status will appear when the backend exposes configuration checks. API keys stay in the backend environment file.</p>
          <div className="settings-list"><span>Historical market data</span><strong>Not checked</strong></div>
          <div className="settings-list"><span>SEC filings</span><strong>Not checked</strong></div>
          <div className="settings-list"><span>Research service</span><strong>Not checked</strong></div>
        </section>
        <section className="panel" aria-labelledby="safety-title">
          <div className="panel__header"><div><span className="eyebrow">YOUR DATA</span><h2 id="safety-title">Local by design</h2></div><SafetyOutlined /></div>
          <p>Research and market records remain in the dedicated PostgreSQL database on this computer. See the project database guide for safe backup and restore commands.</p>
        </section>
        <section className="panel" aria-labelledby="freshness-title">
          <div className="panel__header"><div><span className="eyebrow">COVERAGE</span><h2 id="freshness-title">Freshness &amp; jobs</h2></div><CloudServerOutlined /></div>
          <p>Source coverage, refresh history, and job results will appear here after their APIs are connected.</p>
        </section>
      </div>
    </div>
  );
}

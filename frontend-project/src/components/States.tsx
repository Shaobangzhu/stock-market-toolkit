import type { ReactNode } from 'react';
import { Alert, Button, Empty, Skeleton } from 'antd';
import { Link } from 'react-router-dom';

export function EmptyState({ title, description, action, icon }: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Empty
        image={icon ?? Empty.PRESENTED_IMAGE_SIMPLE}
        description={<><strong>{title}</strong><span>{description}</span></>}
      >
        {action}
      </Empty>
    </div>
  );
}

export function LoadingState({ label = 'Loading data' }: { label?: string }) {
  return <div className="loading-state" role="status" aria-label={label}><Skeleton active paragraph={{ rows: 3 }} /></div>;
}

export function ErrorState({ title, description, backTo }: {
  title: string;
  description: string;
  backTo?: string;
}) {
  return (
    <div className="error-state">
      <Alert type="error" showIcon title={title} description={description} />
      {backTo && <Link to={backTo}><Button>Return to Watchlist</Button></Link>}
    </div>
  );
}

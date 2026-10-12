import { Drawer } from 'antd';
import { EmptyState } from './States';

export function ResearchHistoryDrawer({ open, onClose, symbol }: {
  open: boolean;
  onClose: () => void;
  symbol: string;
}) {
  return (
    <Drawer
      className="research-history-drawer"
      title={<><span className="eyebrow">{symbol} / RESEARCH</span><strong>Research History</strong></>}
      placement="right"
      width={480}
      open={open}
      onClose={onClose}
      destroyOnHidden={false}
    >
      <EmptyState title="No research runs yet" description="Saved reports will appear here after you run research for this stock." />
    </Drawer>
  );
}

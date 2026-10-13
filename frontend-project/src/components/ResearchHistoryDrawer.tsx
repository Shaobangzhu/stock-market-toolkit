import { Drawer } from 'antd';
import { EmptyState } from './States';
import { Button } from 'antd';
import type { ResearchRecord } from '../api/stocks';

export function ResearchHistoryDrawer({ open, onClose, symbol, records = [], selected, onSelect }: {
  open: boolean;
  onClose: () => void;
  symbol: string;
  records?: ResearchRecord[];
  selected?: ResearchRecord | null;
  onSelect?: (record: ResearchRecord) => void;
}) {
  return (
    <Drawer
      className="research-history-drawer"
      title={<><span className="eyebrow">{symbol} / RESEARCH</span><strong>Research History</strong></>}
      placement="right"
      size={480}
      open={open}
      onClose={onClose}
      destroyOnHidden={false}
    >
      {records.length === 0 && !selected ? <EmptyState title="No research runs yet" description="Saved reports will appear here after you run research for this stock." /> : <>
        {selected && <section className="history-selection"><h3>{selected.type} · v{selected.version}</h3><p>Research date: {selected.completedAt.slice(0, 10)}</p><p>Data cutoff: {selected.dataCutoff}</p><p>Detailed report viewing and version comparison will be available in a later phase.</p></section>}
        <p>Latest saved records for {symbol} (up to 50).</p>
        <div className="history-record-list">{records.map(record => <Button key={record.id} onClick={() => onSelect?.(record)}>{record.completedAt.slice(0, 10)} · {record.type} · v{record.version}</Button>)}</div>
      </>}
    </Drawer>
  );
}

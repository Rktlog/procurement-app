import Page from '../layout/Page';
import Cin7SyncControl from '../layout/Cin7SyncControl';
import Cin7Procurement from '../Cin7Procurement';
import { useStagedPO } from '../app/StagedPOContext';

export default function ReorderPage() {
  const { items, removeItem, clearItems } = useStagedPO();
  return (
    <Page actions={<Cin7SyncControl />}>
      <Cin7Procurement stagedItems={items} onRemoveStagedItem={removeItem} onClearStagedItems={clearItems} />
    </Page>
  );
}

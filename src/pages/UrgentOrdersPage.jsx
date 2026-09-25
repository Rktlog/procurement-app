import { useNavigate } from 'react-router-dom';
import Page from '../layout/Page';
import Cin7SyncControl from '../layout/Cin7SyncControl';
import UrgentSalesShortage from '../UrgentSalesShortage';
import { useStagedPO } from '../app/StagedPOContext';

export default function UrgentOrdersPage() {
  const { addItems } = useStagedPO();
  const navigate = useNavigate();
  return (
    <Page actions={<Cin7SyncControl />}>
      <UrgentSalesShortage
        onAddToPO={(items) => {
          addItems(items, 'urgent');
          navigate('/procurement/reorder');
        }}
      />
    </Page>
  );
}

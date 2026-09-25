import { useNavigate } from 'react-router-dom';
import Page from '../layout/Page';
import Cin7SyncControl from '../layout/Cin7SyncControl';
import LongtermOrders from '../LongtermOrders';
import { useStagedPO } from '../app/StagedPOContext';

export default function LongtermOrdersPage() {
  const { addItems } = useStagedPO();
  const navigate = useNavigate();
  return (
    <Page actions={<Cin7SyncControl />}>
      <LongtermOrders
        onAddToPO={(items) => {
          addItems(items, 'longterm');
          navigate('/procurement/reorder');
        }}
      />
    </Page>
  );
}

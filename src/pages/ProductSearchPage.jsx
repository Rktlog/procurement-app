import Page from '../layout/Page';
import Cin7SyncControl from '../layout/Cin7SyncControl';
import ProductSearch from '../ProductSearch';

export default function ProductSearchPage() {
  return (
    <Page actions={<Cin7SyncControl />}>
      <ProductSearch />
    </Page>
  );
}

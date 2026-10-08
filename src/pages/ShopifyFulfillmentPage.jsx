import Page from '../layout/Page';
import ShopifyStoreBadge from '../layout/ShopifyStoreBadge';
import ShopifyFulfillment from '../ShopifyFulfillment';

export default function ShopifyFulfillmentPage() {
  return (
    <Page actions={<ShopifyStoreBadge />}>
      <ShopifyFulfillment />
    </Page>
  );
}
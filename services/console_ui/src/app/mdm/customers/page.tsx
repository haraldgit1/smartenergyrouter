// app/mdm/customers/page.tsx
import { CustomerMdmMockPage } from "@/components/mdm/mock/customer-mdm-mock";

export const dynamic = "force-dynamic";

export default function CustomersMdmPage() {
  return <CustomerMdmMockPage />;
}


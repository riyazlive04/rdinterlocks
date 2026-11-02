import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { PageHeader, Card } from "@/components/ui";
import { QuoteContentForm } from "./form";
import { updateQuoteContent } from "../actions";

export default async function QuoteContentSettingsPage() {
  await requireAdmin();
  const s = await prisma.settings.findUnique({ where: { id: "default" } });

  return (
    <>
      <PageHeader
        title="Quotation content"
        sub="Bilingual boilerplate text and payment details printed on every quotation PDF"
        back="/settings"
      />
      <Card className="mb-4 border-amber-200 bg-amber-50">
        <div className="text-[12.5px] text-ink">
          The Tamil text below was reconstructed from a scanned reference document via OCR, which is
          error-prone for Tamil script. Please proofread it carefully before sending quotations to real
          customers — edit anything here and it takes effect on the next PDF generated, no deploy needed.
        </div>
      </Card>
      <QuoteContentForm
        initial={{
          quoteAddressTa: s?.quoteAddressTa ?? "",
          quoteTermsEn: s?.quoteTermsEn ?? "",
          quoteTermsTa: s?.quoteTermsTa ?? "",
          quoteOurScopeEn: s?.quoteOurScopeEn ?? "",
          quoteOurScopeTa: s?.quoteOurScopeTa ?? "",
          quoteClientScopeEn: s?.quoteClientScopeEn ?? "",
          quoteClientScopeTa: s?.quoteClientScopeTa ?? "",
          quoteUpiId: s?.quoteUpiId ?? "",
          quoteUpiPayeeName: s?.quoteUpiPayeeName ?? "",
          quoteSignatureImage: s?.quoteSignatureImage ?? "",
        }}
        onSave={async (data) => {
          "use server";
          await updateQuoteContent(data);
        }}
      />
    </>
  );
}

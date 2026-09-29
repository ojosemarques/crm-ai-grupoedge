import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getContractService } from "@/modules/contracts/application/contract-service";
import styles from "./print.module.css";

export const dynamic = "force-dynamic";

export default async function PrintableContractPage({ params }: Readonly<{ params: Promise<{ contractId: string }> }>) {
  const context = await requirePageAuthentication();
  const { contractId } = await params;
  const document = await getContractService().getPrintableVersion(context, contractId);
  return <main className={styles.page}><div className={styles.document} dangerouslySetInnerHTML={{ __html: document.html }} /><p className="sr-only">Hash de integridade {document.contentHash}</p></main>;
}

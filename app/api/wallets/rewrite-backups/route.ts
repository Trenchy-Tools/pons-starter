import { fail, ok } from "@/lib/http"
import { rewriteBackups } from "@/lib/wallets"

/** POST /api/wallets/rewrite-backups → { dir, files, restored, csvAdded }: restore missing files from wallets.csv and add missing CSV lines (idempotent). */
export async function POST() {
  try {
    return ok(rewriteBackups())
  } catch (e) {
    return fail(e)
  }
}

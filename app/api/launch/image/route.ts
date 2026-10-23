import { fail, ok } from "@/lib/http"
import { trenchy } from "@/lib/trenchy"

/** POST /api/launch/image (multipart: file, name, symbol, description?, twitter?, telegram?, website?) → POST /api/ipfs → { image: metadata.image, metadataUri }. */
export async function POST(req: Request) {
  try {
    const form = await req.formData()
    const file = form.get("file")
    if (!(file instanceof File) || !file.size) return fail(new Error("file: a PNG, JPG, GIF or WebP up to 4 MB"), 400)
    const r = await trenchy().uploadMetadata(form)
    const image = r.metadata?.image
    if (!image) return fail(new Error("the API answered without metadata.image"), 502)
    return ok({ image, metadataUri: r.metadataUri })
  } catch (e) {
    return fail(e)
  }
}

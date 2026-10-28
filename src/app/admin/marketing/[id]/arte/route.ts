import { z } from "zod";
import { requireOperationsAdmin } from "@/lib/admin-operations";
import { marketingArt } from "@/lib/marketing-art";

export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { db } = await requireOperationsAdmin();
  const id = z.uuid().safeParse((await params).id);
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (!id.success)
    return new Response("Campanha não encontrada", { status: 404, headers });
  const result = await db
    .from("platform_marketing_campaigns")
    .select("headline,cta")
    .eq("id", id.data)
    .single();
  if (result.error || !result.data?.headline)
    return new Response("Arte indisponível", { status: 404, headers });
  return new Response(marketingArt(result.data), {
    headers: {
      ...headers,
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Content-Disposition": `inline; filename="webfidelize-${id.data.slice(0, 8)}.svg"`,
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}

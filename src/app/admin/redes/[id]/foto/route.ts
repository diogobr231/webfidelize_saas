import { z } from "zod";
import { requireOperationsAdmin } from "@/lib/admin-operations";
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
  if (!id.success) return new Response(null, { status: 404, headers });
  const { data, error } = await db
    .from("platform_social_posts")
    .select("asset_path")
    .eq("id", id.data)
    .single();
  if (error || !data?.asset_path)
    return new Response(null, { status: 404, headers });
  const image = await db.storage
    .from("social-assets")
    .download(data.asset_path);
  if (image.error || !image.data)
    return new Response(null, { status: 404, headers });
  return new Response(image.data, {
    headers: {
      ...headers,
      "Content-Type": "image/jpeg",
      "Content-Disposition": "inline; filename=post.jpg",
    },
  });
}

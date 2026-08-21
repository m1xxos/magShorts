import { NextRequest, NextResponse } from "next/server";
import { ARTICLE_COLUMNS, getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// One article by id. Exists for the reader's deep link: /?article=123 has to
// work on a cold load, and the article it names is not necessarily on the
// first page of whatever list the grid happens to show.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!getSessionUser(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const articleId = Number(id);
  if (!Number.isInteger(articleId) || articleId <= 0) {
    return NextResponse.json({ error: "Invalid article id" }, { status: 400 });
  }
  const article = getDb()
    .prepare(
      `SELECT ${ARTICLE_COLUMNS}, f.title AS feed_title FROM articles a
       JOIN feeds f ON f.id = a.feed_id
       WHERE a.id = ?`
    )
    .get(articleId);
  if (!article) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(article);
}

import { moveMatch } from "../../../../../game/server";

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  return moveMatch(request, code);
}

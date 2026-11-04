import { readMatch } from "../../../../game/server";

export async function GET(_request: Request, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  return readMatch(code);
}

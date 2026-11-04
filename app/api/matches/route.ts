import { createMatch } from "../../../game/server";

export async function POST(request: Request) {
  return createMatch(request);
}

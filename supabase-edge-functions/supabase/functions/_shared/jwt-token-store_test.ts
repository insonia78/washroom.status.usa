import { jwtTokenTableName } from "./jwt-token-store.ts";

Deno.test("JWT persistence identifies the private account table", () => {
  if (jwtTokenTableName !== "app_accounts.jwt_tokens") {
    throw new Error(`Unexpected token table: ${jwtTokenTableName}`);
  }
});

Deno.test("all JWT persistence queries explicitly select the account schema", async () => {
  const source = await Deno.readTextFile(new URL("./jwt-token-store.ts", import.meta.url));
  const references = [...source.matchAll(/\b(insert into|from|update)\s+([\w.]*jwt_tokens)\b/gi)];
  if (references.length !== 4) {
    throw new Error(`Expected four JWT table queries, found ${references.length}`);
  }
  for (const reference of references) {
    if (reference[2] !== "app_accounts.jwt_tokens") {
      throw new Error(`Unqualified JWT persistence query: ${reference[0]}`);
    }
  }
});

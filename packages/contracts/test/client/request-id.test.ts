import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as RpcSchema from "effect/rpc/RpcSchema";
import { expect, it } from "vitest";
import { clientCommands, definitions } from "./support.ts";

const variants = (ast: SchemaAST.AST): readonly SchemaAST.Objects[] =>
  SchemaAST.isUnion(ast) ? ast.types.flatMap(variants) : ast._tag === "Objects" ? [ast] : [];

// A stream's reply is an event or a cursor marker, rather than a command
// receipt. Its payload and error still carry the action's request identifier.
it.each(clientCommands)("2.3 %s rejects absent or empty request identifiers in every payload, unary reply and error variant", (name) => {
  const rpc = definitions().requests.get(name);
  expect(rpc, `Missing definition for ${name}`).toBeDefined();
  const schemas = [rpc!.payloadSchema, rpc!.errorSchema];
  if (!RpcSchema.isStreamSchema(rpc!.successSchema)) schemas.push(rpc!.successSchema);
  for (const schema of schemas) {
    const objects = variants(schema.ast);
    expect(objects.length, `${name}: expected an object or union of objects`).toBeGreaterThan(0);
    for (const object of objects) {
      const id = object.propertySignatures.find((property) => property.name === "requestId");
      expect(id, `${name}: requestId missing from a variant`).toBeDefined();
      expect(id!.type.context?.isOptional ?? false, `${name}: requestId must be required`).toBe(false);
      const decode = Schema.decodeUnknownSync(Schema.make<Schema.Codec<unknown>>(id!.type));
      expect(decode("action-2")).toBe("action-2");
      for (const invalid of ["", undefined, null, 0]) expect(() => decode(invalid)).toThrow();
    }
  }
});
